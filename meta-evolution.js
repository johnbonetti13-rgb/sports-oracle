/**
 * Meta-Evolution Integration for OpenClaw Oracles
 *
 * Logs observations about oracle performance to enable continuous improvement.
 * Integrates with Claude's skill-evolution system.
 */

const fs = require('fs');
const path = require('path');

// Path to skill-evolution observations
const OBSERVATIONS_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE,
  '.claude', 'skill-evolution', 'observations.json'
);

// Thresholds for triggering observations
const THRESHOLDS = {
  lowConfidence: 0.6,          // Log when confidence drops below this
  highErrorRate: 0.3,          // Log when error rate exceeds 30%
  consecutiveErrors: 3,        // Log after 3 consecutive errors
  newPatternCount: 5,          // Log potential new pattern after 5 occurrences
};

// Track patterns for evolution
const patterns = {
  queryTypes: {},              // Count of query type usage
  errors: [],                  // Recent errors for pattern detection
  lowConfidenceQueries: [],    // Queries with low confidence
  successfulPatterns: [],      // Patterns that work well
};

/**
 * Log an observation to the skill-evolution system
 */
function logObservation(observation) {
  try {
    // Ensure directory exists
    const dir = path.dirname(OBSERVATIONS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Load existing observations
    let observations = [];
    if (fs.existsSync(OBSERVATIONS_FILE)) {
      try {
        observations = JSON.parse(fs.readFileSync(OBSERVATIONS_FILE, 'utf8'));
      } catch (e) {
        observations = [];
      }
    }

    // Add new observation
    observations.push({
      ...observation,
      source: 'openclaw-oracles',
      timestamp: new Date().toISOString()
    });

    // Keep last 100 observations
    observations = observations.slice(-100);

    // Save
    fs.writeFileSync(OBSERVATIONS_FILE, JSON.stringify(observations, null, 2));
    console.log('[MetaEvolution] Observation logged:', observation.type);
  } catch (e) {
    console.error('[MetaEvolution] Failed to log observation:', e.message);
  }
}

/**
 * Process a sports oracle result for evolution insights
 */
function processSportsResult(result) {
  // Track query type
  const queryType = result.query?.originalQuestion?.toLowerCase() || 'unknown';
  patterns.queryTypes[queryType] = (patterns.queryTypes[queryType] || 0) + 1;

  // Check for low confidence
  if (result.verified && result.confidence < THRESHOLDS.lowConfidence) {
    patterns.lowConfidenceQueries.push({
      query: result.query,
      confidence: result.confidence,
      timestamp: new Date().toISOString()
    });

    // Log observation if we see a pattern
    if (patterns.lowConfidenceQueries.length >= 3) {
      logObservation({
        type: 'low_confidence_pattern',
        oracle: 'sports',
        count: patterns.lowConfidenceQueries.length,
        samples: patterns.lowConfidenceQueries.slice(-3),
        suggestion: 'Consider adding additional data source for higher confidence'
      });
      patterns.lowConfidenceQueries = []; // Reset
    }
  }

  // Track errors
  if (!result.verified) {
    patterns.errors.push({
      error: result.error,
      query: result.query,
      timestamp: new Date().toISOString()
    });

    // Check for consecutive errors
    if (patterns.errors.length >= THRESHOLDS.consecutiveErrors) {
      // Look for common patterns in errors
      const errorTypes = patterns.errors.map(e => e.error);
      const commonError = findMostCommon(errorTypes);

      logObservation({
        type: 'error_pattern',
        oracle: 'sports',
        errorType: commonError,
        count: patterns.errors.length,
        suggestion: `Investigate recurring "${commonError}" errors`
      });
      patterns.errors = []; // Reset
    }
  } else {
    // Reset error streak on success
    if (patterns.errors.length > 0) {
      patterns.errors = [];
    }

    // Track successful pattern
    patterns.successfulPatterns.push({
      queryType: queryType,
      confidence: result.confidence,
      timestamp: new Date().toISOString()
    });
  }

  // Check for new capability opportunities
  checkForNewCapabilities();
}

/**
 * Process a reddit oracle result for evolution insights
 */
function processRedditResult(result) {
  // Track subreddit usage
  const subreddit = result.subreddit || 'unknown';
  patterns.queryTypes[`reddit:${subreddit}`] = (patterns.queryTypes[`reddit:${subreddit}`] || 0) + 1;

  // Check for frequently queried subreddits
  const subredditCount = patterns.queryTypes[`reddit:${subreddit}`];
  if (subredditCount === THRESHOLDS.newPatternCount) {
    logObservation({
      type: 'popular_subreddit',
      oracle: 'reddit',
      subreddit: subreddit,
      count: subredditCount,
      suggestion: `Consider adding specialized analysis for r/${subreddit}`
    });
  }

  // Track errors
  if (!result.success) {
    patterns.errors.push({
      error: result.error,
      subreddit: subreddit,
      timestamp: new Date().toISOString()
    });

    if (patterns.errors.length >= THRESHOLDS.consecutiveErrors) {
      logObservation({
        type: 'error_pattern',
        oracle: 'reddit',
        errorType: result.error,
        count: patterns.errors.length,
        suggestion: 'Check Reddit API rate limits or endpoint changes'
      });
      patterns.errors = [];
    }
  } else {
    patterns.errors = [];
  }
}

/**
 * Check for opportunities to add new capabilities
 */
function checkForNewCapabilities() {
  // Check if certain query patterns are very common
  for (const [queryType, count] of Object.entries(patterns.queryTypes)) {
    if (count >= THRESHOLDS.newPatternCount * 2) {
      logObservation({
        type: 'high_demand_query',
        queryPattern: queryType,
        count: count,
        suggestion: 'Consider optimizing or caching this query type'
      });
      // Reset to avoid repeated observations
      patterns.queryTypes[queryType] = 0;
    }
  }
}

/**
 * Find most common item in array
 */
function findMostCommon(arr) {
  const counts = {};
  let max = 0;
  let result = arr[0];
  for (const item of arr) {
    counts[item] = (counts[item] || 0) + 1;
    if (counts[item] > max) {
      max = counts[item];
      result = item;
    }
  }
  return result;
}

/**
 * Generate periodic summary observation
 */
function generateSummary(sportsStats, redditStats) {
  const totalQueries = sportsStats.totalQueries + redditStats.totalQueries;
  const totalSuccess = sportsStats.successCount + redditStats.successCount;
  const successRate = totalQueries > 0 ? (totalSuccess / (totalSuccess + sportsStats.errorCount + redditStats.errorCount)) : 0;

  if (totalQueries > 0 && totalQueries % 50 === 0) {
    logObservation({
      type: 'periodic_summary',
      totalQueries,
      sportsQueries: sportsStats.totalQueries,
      redditQueries: redditStats.totalQueries,
      overallSuccessRate: (successRate * 100).toFixed(1) + '%',
      topQueryPatterns: Object.entries(patterns.queryTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
    });
  }
}

/**
 * Log revenue milestone
 */
function logRevenueMilestone(amount) {
  const milestones = [1, 10, 50, 100, 500, 1000];
  const milestone = milestones.find(m => amount >= m && amount < m * 2);

  if (milestone) {
    logObservation({
      type: 'revenue_milestone',
      amount: amount,
      milestone: `$${milestone}`,
      message: `Oracles have earned $${amount.toFixed(2)} in revenue!`
    });
  }
}

module.exports = {
  processSportsResult,
  processRedditResult,
  generateSummary,
  logRevenueMilestone,
  logObservation,
  patterns
};
