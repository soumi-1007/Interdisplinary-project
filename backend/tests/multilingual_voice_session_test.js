const http = require('http');
const jwt = require('jsonwebtoken');

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, text: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runMultilingualVoiceSessionTests() {
  console.log('================================================================');
  console.log('🌐 RUNNING MULTILINGUAL, VOICE & SESSION MEMORY TEST SUITE');
  console.log('================================================================\n');

  const token = jwt.sign(
    { id: 'test-user-id', email: 'farmer@smartcoop.test', name: 'Ravi Kumar', role: 'FARMER' },
    'cooperative_secret_key_change_in_production'
  );

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName} - ${details}`);
      failed++;
    }
  }

  // TEST 1: English Crop Recommendation
  const engRec = await makeRequest({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/chatbot',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  }, { message: 'What crop is suitable in Salem?', language: 'English' });

  assert(engRec.status === 200, 'English Chatbot request returns HTTP 200');
  assert(engRec.data.response.includes('Salem'), 'Response mentions Salem district');
  assert(engRec.data.sessionMemory.lastLanguage === 'English', 'Session memory recorded lastLanguage as English');
  assert(engRec.data.sessionMemory.lastDistrict === 'Salem', 'Session memory recorded lastDistrict as Salem');

  // TEST 2: Session Memory Context (Turn 2: "Groundnut suitable ah?")
  const turn2Res = await makeRequest({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/chatbot',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  }, { 
    message: 'Groundnut suitable ah?', 
    language: 'English',
    sessionMemory: engRec.data.sessionMemory 
  });

  assert(turn2Res.status === 200, 'Session turn 2 request returns HTTP 200');
  assert(turn2Res.data.response.includes('Salem'), 'Turn 2 automatically uses Salem from session memory context');
  assert(turn2Res.data.sessionMemory.lastCrop === 'groundnut', 'Turn 2 updated session memory lastCrop to groundnut');

  // TEST 3: Tamil Crop Recommendation (Explicit Language Selection = Tamil)
  const tamRec = await makeRequest({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/chatbot',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  }, { message: 'Salem la enna crop podalam?', language: 'Tamil' });

  assert(tamRec.status === 200, 'Tanglish query with Tamil language selection returns HTTP 200');
  assert(/[\u0B80-\u0BFF]/.test(tamRec.data.response), 'Response is formatted in Tamil script');
  assert(tamRec.data.sessionMemory.lastLanguage === 'Tamil', 'Session memory recorded lastLanguage as Tamil');
  assert(tamRec.data.sessionMemory.lastDistrict === 'Salem', 'Tanglish query correctly parsed district "Salem"');

  // TEST 4: Direct Tamil Script Query ("என் மண்ணுக்கு எந்த பயிர் ஏற்றது?")
  const tamDirect = await makeRequest({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/chatbot',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  }, { 
    message: 'என் மண்ணுக்கு எந்த பயிர் ஏற்றது?', 
    language: 'Tamil',
    sessionMemory: { lastLanguage: 'Tamil', lastDistrict: 'Salem', lastCrop: null }
  });

  assert(tamDirect.status === 200, 'Direct Tamil question returns HTTP 200');
  assert(/[\u0B80-\u0BFF]/.test(tamDirect.data.response), 'Direct Tamil question produces Tamil response');

  // TEST 5: Tanglish Water Requirement ("Rice ku water requirement evlo?")
  const tangWater = await makeRequest({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/chatbot',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  }, { message: 'Rice ku water requirement evlo?', language: 'English' });

  assert(tangWater.status === 200, 'Tanglish water query returns HTTP 200');
  assert(tangWater.data.response.includes('Water Requirement') || tangWater.data.response.includes('High') || tangWater.data.response.includes('Rice'), 'Tanglish water requirement query processed correctly');

  // TEST 6: Cooperative Query in Tamil ("உரம் கையிருப்பு உள்ளதா?")
  const coopTam = await makeRequest({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/chatbot',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  }, { message: 'உரம் கையிருப்பு உள்ளதா?', language: 'Tamil' });

  assert(coopTam.status === 200, 'Cooperative fertilizer query in Tamil returns HTTP 200');
  assert(/[\u0B80-\u0BFF]/.test(coopTam.data.response), 'Cooperative query responded in Tamil');

  // TEST 7: Authentication Protection Verification
  const unauthRes = await makeRequest({
    hostname: '127.0.0.1',
    port: 5000,
    path: '/api/chatbot',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { message: 'Hello' });

  assert(unauthRes.status === 401, 'Unauthenticated request correctly rejected with HTTP 401');

  console.log('\n================================================================');
  console.log(`MULTILINGUAL & VOICE SESSION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runMultilingualVoiceSessionTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
