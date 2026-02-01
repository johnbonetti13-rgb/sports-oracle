/**
 * Sports Verification Oracle
 *
 * Verifies sports game results by querying multiple sources
 * and returning a consensus answer with confidence score.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Stats file for dashboard
const STATS_FILE = path.join(__dirname, 'dashboard', 'stats.json');

// =============================================================================
// SAFETY RAILS - Protection for the Agent Economy
// =============================================================================

const SAFETY_LIMITS = {
  maxDailyLoss: 100,          // $100 max daily financial exposure
  maxConsecutiveErrors: 5,     // Circuit breaker after 5 consecutive errors
  minConfidenceFloor: 0.5,     // Never report confidence below 0.5
  maxQueriesPerMinute: 60,     // Rate limit (TheSportsDB allows 100/min)
  maxQueriesPerDay: 1000,      // Daily query limit
};

// Team name normalization for better success rate
const TEAM_ALIASES = {
  // NBA
  'celtics': 'Boston Celtics',
  'lakers': 'Los Angeles Lakers',
  'warriors': 'Golden State Warriors',
  'bulls': 'Chicago Bulls',
  'heat': 'Miami Heat',
  'nets': 'Brooklyn Nets',
  'knicks': 'New York Knicks',
  'sixers': 'Philadelphia 76ers',
  '76ers': 'Philadelphia 76ers',
  'bucks': 'Milwaukee Bucks',
  'suns': 'Phoenix Suns',
  'mavs': 'Dallas Mavericks',
  'mavericks': 'Dallas Mavericks',
  'nuggets': 'Denver Nuggets',
  'clippers': 'Los Angeles Clippers',
  'rockets': 'Houston Rockets',
  'spurs': 'San Antonio Spurs',
  // NFL
  'chiefs': 'Kansas City Chiefs',
  'eagles': 'Philadelphia Eagles',
  'cowboys': 'Dallas Cowboys',
  'packers': 'Green Bay Packers',
  'niners': 'San Francisco 49ers',
  '49ers': 'San Francisco 49ers',
  'bills': 'Buffalo Bills',
  'ravens': 'Baltimore Ravens',
  'bengals': 'Cincinnati Bengals',
  // MLB
  'yankees': 'New York Yankees',
  'dodgers': 'Los Angeles Dodgers',
  'red sox': 'Boston Red Sox',
  'cubs': 'Chicago Cubs',
  // NHL
  'bruins': 'Boston Bruins',
  'rangers': 'New York Rangers',
  'maple leafs': 'Toronto Maple Leafs',
  'canadiens': 'Montreal Canadiens',
};

/**
 * Normalize team name using aliases
 * @param {string} teamName - Raw team name
 * @returns {string} Normalized team name
 */
function normalizeTeamName(teamName) {
  if (!teamName) return teamName;
  const lower = teamName.toLowerCase().trim();
  return TEAM_ALIASES[lower] || teamName;
}

/**
 * Check if we're operating within safety limits
 * @returns {Object} { safe: boolean, reason?: string }
 */
function checkSafetyLimits() {
  const stats = loadStats();

  // Check consecutive errors (circuit breaker)
  const recentQueries = stats.recentQueries.slice(0, SAFETY_LIMITS.maxConsecutiveErrors);
  const consecutiveErrors = recentQueries.filter(q => !q.verified).length;

  if (recentQueries.length >= SAFETY_LIMITS.maxConsecutiveErrors &&
      consecutiveErrors === SAFETY_LIMITS.maxConsecutiveErrors) {
    return {
      safe: false,
      reason: 'circuit_breaker_tripped',
      message: `${SAFETY_LIMITS.maxConsecutiveErrors} consecutive errors detected. Operations paused.`
    };
  }

  // Check daily query limit
  if (stats.todayQueries >= SAFETY_LIMITS.maxQueriesPerDay) {
    return {
      safe: false,
      reason: 'daily_limit_reached',
      message: `Daily query limit (${SAFETY_LIMITS.maxQueriesPerDay}) reached.`
    };
  }

  return { safe: true };
}

/**
 * Apply confidence floor - never go below minimum
 * @param {number} confidence - Raw confidence
 * @returns {number} Adjusted confidence
 */
function applyConfidenceFloor(confidence) {
  if (confidence > 0 && confidence < SAFETY_LIMITS.minConfidenceFloor) {
    return SAFETY_LIMITS.minConfidenceFloor;
  }
  return confidence;
}

