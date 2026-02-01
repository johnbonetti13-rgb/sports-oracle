/**
 * OpenClaw Oracles Dashboard
 * Real-time tracking for Sports and Reddit oracles
 */

// Configuration
const CONFIG = {
  pricePerQuery: 0.05, // $0.05 per query
  refreshInterval: 30000, // 30 seconds
};

// State
let sportsStats = {
  totalQueries: 0,
  todayQueries: 0,
  successCount: 0,
  errorCount: 0,
  confidenceSum: 0,
  hourlyData: new Array(24).fill(0),
  recentQueries: [],
  lastReset: null
};

let redditStats = {
  totalQueries: 0,
  todayQueries: 0,
  successCount: 0,
  errorCount: 0,
  confidenceSum: 0,
  hourlyData: new Array(24).fill(0),
  recentQueries: [],
  lastReset: null
};

// Fetch stats from server API
async function fetchStats() {
  try {
    // Fetch sports stats
    const sportsResponse = await fetch('/api/stats/sports');
    if (sportsResponse.ok) {
      const data = await sportsResponse.json();
      sportsStats = { ...sportsStats, ...data };
    }
  } catch (e) {
    console.log('Sports stats fetch failed:', e.message);
  }

  try {
    // Fetch reddit stats
    const redditResponse = await fetch('/api/stats/reddit');
    if (redditResponse.ok) {
      const data = await redditResponse.json();
      redditStats = { ...redditStats, ...data };
    }
  } catch (e) {
    console.log('Reddit stats fetch failed:', e.message);
  }

  updateUI();
}

// Load stats from localStorage (fallback)
function loadStats() {
  const savedSports = localStorage.getItem('sports-oracle-stats');
  if (savedSports) {
    try {
      sportsStats = { ...sportsStats, ...JSON.parse(savedSports) };
    } catch (e) { console.error('Failed to parse sports stats:', e); }
  }

  const savedReddit = localStorage.getItem('reddit-oracle-stats');
  if (savedReddit) {
    try {
      redditStats = { ...redditStats, ...JSON.parse(savedReddit) };
    } catch (e) { console.error('Failed to parse reddit stats:', e); }
  }

  // Also try to fetch from server
  fetchStats();
}

// Save stats to localStorage
function saveStats() {
  localStorage.setItem('sports-oracle-stats', JSON.stringify(sportsStats));
  localStorage.setItem('reddit-oracle-stats', JSON.stringify(redditStats));
}

// Format numbers with commas
function formatNumber(num) {
  return num.toLocaleString();
}

// Format currency
function formatCurrency(amount) {
  return '$' + amount.toFixed(2);
}

// Update dashboard UI
function updateUI() {
  // Combined totals
  const totalQueries = sportsStats.totalQueries + redditStats.totalQueries;
  const todayQueries = sportsStats.todayQueries + redditStats.todayQueries;
  const totalSuccess = sportsStats.successCount + redditStats.successCount;
  const totalErrors = sportsStats.errorCount + redditStats.errorCount;

  // Total queries
  document.getElementById('total-queries').textContent = formatNumber(totalQueries);

  // Today's queries
  document.getElementById('today-queries').textContent = formatNumber(todayQueries);
  document.getElementById('today-breakdown').textContent =
    `Sports: ${sportsStats.todayQueries} | Reddit: ${redditStats.todayQueries}`;

  // Success rate
  const total = totalSuccess + totalErrors;
  const successRate = total > 0 ? ((totalSuccess / total) * 100).toFixed(1) : '--';
  document.getElementById('success-rate').textContent = successRate !== '--' ? successRate + '%' : '--';

  // Revenue
  const revenue = totalQueries * CONFIG.pricePerQuery;
  document.getElementById('revenue').textContent = formatCurrency(revenue);

  // Sports-specific
  document.getElementById('sports-queries').textContent = formatNumber(sportsStats.totalQueries);
  const sportsConfidence = sportsStats.successCount > 0
    ? ((sportsStats.confidenceSum / sportsStats.successCount) * 100).toFixed(0)
    : '--';
  document.getElementById('sports-confidence').textContent = sportsConfidence !== '--' ? sportsConfidence + '%' : '--';

  // Reddit-specific
  document.getElementById('reddit-queries').textContent = formatNumber(redditStats.totalQueries);
  const redditConfidence = redditStats.successCount > 0
    ? ((redditStats.confidenceSum / redditStats.successCount) * 100).toFixed(0)
    : '--';
  document.getElementById('reddit-confidence').textContent = redditConfidence !== '--' ? redditConfidence + '%' : '--';

  // Last updated
  document.getElementById('last-update').textContent = new Date().toLocaleTimeString();

  // Update chart
  updateChart();
}

