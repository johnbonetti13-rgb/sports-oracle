/**
 * Reddit Oracle
 *
 * Fetches and analyzes Reddit data using the .json endpoint trick.
 * Returns subreddit insights, post data, and engagement metrics.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Stats file for dashboard
const STATS_FILE = path.join(__dirname, 'dashboard', 'reddit-stats.json');

// =============================================================================
// SAFETY RAILS - Protection for the Agent Economy
// =============================================================================

const SAFETY_LIMITS = {
  maxQueriesPerMinute: 30,     // Reddit rate limit is ~60/min, we stay conservative
  maxQueriesPerDay: 500,       // Daily query limit
  maxConsecutiveErrors: 5,     // Circuit breaker
  minConfidenceFloor: 0.5,     // Never report confidence below 0.5
  requestDelayMs: 2000,        // 2 second delay between requests
};

// User agent is REQUIRED by Reddit
const USER_AGENT = 'RedditOracle/1.0 (OpenClaw Agent; +https://openclaw.ai)';

// Last request timestamp for rate limiting
let lastRequestTime = 0;

// =============================================================================
// QUERY TYPES
// =============================================================================

const QUERY_TYPES = {
  HOT: 'hot',           // What's hot on r/{subreddit}?
  NEW: 'new',           // What's new on r/{subreddit}?
  TOP: 'top',           // Top posts on r/{subreddit}?
  POST: 'post',         // Get specific post details
  SEARCH: 'search',     // Search r/{subreddit} for {keyword}
};

// =============================================================================
// STATS TRACKING
// =============================================================================

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
    hourlyData: new Array(24).fill(0),
    recentQueries: [],
    lastReset: new Date().toDateString()
  };
}

function saveStats(stats) {
  try {
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (e) { /* ignore */ }
}

function logQuery(result) {
  const stats = loadStats();

  if (stats.lastReset !== new Date().toDateString()) {
    stats.todayQueries = 0;
    stats.hourlyData = new Array(24).fill(0);
    stats.lastReset = new Date().toDateString();
  }

  stats.totalQueries++;
  stats.todayQueries++;
  stats.hourlyData[new Date().getHours()]++;

  if (result.success) {
    stats.successCount++;
  } else {
    stats.errorCount++;
  }

  stats.recentQueries.unshift({
    timestamp: new Date().toISOString(),
    query: result.query,
    success: result.success,
    subreddit: result.subreddit,
    error: result.error
  });
  stats.recentQueries = stats.recentQueries.slice(0, 50);

  saveStats(stats);
}

// =============================================================================
// SAFETY CHECKS
// =============================================================================

function checkSafetyLimits() {
  const stats = loadStats();

  // Check consecutive errors (circuit breaker)
  const recentQueries = stats.recentQueries.slice(0, SAFETY_LIMITS.maxConsecutiveErrors);
  const consecutiveErrors = recentQueries.filter(q => !q.success).length;

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

async function enforceRateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < SAFETY_LIMITS.requestDelayMs) {
    await new Promise(resolve => setTimeout(resolve, SAFETY_LIMITS.requestDelayMs - elapsed));
  }
  lastRequestTime = Date.now();
}

// =============================================================================
// REDDIT API FUNCTIONS
// =============================================================================

/**
 * Fetch subreddit posts
 * @param {string} subreddit - Subreddit name (without r/)
 * @param {string} sort - Sort type (hot, new, top)
 * @param {number} limit - Number of posts (max 100)
 * @returns {Object} Posts data
 */
async function fetchSubreddit(subreddit, sort = 'hot', limit = 10) {
  await enforceRateLimit();

  try {
    const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000
    });

    if (!response.data || !response.data.data) {
      return { error: 'invalid_response', source: 'reddit' };
    }

    const posts = response.data.data.children.map(child => ({
      id: child.data.id,
      title: child.data.title,
      author: child.data.author,
      score: child.data.score,
      upvoteRatio: child.data.upvote_ratio,
      numComments: child.data.num_comments,
      url: child.data.url,
      permalink: `https://reddit.com${child.data.permalink}`,
      createdUtc: child.data.created_utc,
      isSelf: child.data.is_self,
      selftext: child.data.selftext ? child.data.selftext.substring(0, 500) : null,
      domain: child.data.domain,
      thumbnail: child.data.thumbnail
    }));

    return {
      success: true,
      source: 'reddit',
      subreddit,
      sort,
      posts,
      count: posts.length,
      after: response.data.data.after // For pagination
    };
  } catch (error) {
    if (error.response?.status === 404) {
      return { error: 'subreddit_not_found', source: 'reddit' };
    }
    if (error.response?.status === 403) {
      return { error: 'subreddit_private', source: 'reddit' };
    }
    if (error.response?.status === 429) {
      return { error: 'rate_limited', source: 'reddit' };
    }
    return { error: error.message, source: 'reddit' };
  }
}

