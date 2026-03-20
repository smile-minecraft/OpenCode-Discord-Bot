/**
 * SDK Event Debug Script
 * 
 * This script connects to the OpenCode SDK and logs the complete structure
 * of all events received during streaming, focusing on message events.
 * 
 * Usage:
 *   npx tsx scripts/debug-sdk-events.ts
 */

import dotenv from 'dotenv';
import { createOpencodeClient, OpencodeClient } from '@opencode-ai/sdk';

// Load environment variables
dotenv.config();

// Configuration
const OPENCODE_API_URL = process.env.OPENCODE_API_URL || 'http://localhost:4096';
const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY || '';

// Simple logging utility
const log = {
  event: (type: string, data: any) => {
    console.log('\n' + '='.repeat(80));
    console.log(`📥 EVENT: ${type}`);
    console.log('='.repeat(80));
    console.log(JSON.stringify(data, null, 2));
  },
  section: (title: string) => {
    console.log('\n' + '#'.repeat(80));
    console.log(`# ${title}`);
    console.log('#'.repeat(80));
  },
  info: (msg: string) => console.log(`ℹ️  ${msg}`),
  error: (msg: string) => console.error(`❌ ${msg}`),
};

interface SDKEvent {
  type: string;
  properties: Record<string, any>;
}

async function main() {
  log.section('Initializing SDK Client');
  
  // Create SDK client
  const client = createOpencodeClient({
    baseUrl: OPENCODE_API_URL,
  });
  
  log.info(`Connected to: ${OPENCODE_API_URL}`);
  
  // Step 1: Create a new session
  log.section('Creating Session');
  
  let sessionId: string;
  try {
    const sessionResult = await client.session.create({
      body: {
        title: 'Debug Session',
      },
      query: {
        directory: process.cwd(),
      },
    });
    
    if (sessionResult.error) {
      log.error(`Session creation error: ${JSON.stringify(sessionResult.error)}`);
      process.exit(1);
    }
    
    sessionId = (sessionResult.data as any).id;
    log.info(`Session created: ${sessionId}`);
  } catch (error) {
    log.error(`Failed to create session: ${error}`);
    process.exit(1);
  }
  
  // Step 2: Subscribe to events
  log.section('Subscribing to Events');
  
  let eventStream: AsyncIterable<SDKEvent>;
  try {
    const subscribeResult = await client.event.subscribe();
    eventStream = subscribeResult.stream as unknown as AsyncIterable<SDKEvent>;
    log.info('Event subscription started');
  } catch (error) {
    log.error(`Failed to subscribe to events: ${error}`);
    process.exit(1);
  }
  
  // Step 3: Start processing events in the background
  log.section('Processing Events');
  
  const iterator = eventStream[Symbol.asyncIterator]();
  let eventCount = 0;
  
  // Process a limited number of events for this test
  const MAX_EVENTS = 100;
  
  // Step 4: Send a simple prompt
  log.section('Sending Prompt');
  
  try {
    await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [
          {
            type: 'text',
            text: 'Say "Hello, this is a test response!" in one sentence.',
          },
        ],
      },
    });
    log.info(`Prompt sent to session: ${sessionId}`);
  } catch (error) {
    log.error(`Failed to send prompt: ${error}`);
    process.exit(1);
  }
  
  // Step 5: Process events
  log.info('Waiting for events... (will process up to 100 events)');
  
  try {
    while (eventCount < MAX_EVENTS) {
      const result = await Promise.race([
        iterator.next(),
        new Promise<IteratorResult<SDKEvent>>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout waiting for events (30s)')), 30000)
        ),
      ]);
      
      if (result.done) {
        log.info('Event stream completed');
        break;
      }
      
      const event = result.value;
      eventCount++;
      
      // Log the complete event structure
      log.event(event.type, event.properties);
      
      // Additional analysis for message events
      const eventType = event.type;
      const props = event.properties;
      
      if (eventType.includes('message')) {
        log.info('\n--- MESSAGE EVENT ANALYSIS ---');
        
        // Check for different content fields
        const contentFields = [
          'content',
          'text',
          'part',
          'delta',
          'message',
          'parts',
          'data',
          'value',
        ];
        
        console.log('\n📋 Content Field Analysis:');
        for (const field of contentFields) {
          if (props[field] !== undefined) {
            console.log(`  ${field}:`, typeof props[field] === 'object' 
              ? JSON.stringify(props[field], null, 2).substring(0, 500)
              : props[field]
            );
          }
        }
        
        // Check for nested structures
        console.log('\n🔍 All Top-Level Keys:');
        console.log(Object.keys(props));
        
        // Deep inspection
        console.log('\n🔬 Deep Inspection:');
        for (const [key, value] of Object.entries(props)) {
          if (value && typeof value === 'object') {
            console.log(`  ${key}:`, JSON.stringify(value).substring(0, 300));
          }
        }
      }
      
      // Stop on session complete
      if (event.type === 'session.ended' || event.type === 'session.idle') {
        log.info(`Session ended with event: ${event.type}`);
        break;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Timeout')) {
      log.info('Timeout reached, ending test');
    } else {
      log.error(`Error processing events: ${error}`);
    }
  }
  
  // Cleanup
  log.section('Cleanup');
  try {
    await client.session.delete({ path: { id: sessionId } });
    log.info(`Session ${sessionId} deleted`);
  } catch (error) {
    log.error(`Failed to delete session: ${error}`);
  }
  
  log.section('Test Complete');
  console.log(`Total events processed: ${eventCount}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