// Update hourly chart with stacked bars
function updateChart() {
  const chart = document.getElementById('chart');
  chart.innerHTML = '';

  // Find max for scaling
  let maxVal = 1;
  for (let i = 0; i < 24; i++) {
    const combined = (sportsStats.hourlyData[i] || 0) + (redditStats.hourlyData[i] || 0);
    if (combined > maxVal) maxVal = combined;
  }

  for (let i = 0; i < 24; i++) {
    const group = document.createElement('div');
    group.className = 'bar-group';
    group.title = `${i}:00`;

    const sportsVal = sportsStats.hourlyData[i] || 0;
    const redditVal = redditStats.hourlyData[i] || 0;

    const sportsBar = document.createElement('div');
    sportsBar.className = 'bar sports';
    sportsBar.style.height = Math.max((sportsVal / maxVal) * 150, 4) + 'px';
    sportsBar.title = `Sports: ${sportsVal}`;

    const redditBar = document.createElement('div');
    redditBar.className = 'bar reddit';
    redditBar.style.height = Math.max((redditVal / maxVal) * 150, 4) + 'px';
    redditBar.title = `Reddit: ${redditVal}`;

    group.appendChild(sportsBar);
    group.appendChild(redditBar);
    chart.appendChild(group);
  }
}

// Add activity item to feed
function addActivity(type, title, meta) {
  const icons = {
    sports: '🏀',
    reddit: '📱',
    success: '✅',
    error: '❌',
    payment: '💰'
  };

  const feed = document.getElementById('activity-feed');
  const item = document.createElement('div');
  item.className = 'activity-item';
  item.innerHTML = `
    <div class="activity-icon ${type}">${icons[type] || '📌'}</div>
    <div class="activity-content">
      <div class="activity-title">${title}</div>
      <div class="activity-meta">${meta}</div>
    </div>
  `;
  feed.insertBefore(item, feed.firstChild);

  // Keep feed manageable
  while (feed.children.length > 20) {
    feed.removeChild(feed.lastChild);
  }
}

// Record a sports query
window.recordSportsQuery = function(result) {
  sportsStats.totalQueries++;
  sportsStats.todayQueries++;

  const hour = new Date().getHours();
  sportsStats.hourlyData[hour]++;

  if (result.verified) {
    sportsStats.successCount++;
    sportsStats.confidenceSum += result.confidence || 0.75;
    addActivity('sports', `Verified: ${result.result?.winner || 'Game result'}`,
      `Confidence: ${((result.confidence || 0.75) * 100).toFixed(0)}%`);
  } else {
    sportsStats.errorCount++;
    addActivity('error', `Sports query failed: ${result.error || 'Unknown'}`,
      result.query?.team || 'Unknown team');
  }

  saveStats();
  updateUI();
};

// Record a reddit query
window.recordRedditQuery = function(result) {
  redditStats.totalQueries++;
  redditStats.todayQueries++;

  const hour = new Date().getHours();
  redditStats.hourlyData[hour]++;

  if (result.success) {
    redditStats.successCount++;
    redditStats.confidenceSum += result.confidence || 0.85;
    addActivity('reddit', `Fetched: r/${result.subreddit || 'unknown'}`,
      `${result.data?.count || 0} items`);
  } else {
    redditStats.errorCount++;
    addActivity('error', `Reddit query failed: ${result.error || 'Unknown'}`,
      result.subreddit || 'Unknown subreddit');
  }

  saveStats();
  updateUI();
};

// Record a payment
window.recordPayment = function(oracle, amount) {
  addActivity('payment', `Payment received: ${oracle}`,
    `${formatCurrency(amount)}`);
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  updateUI();

  // Auto-refresh
  setInterval(() => {
    fetchStats();
  }, CONFIG.refreshInterval);

  console.log('OpenClaw Oracles Dashboard initialized');
  console.log('Call window.recordSportsQuery(result) or window.recordRedditQuery(result) to log queries');
});

// Export for Node.js usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    recordSportsQuery: window.recordSportsQuery,
    recordRedditQuery: window.recordRedditQuery,
    sportsStats,
    redditStats
  };
}