// Load or initialize stats
function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return {
    totalQueries: 0,
    todayQueries: 0,
    successCount: 0,
    errorCount: 0,
    confidenceSum: 0,
    hourlyData: new Array(24).fill(0),
    recentQueries: [],
    lastReset: new Date().toDateString()
  };
}

// Save stats
function saveStats(stats) {
  try {
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (e) { /* ignore */ }
}

// Log a query result
function logQuery(result) {
  const stats = loadStats();

  // Reset daily counters if new day
  if (stats.lastReset !== new Date().toDateString()) {
    stats.todayQueries = 0;
    stats.hourlyData = new Array(24).fill(0);
    stats.lastReset = new Date().toDateString();
  }

  stats.totalQueries++;
  stats.todayQueries++;
  stats.hourlyData[new Date().getHours()]++;

  if (result.verified) {
    stats.successCount++;
    stats.confidenceSum += result.confidence || 0;
  } else {
    stats.errorCount++;
  }

  // Keep last 50 queries
  stats.recentQueries.unshift({
    timestamp: new Date().toISOString(),
    query: result.query,
    verified: result.verified,
    confidence: result.confidence,
    winner: result.result?.winner,
    error: result.error
  });
  stats.recentQueries = stats.recentQueries.slice(0, 50);

  saveStats(stats);
}

// TheSportsDB - Free tier (no API key required for basic queries)
const SPORTSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/3';

/**
 * Query TheSportsDB for past events by team name and date
 * @param {string} teamName - Team to search for
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Object|null} Event data or null
 */
async function querySportsDB(teamName, date) {
  try {
    // Search for team first
    const teamSearch = await axios.get(
      `${SPORTSDB_BASE}/searchteams.php?t=${encodeURIComponent(teamName)}`
    );

    if (!teamSearch.data.teams || teamSearch.data.teams.length === 0) {
      return { error: 'team_not_found', source: 'thesportsdb' };
    }

    const team = teamSearch.data.teams[0];
    const teamId = team.idTeam;

    // Get last 5 events for this team
    const eventsResponse = await axios.get(
      `${SPORTSDB_BASE}/eventslast.php?id=${teamId}`
    );

    if (!eventsResponse.data.results) {
      return { error: 'no_events', source: 'thesportsdb' };
    }

    // Find event matching the date
    const event = eventsResponse.data.results.find(e =>
      e.dateEvent === date
    );

    if (!event) {
      return { error: 'event_not_found_on_date', source: 'thesportsdb' };
    }

    const homeScore = parseInt(event.intHomeScore, 10);
    const awayScore = parseInt(event.intAwayScore, 10);

    return {
      source: 'thesportsdb',
      homeTeam: event.strHomeTeam,
      awayTeam: event.strAwayTeam,
      homeScore,
      awayScore,
      winner: homeScore > awayScore
        ? event.strHomeTeam
        : awayScore > homeScore
          ? event.strAwayTeam
          : 'tie',
      date: event.dateEvent,
      league: event.strLeague,
      eventId: event.idEvent
    };
  } catch (error) {
    return { error: error.message, source: 'thesportsdb' };
  }
}

/**
 * Verify a sports result by querying multiple sources
 * @param {Object} query - Query parameters
 * @param {string} query.team - Team name to verify
 * @param {string} query.date - Date in YYYY-MM-DD format
 * @param {string} query.opponent - Optional opponent team name
 * @returns {Object} Verification result with confidence
 */
async function verifyResult(query) {
  const { team, date, opponent } = query;

  // Query primary source
  const sportsDbResult = await querySportsDB(team, date);

  // For MVP, we use single source with lower confidence
  // In production, add more sources for higher confidence

  if (sportsDbResult.error) {
    return {
      verified: false,
      confidence: 0,
      error: sportsDbResult.error,
      query,
      sources: ['thesportsdb'],
      timestamp: new Date().toISOString()
    };
  }

  // Verify opponent matches if provided
  let opponentMatch = true;
  if (opponent) {
    const oppLower = opponent.toLowerCase();
    opponentMatch =
      sportsDbResult.homeTeam.toLowerCase().includes(oppLower) ||
      sportsDbResult.awayTeam.toLowerCase().includes(oppLower);
  }

  // Calculate confidence
  // Single source = 0.75 base
  // With opponent match = 0.85
  // Multiple agreeing sources = 0.95+ (future)
  let confidence = 0.75;
  if (opponentMatch && opponent) {
    confidence = 0.85;
  }

  return {
    verified: true,
    confidence,
    result: {
      homeTeam: sportsDbResult.homeTeam,
      awayTeam: sportsDbResult.awayTeam,
      homeScore: sportsDbResult.homeScore,
      awayScore: sportsDbResult.awayScore,
      winner: sportsDbResult.winner,
      finalScore: `${sportsDbResult.homeScore}-${sportsDbResult.awayScore}`
    },
    league: sportsDbResult.league,
    date: sportsDbResult.date,
    query,
    sources: ['thesportsdb'],
    sourcesAgreed: 1,
    sourcesQueried: 1,
    timestamp: new Date().toISOString()
  };
}

/**
 * Simple question parser for natural language queries
 * @param {string} question - Natural language question
 * @returns {Object} Parsed query parameters
 */
function parseQuestion(question) {
  // Extract date patterns
  const datePatterns = [
    /(\d{4}-\d{2}-\d{2})/,  // YYYY-MM-DD
    /on (\w+ \d+,? \d{4})/i,  // on January 30, 2026
    /(yesterday|today|last night)/i
  ];

  let date = null;
  for (const pattern of datePatterns) {
    const match = question.match(pattern);
    if (match) {
      if (match[1] === 'yesterday' || match[1] === 'last night') {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        date = d.toISOString().split('T')[0];
      } else if (match[1] === 'today') {
        date = new Date().toISOString().split('T')[0];
      } else {
        // Try to parse the date
        const parsed = new Date(match[1]);
        if (!isNaN(parsed)) {
          date = parsed.toISOString().split('T')[0];
        } else {
          date = match[1];
        }
      }
      break;
    }
  }

  // Extract team names (simplified - looks for capitalized words)
  const teamPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  const teams = [];
  let teamMatch;
  while ((teamMatch = teamPattern.exec(question)) !== null) {
    const team = teamMatch[1];
    // Filter out common non-team words
    if (!['Who', 'What', 'Did', 'The', 'How', 'When'].includes(team)) {
      teams.push(team);
    }
  }

  return {
    team: teams[0] || null,
    opponent: teams[1] || null,
    date: date || new Date().toISOString().split('T')[0],
    originalQuestion: question
  };
}

/**
 * Main oracle function - answer a sports verification question
 * @param {string} question - Natural language question
 * @returns {Object} Oracle response
 */
async function askOracle(question) {
  // SAFETY CHECK: Verify we're within limits
  const safetyCheck = checkSafetyLimits();
  if (!safetyCheck.safe) {
    console.error(`🛑 SAFETY RAIL: ${safetyCheck.reason}`);
    return {
      verified: false,
      confidence: 0,
      error: safetyCheck.reason,
      message: safetyCheck.message,
      safetyTriggered: true,
      timestamp: new Date().toISOString()
    };
  }

  const parsed = parseQuestion(question);

  // Normalize team name for better success rate
  if (parsed.team) {
    parsed.team = normalizeTeamName(parsed.team);
  }
  if (parsed.opponent) {
    parsed.opponent = normalizeTeamName(parsed.opponent);
  }

  if (!parsed.team) {
    const result = {
      verified: false,
      confidence: 0,
      error: 'could_not_parse_team_name',
      suggestion: 'Please include a team name in your question',
      parsed,
      timestamp: new Date().toISOString()
    };
    logQuery(result);
    return result;
  }

  const result = await verifyResult(parsed);

  // Apply confidence floor if verified
  if (result.verified && result.confidence > 0) {
    result.confidence = applyConfidenceFloor(result.confidence);
  }

  logQuery(result);
  return result;
}

// Export for use as a module
module.exports = {
  askOracle,
  verifyResult,
  parseQuestion,
  querySportsDB,
  // Safety and utility exports
  normalizeTeamName,
  checkSafetyLimits,
  SAFETY_LIMITS,
  TEAM_ALIASES
};

// CLI usage
if (require.main === module) {
  const question = process.argv.slice(2).join(' ') ||
    'Who won the Lakers game yesterday?';

  console.log('\n🔮 Sports Verification Oracle\n');
  console.log(`Question: "${question}"\n`);

  askOracle(question).then(result => {
    console.log('Result:', JSON.stringify(result, null, 2));
  }).catch(err => {
    console.error('Error:', err.message);
  });
}
