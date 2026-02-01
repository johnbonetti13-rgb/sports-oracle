/**
 * Register Reddit Oracle as Paid Agent on Nevermined
 *
 * Creates a payment plan and registers the agent together
 */

import 'dotenv/config';
import { Payments } from '@nevermined-io/payments';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function registerAgent() {
  console.log('Registering Reddit Oracle Agent...\n');

  const apiKey = process.env.NVM_API_KEY;

  if (!apiKey) {
    console.error('NVM_API_KEY not found');
    process.exit(1);
  }

  try {
    const payments = Payments.getInstance({
      nvmApiKey: apiKey,
      environment: process.env.NVM_ENVIRONMENT || 'live',
    });

    const myAddress = payments.accountAddress;
    console.log('Account:', myAddress);
    console.log('\nCreating agent + plan together...');

    // Price config (positional: amount, receiver, tokenAddress)
    const priceConfig = payments.plans.getCryptoPriceConfig(
      50000000n, // 50 USDC (6 decimals) for 1000 queries
      myAddress,
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' // USDC on Base
    );

    // Credits config (positional: creditsGranted, creditsPerRequest)
    const creditsConfig = payments.plans.getFixedCreditsConfig(
      1000n, // 1000 queries per purchase
      1n     // 1 credit per query
    );

    // Agent metadata
    const agentMetadata = {
      name: 'Reddit Oracle',
      Name: 'Reddit Oracle',
      description: 'Analyze Reddit subreddits and posts. Get trending topics, sentiment analysis, engagement metrics. Perfect for market research, trend spotting, and social listening.',
      Description: 'Analyze Reddit subreddits and posts. Get trending topics, sentiment analysis, engagement metrics. Perfect for market research, trend spotting, and social listening.',
      tags: ['reddit', 'oracle', 'social', 'sentiment', 'trends', 'wsb', 'crypto'],
    };

    // Agent API
    const agentApi = {
      endpoints: [
        { POST: 'https://oracles.openclaw.ai/api/reddit' },
      ],
      agentDefinitionUrl: 'https://oracles.openclaw.ai/openapi.json',
    };

    // Plan metadata
    const planMetadata = {
      name: 'Reddit Oracle Queries',
      Name: 'Reddit Oracle Queries',
      description: 'Pay-per-query access to Reddit data and analysis. Each credit = 1 subreddit/post query.',
      Description: 'Pay-per-query access to Reddit data and analysis. Each credit = 1 subreddit/post query.',
      tags: ['reddit', 'oracle', 'social', 'sentiment', 'wsb', 'crypto'],
    };

    // Register both together
    const result = await payments.agents.registerAgentAndPlan(
      agentMetadata,
      agentApi,
      planMetadata,
      priceConfig,
      creditsConfig
    );

    const agentId = result.agentId;
    const planId = result.planId;

    console.log('Agent registered:', agentId);
    console.log('Plan created:', planId);

    // Save IDs to .env
    console.log('\nSaving configuration...');

    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');

    // Add or update Reddit-specific IDs
    if (envContent.includes('NVM_REDDIT_AGENT_ID=')) {
      envContent = envContent.replace(/NVM_REDDIT_AGENT_ID=.*/, `NVM_REDDIT_AGENT_ID=${agentId}`);
    } else {
      envContent += `\nNVM_REDDIT_AGENT_ID=${agentId}`;
    }

    if (envContent.includes('NVM_REDDIT_PLAN_ID=')) {
      envContent = envContent.replace(/NVM_REDDIT_PLAN_ID=.*/, `NVM_REDDIT_PLAN_ID=${planId}`);
    } else {
      envContent += `\nNVM_REDDIT_PLAN_ID=${planId}`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log('Saved to .env');

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('REDDIT ORACLE IS NOW LIVE ON NEVERMINED!');
    console.log('='.repeat(60));
    console.log('\nDetails:');
    console.log(`   Plan ID:  ${planId}`);
    console.log(`   Agent ID: ${agentId}`);
    console.log(`   Price:    $50 for 1000 queries ($0.05/query)`);
    console.log('\nView on Nevermined:');
    console.log(`   https://nevermined.app/agents/${agentId}`);
    console.log('\nUsers can now:');
    console.log('   1. Buy query credits');
    console.log('   2. Query Reddit data');
    console.log('   3. You receive payment automatically!');

    return { planId, agentId };
  } catch (error) {
    console.error('\nRegistration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

registerAgent();