/**
 * Fetch a specific post with comments
 * @param {string} subreddit - Subreddit name
 * @param {string} postId - Post ID
 * @returns {Object} Post data with comments
 */
async function fetchPost(subreddit, postId) {
  await enforceRateLimit();

  try {
    const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}.json`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000
    });

    if (!response.data || !Array.isArray(response.data)) {
      return { error: 'invalid_response', source: 'reddit' };
    }

    const postData = response.data[0]?.data?.children?.[0]?.data;
    const commentsData = response.data[1]?.data?.children || [];

    if (!postData) {
      return { error: 'post_not_found', source: 'reddit' };
    }

    const comments = commentsData
      .filter(c => c.kind === 't1')
      .slice(0, 20)
      .map(c => ({
        id: c.data.id,
        author: c.data.author,
        body: c.data.body?.substring(0, 500),
        score: c.data.score,
        createdUtc: c.data.created_utc
      }));

    return {
      success: true,
      source: 'reddit',
      post: {
        id: postData.id,
        title: postData.title,
        author: postData.author,
        score: postData.score,
        upvoteRatio: postData.upvote_ratio,
        numComments: postData.num_comments,
        selftext: postData.selftext,
        url: postData.url,
        permalink: `https://reddit.com${postData.permalink}`,
        createdUtc: postData.created_utc
      },
      comments,
      commentCount: comments.length
    };
  } catch (error) {
    return { error: error.message, source: 'reddit' };
  }
}

/**
 * Search a subreddit
 * @param {string} subreddit - Subreddit name
 * @param {string} query - Search query
 * @param {number} limit - Number of results
 * @returns {Object} Search results
 */
async function searchSubreddit(subreddit, query, limit = 10) {
  await enforceRateLimit();

  try {
    const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=on&limit=${limit}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000
    });

    if (!response.data || !response.data.data) {
      return { error: 'invalid_response', source: 'reddit' };
    }

    const posts = response.data.data.children.map(child => ({
      id: child.data.id,
      title: child.data.title,
      author: child.data.author,
      score: child.data.score,
      numComments: child.data.num_comments,
      permalink: `https://reddit.com${child.data.permalink}`,
      createdUtc: child.data.created_utc
    }));

    return {
      success: true,
      source: 'reddit',
      subreddit,
      query,
      posts,
      count: posts.length
    };
  } catch (error) {
    return { error: error.message, source: 'reddit' };
  }
}

// =============================================================================
// QUESTION PARSING
// =============================================================================

/**
 * Parse a natural language question about Reddit
 * @param {string} question - Natural language question
 * @returns {Object} Parsed query parameters
 */
function parseQuestion(question) {
  const result = {
    type: null,
    subreddit: null,
    postId: null,
    keyword: null,
    limit: 10,
    originalQuestion: question
  };

  // Extract subreddit: r/name or "on name" or "from name"
  const subredditPatterns = [
    /r\/([a-zA-Z0-9_]+)/i,
    /(?:on|from|in)\s+([a-zA-Z0-9_]+)\s+(?:subreddit)?/i,
    /subreddit\s+([a-zA-Z0-9_]+)/i
  ];

  for (const pattern of subredditPatterns) {
    const match = question.match(pattern);
    if (match) {
      result.subreddit = match[1];
      break;
    }
  }

  // Detect query type
  const lowerQ = question.toLowerCase();

  if (lowerQ.includes('hot') || lowerQ.includes('trending') || lowerQ.includes('popular')) {
    result.type = QUERY_TYPES.HOT;
  } else if (lowerQ.includes('new') || lowerQ.includes('latest') || lowerQ.includes('recent')) {
    result.type = QUERY_TYPES.NEW;
  } else if (lowerQ.includes('top') || lowerQ.includes('best')) {
    result.type = QUERY_TYPES.TOP;
  } else if (lowerQ.includes('search') || lowerQ.includes('find') || lowerQ.includes('looking for')) {
    result.type = QUERY_TYPES.SEARCH;
    // Extract search keyword
    const searchMatch = question.match(/(?:search|find|looking for)\s+(?:for\s+)?["']?([^"'?]+)["']?/i);
    if (searchMatch) {
      result.keyword = searchMatch[1].trim();
    }
  } else if (lowerQ.includes('post') && question.match(/[a-z0-9]{6,}/i)) {
    result.type = QUERY_TYPES.POST;
    // Extract post ID from URL or raw ID
    const urlMatch = question.match(/comments\/([a-z0-9]+)/i);
    const idMatch = question.match(/\b([a-z0-9]{6,8})\b/i);
    result.postId = urlMatch?.[1] || idMatch?.[1];
  } else {
    // Default to hot
    result.type = QUERY_TYPES.HOT;
  }

  // Extract limit
  const limitMatch = question.match(/(\d+)\s+(?:posts?|results?|items?)/i);
  if (limitMatch) {
    result.limit = Math.min(parseInt(limitMatch[1], 10), 100);
  }

  return result;
}

