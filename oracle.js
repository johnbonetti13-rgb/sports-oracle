/**
 * Sports Verification Oracle
 *
 * Verifies sports game results by querying multiple sources
 * and returning a consensus answer with confidence score.
 */

const axios = require('axios');

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
  const parsed = parseQuestion(question);

  if (!parsed.team) {
    return {
      verified: false,
      confidence: 0,
      error: 'could_not_parse_team_name',
      suggestion: 'Please include a team name in your question',
      parsed,
      timestamp: new Date().toISOString()
    };
  }

  return await verifyResult(parsed);
}

// Export for use as a module
module.exports = {
  askOracle,
  verifyResult,
  parseQuestion,
  querySportsDB
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
