const { trackedAI } = require('./dist/src/wrappers');
const Database = require('better-sqlite3');
const { join } = require('path');
const os = require('os');

async function run() {
  console.log('Testing trackedAI...');
  
  await trackedAI(
    'anthropic',
    'claude-3.5-sonnet', // use the key from DEFAULT_PRICING
    async () => ({ text: 'Hello world' }), // dummy API call
    (res) => ({ promptTokens: 1000000, completionTokens: 1000000 }), // extractor: 1M tokens each
    'Test notes'
  );
  
  console.log('API call tracked successfully.');
  
  // claude-3.5-sonnet is 3 input, 15 output => cost should be $18.00
  
  const dbPath = join(process.env.CODESESSION_DATA_DIR || join(os.homedir(), '.codesession'), 'sessions.db');
  const db = new Database(dbPath);
  
  const sessions = db.prepare('SELECT * FROM sessions ORDER BY id DESC LIMIT 1').all();
  console.log('Latest session:', sessions[0].name);
  
  const usage = db.prepare('SELECT * FROM ai_usage WHERE session_id = ? ORDER BY id DESC LIMIT 1').all(sessions[0].id);
  console.log('Usage cost:', usage[0].cost);
  
  if (usage[0].cost === 18) {
    console.log('✅ TEST PASSED: Cost calculated correctly based on integrated pricing table.');
  } else {
    console.log('❌ TEST FAILED: Incorrect cost:', usage[0].cost);
  }
}

run().catch(console.error);
