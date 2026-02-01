/**
 * Register Sports Oracle as Paid Agent on Nevermined
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
  console.log('🏀 Registering Sports Oracle Agent...\n');

  const apiKey = process.env.NVM_API_KEY;

  if (!apiKey) {
    console.error('❌ NVM_API_KEY not found');
    process.exit(1);
  }

  try {
    const payments = Payments.getInstance({
      nvmApiKey: apiKey,
      environment: process.env.NVM_ENVIRONMENT || 'live',
    });

    const myAddress = payments.accountAddress;
    console.log('📧 Account:', myAddress);
    console.log('\n📋 Creating agent + plan together...');

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

    // Agent metadata (API requires both name and Name, description and Description)
    const agentMetadata = {
      name: 'Sports Verification Oracle',
      Name: 'Sports Verification Oracle',
      description: 'Verify sports game results (NBA, NFL, etc.) with confidence scores. Returns winner, scores, and verification confidence. Perfect for prediction markets and betting verification.',
      Description: 'Verify sports game results (NBA, NFL, etc.) with confidence scores. Returns winner, scores, and verification confidence. Perfect for prediction markets and betting verification.',
      tags: ['sports', 'oracle', 'verification', 'polymarket', 'betting'],
    };

    // Agent API
    const agentApi = {
      endpoints: [
        { POST: 'https://sports-oracle.openclaw.ai/api/verify' },
      ],
      agentDefinitionUrl: 'https://sports-oracle.openclaw.ai/openapi.json',
    };

    // Plan metadata
    const planMetadata = {
      name: 'Sports Oracle Queries',
      Name: 'Sports Oracle Queries',
      description: 'Pay-per-query access to verified sports game results. Each credit = 1 verification query.',
      Description: 'Pay-per-query access to verified sports game results. Each credit = 1 verification query.',
      tags: ['sports', 'oracle', 'verification', 'nba', 'nfl', 'betting'],
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

    console.log('✅ Agent registered:', agentId);
    console.log('✅ Plan created:', planId);

    // Save IDs to .env
    console.log('\n💾 Saving configuration...');

    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');

    envContent = envContent.replace(/NVM_AGENT_ID=.*/, `NVM_AGENT_ID=${agentId}`);
    envContent = envContent.replace(/NVM_PLAN_ID=.*/, `NVM_PLAN_ID=${planId}`);

    fs.writeFileSync(envPath, envContent);
    console.log('✅ Saved to .env');

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('🎉 SPORTS ORACLE IS NOW LIVE ON NEVERMINED!');
    console.log('='.repeat(60));
    console.log('\n📊 Details:');
    console.log(`   Plan ID:  ${planId}`);
    console.log(`   Agent ID: ${agentId}`);
    console.log(`   Price:    $50 for 1000 queries ($0.05/query)`);
    console.log('\n🔗 View on Nevermined:');
    console.log(`   https://nevermined.app/agents/${agentId}`);
    console.log('\n💰 Users can now:');
    console.log('   1. Buy query credits');
    console.log('   2. Send verification requests');
    console.log('   3. You receive payment automatically!');

    return { planId, agentId };
  } catch (error) {
    console.error('\n❌ Registration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

registerAgent();
