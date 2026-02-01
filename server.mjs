/**
 * Sports Oracle - Payment-Gated API Server
 *
 * Validates Nevermined x402 access tokens before processing queries.
 * Each query deducts 1 credit from the subscriber's balance.
 */

import 'dotenv/config';
import { createServer } from 'http';
import { Payments } from '@nevermined-io/payments';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sportsOracle = require('./oracle.js');
const redditOracle = require('./reddit-oracle.js');
const metaEvolution = require('./meta-evolution.js');

const PORT = process.env.PORT || 3000;

// Sports Oracle IDs
const SPORTS_PLAN_ID = process.env.NVM_PLAN_ID;
const SPORTS_AGENT_ID = process.env.NVM_AGENT_ID;

// Reddit Oracle IDs (set after registration)
const REDDIT_PLAN_ID = process.env.NVM_REDDIT_PLAN_ID;
const REDDIT_AGENT_ID = process.env.NVM_REDDIT_AGENT_ID;

// Initialize Nevermined Payments
let payments;
try {
  payments = Payments.getInstance({
    nvmApiKey: process.env.NVM_API_KEY,
    environment: process.env.NVM_ENVIRONMENT || 'live',
  });
  console.log('Nevermined SDK initialized');
  console.log('Account:', payments.accountAddress);
} catch (err) {
  console.error('Failed to initialize Nevermined:', err.message);
  process.exit(1);
}

/**
 * Build x402 PaymentRequired object for verification
 */
function buildPaymentRequired(endpoint, httpVerb, planId, agentId) {
  return {
    x402Version: 2,
    resource: { url: endpoint },
    accepts: [{
      scheme: 'nvm:erc4337',
      network: 'eip155:8453', // Base mainnet
      planId,
      extra: { agentId, httpVerb }
    }],
    extensions: {}
  };
}

/**
 * Parse JSON body from request
 */
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

/**
 * Main request handler
 */
async function handleRequest(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, payment-signature');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === '/health') {
    return sendJSON(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
  }

  // OpenAPI spec
  if (url.pathname === '/openapi.json') {
    return sendJSON(res, 200, {
      openapi: '3.0.0',
      info: {
        title: 'OpenClaw Oracles API',
        version: '1.0.0',
        description: 'Payment-gated oracle APIs for Sports and Reddit data. Requires Nevermined credits.'
      },
      servers: [{ url: 'https://oracles.openclaw.ai' }],
      paths: {
        '/api/verify': {
          post: {
            summary: 'Verify a sports game result',
            description: 'Query the oracle to verify who won a sports game. Costs 1 credit per query.',
            tags: ['Sports Oracle'],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      question: { type: 'string', example: 'Who won the Lakers game on 2026-01-30?' }
                    },
                    required: ['question']
                  }
                }
              }
            },
            responses: {
              '200': { description: 'Verification result with confidence score' },
              '402': { description: 'Payment required - include x402 access token' },
              '401': { description: 'Invalid or insufficient credits' }
            }
          }
        },
        '/api/reddit': {
          post: {
            summary: 'Query Reddit data',
            description: 'Fetch and analyze Reddit subreddit data. Costs 1 credit per query.',
            tags: ['Reddit Oracle'],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      question: { type: 'string', example: 'What\'s hot on r/wallstreetbets?' }
                    },
                    required: ['question']
                  }
                }
              }
            },
            responses: {
              '200': { description: 'Reddit data with engagement metrics' },
              '402': { description: 'Payment required - include x402 access token' },
              '401': { description: 'Invalid or insufficient credits' }
            }
          }
        }
      }
    });
  }

  // Sports Oracle endpoint
  if (url.pathname === '/api/verify' && req.method === 'POST') {
    return handleOracleRequest(req, res, {
      oracle: sportsOracle,
      planId: SPORTS_PLAN_ID,
      agentId: SPORTS_AGENT_ID,
      endpoint: '/api/verify',
      name: 'Sports'
    });
  }

  // Reddit Oracle endpoint
  if (url.pathname === '/api/reddit' && req.method === 'POST') {
    return handleOracleRequest(req, res, {
      oracle: redditOracle,
      planId: REDDIT_PLAN_ID || SPORTS_PLAN_ID, // Fallback to sports if reddit not registered
      agentId: REDDIT_AGENT_ID || SPORTS_AGENT_ID,
      endpoint: '/api/reddit',
      name: 'Reddit'
    });
  }

  // 404 for unknown routes
  sendJSON(res, 404, { error: 'not_found', message: 'Unknown endpoint' });
}