// =============================================================================
// MAIN ORACLE FUNCTION
// =============================================================================

/**
 * Main oracle function - answer a Reddit question
 * @param {string} question - Natural language question
 * @returns {Object} Oracle response
 */
async function askOracle(question) {
  // SAFETY CHECK
  const safetyCheck = checkSafetyLimits();
  if (!safetyCheck.safe) {
    console.error(`SAFETY RAIL: ${safetyCheck.reason}`);
    return {
      success: false,
      confidence: 0,
      error: safetyCheck.reason,
      message: safetyCheck.message,
      safetyTriggered: true,
      timestamp: new Date().toISOString()
    };
  }

  const parsed = parseQuestion(question);

  if (!parsed.subreddit) {
    const result = {
      success: false,
      confidence: 0,
      error: 'could_not_parse_subreddit',
      suggestion: 'Please include a subreddit name (e.g., r/wallstreetbets) in your question',
      parsed,
      timestamp: new Date().toISOString()
    };
    logQuery(result);
    return result;
  }

  let data;
  let confidence = 0.85; // Base confidence for Reddit data

  switch (parsed.type) {
    case QUERY_TYPES.POST:
      if (!parsed.postId) {
        const result = {
          success: false,
          confidence: 0,
          error: 'could_not_parse_post_id',
          suggestion: 'Please include a post ID or Reddit URL',
          parsed,
          timestamp: new Date().toISOString()
        };
        logQuery(result);
        return result;
      }
      data = await fetchPost(parsed.subreddit, parsed.postId);
      break;

    case QUERY_TYPES.SEARCH:
      if (!parsed.keyword) {
        const result = {
          success: false,
          confidence: 0,
          error: 'could_not_parse_search_keyword',
          suggestion: 'Please include a search term',
          parsed,
          timestamp: new Date().toISOString()
        };
        logQuery(result);
        return result;
      }
      data = await searchSubreddit(parsed.subreddit, parsed.keyword, parsed.limit);
      confidence = 0.80; // Slightly lower for search results
      break;

    case QUERY_TYPES.NEW:
    case QUERY_TYPES.TOP:
    case QUERY_TYPES.HOT:
    default:
      data = await fetchSubreddit(parsed.subreddit, parsed.type, parsed.limit);
      break;
  }

  if (data.error) {
    const result = {
      success: false,
      confidence: 0,
      error: data.error,
      subreddit: parsed.subreddit,
      query: parsed,
      timestamp: new Date().toISOString()
    };
    logQuery(result);
    return result;
  }

  // Calculate engagement metrics for subreddit queries
  if (data.posts && data.posts.length > 0) {
    const totalScore = data.posts.reduce((sum, p) => sum + p.score, 0);
    const totalComments = data.posts.reduce((sum, p) => sum + p.numComments, 0);
    const avgUpvoteRatio = data.posts.reduce((sum, p) => sum + (p.upvoteRatio || 0.5), 0) / data.posts.length;

    data.metrics = {
      totalScore,
      totalComments,
      avgScore: Math.round(totalScore / data.posts.length),
      avgComments: Math.round(totalComments / data.posts.length),
      avgUpvoteRatio: avgUpvoteRatio.toFixed(2),
      engagement: totalScore + totalComments * 2 // Simple engagement formula
    };
  }

  const result = {
    success: true,
    confidence,
    data,
    subreddit: parsed.subreddit,
    queryType: parsed.type,
    query: parsed,
    sources: ['reddit'],
    timestamp: new Date().toISOString()
  };

  logQuery(result);
  return result;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  askOracle,
  fetchSubreddit,
  fetchPost,
  searchSubreddit,
  parseQuestion,
  checkSafetyLimits,
  SAFETY_LIMITS,
  QUERY_TYPES
};

// CLI usage
if (require.main === module) {
  const question = process.argv.slice(2).join(' ') ||
    'What\'s hot on r/wallstreetbets?';

  console.log('\n Reddit Oracle\n');
  console.log(`Question: "${question}"\n`);

  askOracle(question).then(result => {
    console.log('Result:', JSON.stringify(result, null, 2));
  }).catch(err => {
    console.error('Error:', err.message);
  });
}
