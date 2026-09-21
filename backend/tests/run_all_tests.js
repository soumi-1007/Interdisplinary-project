require('dotenv').config();
const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const soilService = require('../src/Services/soilService');
const mlSoilService = require('../src/Services/mlSoilService');

const authRoutes = require('../src/routes/auth');
const farmerRoutes = require('../src/routes/farmers');
const inventoryRoutes = require('../src/routes/inventory');
const schemeRoutes = require('../src/routes/schemes');
const announcementRoutes = require('../src/routes/announcements');
const warehouseRoutes = require('../src/routes/warehouse');
const chatbotRoutes = require('../src/routes/chatbot');
const dashboardRoutes = require('../src/routes/dashboard');
const staffRoutes = require('../src/routes/staff');
const serviceRequestRoutes = require('../src/routes/serviceRequests');
const distributionRoutes = require('../src/routes/distributions');
const soilRoutes = require('../src/routes/soil');
const iotRoutes = require('../src/routes/iot');

function makeRequest(port, options, postData = null) {
  return new Promise((resolve, reject) => {
    const reqOptions = { hostname: '127.0.0.1', port, ...options };
    const req = http.request(reqOptions, (res) => {
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

async function startTestServer() {
  const app = express();
  app.use(express.json());

  app.use('/api/auth', authRoutes);
  app.use('/api/farmers', farmerRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/schemes', schemeRoutes);
  app.use('/api/announcements', announcementRoutes);
  app.use('/api/warehouse', warehouseRoutes);
  app.use('/api/chatbot', chatbotRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/staff', staffRoutes);
  app.use('/api/serviceRequests', serviceRequestRoutes);
  app.use('/api/distributions', distributionRoutes);
  app.use('/api/soil', soilRoutes);
  app.use('/api/iot', iotRoutes);

  return new Promise((resolve) => {
    const port = process.env.TEST_PORT || 5099;
    const server = app.listen(port, () => {
      console.log(`🚀 Test server listening on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

async function runAll() {
  console.log('Pre-loading soil dataset for fast test execution...');
  await soilService.ensureLoaded();
  
  const server = await startTestServer();

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

  try {
    const token = jwt.sign(
      { id: 'test-user-id', email: 'farmer@smartcoop.test', name: 'Ravi Kumar', role: 'FARMER' },
      'cooperative_secret_key_change_in_production'
    );

    console.log('\n--- TEST 1: Supported Crop + Complete Valid Inputs ---');
    const mlTest1 = mlSoilService.runDecisionEngine({
      Temperature: 28.5,
      Humidity: 75.0,
      Moisture: 68.0,
      N_score: 1.0,
      P_score: 1.0,
      K_score: 1.0,
      district_name: 'Thanjavur',
      CROPS: 'rice'
    });
    assert(mlTest1.supported_crop === true, 'ML Decision Engine identifies rice as supported');
    assert(mlTest1.prediction === 'Suitable', 'CatBoost model predicts "Suitable" for optimal rice parameters');
    assert(mlTest1.confidence > 0.90, `Model confidence is high (${(mlTest1.confidence * 100).toFixed(1)}%)`);

    console.log('\n--- TEST 2: Groundnut + Salem Example (CatBoost & Diagnosis) ---');
    const mlTest2 = mlSoilService.runDecisionEngine({
      Temperature: 35.0,
      Humidity: 40.0,
      Moisture: 30.0,
      N_score: 0.5,
      P_score: 0.0,
      K_score: 0.5,
      district_name: 'Salem',
      CROPS: 'groundnut'
    });
    assert(mlTest2.supported_crop === true, 'ML Engine identifies groundnut as supported');
    assert(mlTest2.prediction === 'Needs Improvement', `CatBoost model predicts "${mlTest2.prediction}"`);
    assert(mlTest2.factors.nitrogen.status === 'Moderate', 'Diagnosis identifies Nitrogen as Moderate');
    assert(mlTest2.factors.phosphorus.status === 'Low', 'Diagnosis identifies Phosphorus as Low');
    assert(mlTest2.factors.potassium.status === 'Moderate', 'Diagnosis identifies Potassium as Moderate');
    assert(mlTest2.factors.humidity.status === 'Below Range', 'Diagnosis identifies Humidity as Below Range');

    console.log('\n--- TEST 3: Unsupported Crop ---');
    const mlTest3 = mlSoilService.runDecisionEngine({
      Temperature: 25.0,
      Humidity: 60.0,
      Moisture: 50.0,
      N_score: 1.0,
      P_score: 1.0,
      K_score: 1.0,
      district_name: 'Salem',
      CROPS: 'avocado_xyz'
    });
    assert(mlTest3.supported_crop === false, 'ML Engine returns supported_crop = false for unsupported crop');

    const testPort = process.env.TEST_PORT || 5099;

    console.log('\n--- TEST 4: Missing Inputs Prompting ---');
    const chatMissing = await makeRequest(testPort, {
      path: '/api/chatbot',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { message: 'Is groundnut suitable for Salem?', language: 'English' });
    assert(chatMissing.status === 200, 'Chatbot missing-input query returns HTTP 200');
    assert(chatMissing.data.response.includes('temperature') || chatMissing.data.response.includes('humidity') || chatMissing.data.response.includes('provide'), 'Chatbot asks for missing numeric ML parameters instead of inventing values');

    console.log('\n--- TEST 5: Existing Cooperative Question ---');
    const chatCoop = await makeRequest(testPort, {
      path: '/api/chatbot',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { message: 'Is urea available?', language: 'English' });
    assert(chatCoop.status === 200 && (chatCoop.data.response.includes('Urea') || chatCoop.data.response.includes('inventory')), 'Chatbot answers existing cooperative query');

    console.log('\n--- TEST 6: General / Gemini Fallback Question ---');
    const chatGen = await makeRequest(testPort, {
      path: '/api/chatbot',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }, { message: 'What is the function of a cooperative society?', language: 'English' });
    assert(chatGen.status === 200 && chatGen.data.response.length > 10, 'General chat returns valid response');

    console.log('\n--- TEST 7: Authentication Protection ---');
    const unauthRes = await makeRequest(testPort, {
      path: '/api/chatbot',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { message: 'Hello' });
    assert(unauthRes.status === 401, 'Unauthenticated request correctly rejected with HTTP 401');

    console.log('\n--- TEST 8: Existing Modules & Soil API Regression ---');
    const soilSuitApi = await makeRequest(testPort, { path: '/api/soil/suitability?crop=groundnut&district=Salem', method: 'GET' });
    assert(soilSuitApi.status === 200 && soilSuitApi.data.success, 'GET /api/soil/suitability still functional');

    console.log('\n================================================================');
    console.log(`COMPLETE INTEGRATION SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

  } finally {
    server.close();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runAll().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