/**
 * Generic oracle request handler
 */
async function handleOracleRequest(req, res, config) {
  const { oracle, planId, agentId, endpoint, name } = config;

  // Get x402 access token from header
  const x402Token = req.headers['payment-signature'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!x402Token) {
    return sendJSON(res, 402, {
      error: 'payment_required',
      message: `This API requires Nevermined credits. Include x402 access token in payment-signature header.`,
      planId,
      agentId,
      pricePerQuery: '$0.05',
      purchaseUrl: `https://nevermined.app/agents/${agentId}`
    });
  }

  // Parse request body
  let body;
  try {
    body = await parseBody(req);
  } catch (e) {
    return sendJSON(res, 400, { error: 'invalid_json', message: 'Request body must be valid JSON' });
  }

  if (!body.question) {
    return sendJSON(res, 400, { error: 'missing_question', message: 'Request must include a "question" field' });
  }

  // Build payment requirement
  const paymentRequired = buildPaymentRequired(endpoint, 'POST', planId, agentId);

  // Verify subscriber has credits
  let verification;
  try {
    verification = await payments.facilitator.verifyPermissions({
      paymentRequired,
      x402AccessToken: x402Token,
      maxAmount: 1n
    });

    if (!verification.isValid) {
      return sendJSON(res, 401, {
        error: 'insufficient_credits',
        message: 'Access token is invalid or you have insufficient credits',
        purchaseUrl: `https://nevermined.app/agents/${agentId}`
      });
    }
  } catch (err) {
    console.error(`${name} verification error:`, err.message);
    return sendJSON(res, 401, {
      error: 'verification_failed',
      message: err.message || 'Failed to verify access token',
      purchaseUrl: `https://nevermined.app/agents/${agentId}`
    });
  }

  // Process the oracle query
  console.log(`[${name}] Processing paid query: "${body.question}"`);
  let oracleResult;
  try {
    oracleResult = await oracle.askOracle(body.question);
  } catch (err) {
    console.error(`${name} oracle error:`, err.message);
    return sendJSON(res, 500, {
      error: 'oracle_error',
      message: 'Failed to process query',
      details: err.message
    });
  }

  // Meta-evolution: Log result for continuous improvement
  try {
    if (name === 'Sports') {
      metaEvolution.processSportsResult(oracleResult);
    } else if (name === 'Reddit') {
      metaEvolution.processRedditResult(oracleResult);
    }
  } catch (e) {
    console.log('[MetaEvolution] Logging failed:', e.message);
  }

  // Settle (burn) the credits after successful query
  try {
    const settlement = await payments.facilitator.settlePermissions({
      paymentRequired,
      x402AccessToken: x402Token,
      maxAmount: 1n
    });

    console.log(`[${name}] Credits settled:`, settlement);
    oracleResult.payment = {
      creditsUsed: 1,
      txHash: settlement.txHash,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    console.error(`${name} settlement error:`, err.message);
    oracleResult.payment = {
      creditsUsed: 0,
      error: 'settlement_failed',
      message: err.message
    };
  }

  return sendJSON(res, 200, oracleResult);
}

// Create and start server
const server = createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`\n=== OpenClaw Oracles API ===`);
  console.log(`Running on port ${PORT}\n`);

  console.log(`Sports Oracle:`);
  console.log(`  Plan ID: ${SPORTS_PLAN_ID}`);
  console.log(`  Agent ID: ${SPORTS_AGENT_ID}`);

  console.log(`\nReddit Oracle:`);
  console.log(`  Plan ID: ${REDDIT_PLAN_ID || '(not registered)'}`);
  console.log(`  Agent ID: ${REDDIT_AGENT_ID || '(not registered)'}`);

  console.log(`\nEndpoints:`);
  console.log(`  GET  /health       - Health check`);
  console.log(`  GET  /openapi.json - API specification`);
  console.log(`  POST /api/verify   - Sports Oracle (requires payment)`);
  console.log(`  POST /api/reddit   - Reddit Oracle (requires payment)`);

  console.log(`\nTest commands:`);
  console.log(`  curl -X POST http://localhost:${PORT}/api/verify -H "Content-Type: application/json" -d '{"question": "Who won the Lakers game yesterday?"}'`);
  console.log(`  curl -X POST http://localhost:${PORT}/api/reddit -H "Content-Type: application/json" -d '{"question": "What is hot on r/wallstreetbets?"}'`);
});
