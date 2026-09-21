const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const prisma = require('../config/database');
const { auth, authorize } = require('../middleware/auth');
const soilService = require('../Services/soilService');
const mlSoilService = require('../Services/mlSoilService');

const router = express.Router();

// Initialize Gemini (fallback to dummy key if not configured to avoid startup crash)
const apiKey = process.env.GEMINI_API_KEY === 'your_gemini_api_key_here' ? '' : (process.env.GEMINI_API_KEY || '');
let genAI = null;
if (apiKey) {
  try {
    genAI = new GoogleGenerativeAI(apiKey);
  } catch (err) {
    console.error('Failed to initialize GoogleGenerativeAI:', err);
  }
}

// Helper: Check if text contains Tamil characters
function isTamilText(text) {
  return /[\u0B80-\u0BFF]/.test(text);
}

// Helper: Extract district from text or aliases
function extractDistrictFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.toLowerCase();
  for (const [alias, standard] of Object.entries(soilService.districtAliases)) {
    const regex = new RegExp(`\\b${alias}\\b`, 'i');
    if (regex.test(clean) || clean.includes(alias)) {
      return standard;
    }
  }
  for (const d of soilService.districtsSet) {
    const regex = new RegExp(`\\b${d.toLowerCase()}\\b`, 'i');
    if (regex.test(clean) || clean.includes(d.toLowerCase())) {
      return d;
    }
  }
  return null;
}

// Helper: Extract crop from text or aliases
function extractCropFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.toLowerCase();
  
  const wordsToSkip = new Set(['crop', 'crops', 'பயிர்', 'பயிர்கள்', 'plant', 'soil', 'suitable', 'best', 'ennu', 'enna']);

  for (const [alias, standard] of Object.entries(soilService.cropAliases)) {
    if (wordsToSkip.has(alias.toLowerCase())) continue;
    const regex = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(clean)) {
      return standard;
    }
  }

  for (const c of soilService.cropsSet) {
    if (wordsToSkip.has(c.toLowerCase())) continue;
    const regex = new RegExp(`\\b${c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(clean)) {
      return c;
    }
  }

  return null;
}

// Multi-turn Prediction Session State Handler
function processPredictionSession(query, sessionMemory, isTamil) {
  const clean = query.toLowerCase();
  
  // Check if user explicitly requests to reuse previous values
  const isExplicitReuse = /use\s+(?:my\s+)?previous\s+values|reuse\s+previous|old\s+values|முந்தைய\s+அளவீடுகளை/i.test(query);

  const isPredictionQuery = /suitable|suitability|verdict|score|improve|why|can\s+i\s+grow|grow|suitable\s+ah|suitablea|ஏற்றதா|பயிரிடலாமா/i.test(query);

  let currentSession = null;

  if (isExplicitReuse && sessionMemory?.lastCompletedInputs) {
    currentSession = { ...sessionMemory.lastCompletedInputs };
  } else if (sessionMemory?.predictionSession && !isPredictionQuery) {
    currentSession = { ...sessionMemory.predictionSession };
  } else {
    // New prediction request -> fresh state without stale numeric measurements!
    const prevDistrict = sessionMemory?.predictionSession?.district_name || sessionMemory?.lastDistrict;
    const prevCrop = sessionMemory?.predictionSession?.CROPS || sessionMemory?.lastCrop;

    currentSession = {
      district_name: extractDistrictFromText(query) || prevDistrict || null,
      CROPS: extractCropFromText(query) || prevCrop || null,
      Temperature: null,
      Humidity: null,
      Moisture: null,
      N_score: null,
      P_score: null,
      K_score: null
    };
  }

  // Extract District & Crop if mentioned in current message
  const detectedDist = extractDistrictFromText(query);
  const detectedCrop = extractCropFromText(query);
  if (detectedDist) currentSession.district_name = detectedDist;
  if (detectedCrop) currentSession.CROPS = detectedCrop;

  // Extract Numeric Measurements
  const tempMatch = query.match(/(?:temperature|temp\b|temperature\s*is|temp\s*[:=])\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  const humMatch = query.match(/(?:humidity|hum\b|humidity\s*is|hum\s*[:=])\s*[:=]?\s*(\d+(?:\.\d+)?)/i);
  const moistMatch = query.match(/(?:moisture|moist\b|moisture\s*is|moist\s*[:=])\s*[:=]?\s*(\d+(?:\.\d+)?)/i);

  const nScoreMatch = query.match(/(?:n_score|n\s*score|nitrogen\s*score|n\s*val|nitrogen\s*val|n\s*is|nitrogen\s*is|nitrogen)\s*[:=]?\s*(1\.0|0\.5|0\.0|1|0|\d+(?:\.\d+)?)/i);
  const pScoreMatch = query.match(/(?:p_score|p\s*score|phosphorus\s*score|p\s*val|phosphorus\s*val|p\s*is|phosphorus\s*is|phosphorus)\s*[:=]?\s*(1\.0|0\.5|0\.0|1|0|\d+(?:\.\d+)?)/i);
  const kScoreMatch = query.match(/(?:k_score|k\s*score|potassium\s*score|k\s*val|potassium\s*val|k\s*is|potassium\s*is|potassium)\s*[:=]?\s*(1\.0|0\.5|0\.0|1|0|\d+(?:\.\d+)?)/i);

  const npkScoresMatch = query.match(/npk\s*(?:scores|score|is|=|:)?\s*(\d+(?:\.\d+)?)\s*[,:\s]\s*(\d+(?:\.\d+)?)\s*[,:\s]\s*(\d+(?:\.\d+)?)/i);

  if (tempMatch) currentSession.Temperature = parseFloat(tempMatch[1]);
  if (humMatch) currentSession.Humidity = parseFloat(humMatch[1]);
  if (moistMatch) currentSession.Moisture = parseFloat(moistMatch[1]);

  if (nScoreMatch) currentSession.N_score = parseFloat(nScoreMatch[1]);
  else if (npkScoresMatch) currentSession.N_score = parseFloat(npkScoresMatch[1]);

  if (pScoreMatch) currentSession.P_score = parseFloat(pScoreMatch[1]);
  else if (npkScoresMatch) currentSession.P_score = parseFloat(npkScoresMatch[2]);

  if (kScoreMatch) currentSession.K_score = parseFloat(kScoreMatch[1]);
  else if (npkScoresMatch) currentSession.K_score = parseFloat(npkScoresMatch[3]);

  // Keyword score fallbacks
  if (currentSession.N_score === null && /nitrogen\s+(?:is\s+)?low/i.test(query)) currentSession.N_score = 0.0;
  if (currentSession.N_score === null && /nitrogen\s+(?:is\s+)?moderate/i.test(query)) currentSession.N_score = 0.5;
  if (currentSession.N_score === null && /nitrogen\s+(?:is\s+)?suitable/i.test(query)) currentSession.N_score = 1.0;

  if (currentSession.P_score === null && /phosphorus\s+(?:is\s+)?low/i.test(query)) currentSession.P_score = 0.0;
  if (currentSession.P_score === null && /phosphorus\s+(?:is\s+)?moderate/i.test(query)) currentSession.P_score = 0.5;
  if (currentSession.P_score === null && /phosphorus\s+(?:is\s+)?suitable/i.test(query)) currentSession.P_score = 1.0;

  if (currentSession.K_score === null && /potassium\s+(?:is\s+)?low/i.test(query)) currentSession.K_score = 0.0;
  if (currentSession.K_score === null && /potassium\s+(?:is\s+)?moderate/i.test(query)) currentSession.K_score = 0.5;
  if (currentSession.K_score === null && /potassium\s+(?:is\s+)?suitable/i.test(query)) currentSession.K_score = 1.0;

  // Identify missing fields
  const missing = [];
  if (!currentSession.CROPS) missing.push(isTamil ? 'பயிர் (Crop)' : 'Crop');
  if (!currentSession.district_name) missing.push(isTamil ? 'மாவட்டம் (District)' : 'District');
  if (currentSession.Temperature === null || isNaN(currentSession.Temperature)) missing.push(isTamil ? 'வெப்பநிலை (Temperature)' : 'Temperature');
  if (currentSession.Humidity === null || isNaN(currentSession.Humidity)) missing.push(isTamil ? 'காற்றின் ஈரப்பதம் (Humidity)' : 'Humidity');
  if (currentSession.Moisture === null || isNaN(currentSession.Moisture)) missing.push(isTamil ? 'மண் ஈரப்பதம் (Moisture)' : 'Moisture');
  if (currentSession.N_score === null || isNaN(currentSession.N_score)) missing.push(isTamil ? 'நைட்ரஜன் அளவு (N score)' : 'N score');
  if (currentSession.P_score === null || isNaN(currentSession.P_score)) missing.push(isTamil ? 'பாஸ்பரஸ் அளவு (P score)' : 'P score');
  if (currentSession.K_score === null || isNaN(currentSession.K_score)) missing.push(isTamil ? 'பொட்டாசியம் அளவு (K score)' : 'K score');

  return {
    isComplete: missing.length === 0,
    missingFields: missing,
    session: currentSession,
    isExplicitReuse
  };
}

// Farmer-Friendly Result Formatter (Omit confidence, accuracy, CatBoost technical terms)
function formatFarmerResponse(mlResult, sessionData, isTamil) {
  const rawCrop = mlResult.crop || sessionData.CROPS || 'Crop';
  const cropName = rawCrop.charAt(0).toUpperCase() + rawCrop.slice(1);
  const distName = sessionData.district_name || 'Salem';
  const verdict = mlResult.prediction;

  const goodFactors = [];
  const improveFactors = [];

  const factors = mlResult.factors || {};

  if (factors.temperature) {
    if (factors.temperature.status === 'Suitable') {
      goodFactors.push(isTamil ? '• வெப்பநிலை: ஏற்றது' : '• Temperature: Suitable');
    } else {
      improveFactors.push(isTamil ? '• காற்றின் வெப்பநிலை உகந்த அளவை விட வேறுபட்டுள்ளது.' : '• Temperature is outside the preferred level for this crop.');
    }
  }

  if (factors.humidity) {
    if (factors.humidity.status === 'Suitable') {
      goodFactors.push(isTamil ? '• காற்றின் ஈரப்பதம்: ஏற்றது' : '• Humidity: Suitable');
    } else {
      improveFactors.push(isTamil ? '• காற்றின் ஈரப்பதம் குறைவாக உள்ளது.' : '• Humidity is lower than the preferred level for this crop.');
    }
  }

  if (factors.moisture) {
    if (factors.moisture.status === 'Suitable') {
      goodFactors.push(isTamil ? '• மண் ஈரப்பதம்: ஏற்றது' : '• Moisture: Suitable');
    } else {
      improveFactors.push(isTamil ? '• மண் ஈரப்பதம் குறைவாக உள்ளது.' : '• Moisture level is low for this crop.');
    }
  }

  if (factors.nitrogen) {
    if (factors.nitrogen.status === 'Suitable') {
      goodFactors.push(isTamil ? '• நைட்ரஜன்: ஏற்றது' : '• Nitrogen: Suitable');
    } else if (factors.nitrogen.status === 'Moderate') {
      goodFactors.push(isTamil ? '• நைட்ரஜன்: மிதமான அளவில் உள்ளது' : '• Nitrogen: Moderate');
    } else {
      improveFactors.push(isTamil ? '• நைட்ரஜன் அளவு குறைவாக உள்ளது.' : '• Nitrogen is low.');
    }
  }

  if (factors.phosphorus) {
    if (factors.phosphorus.status === 'Suitable') {
      goodFactors.push(isTamil ? '• பாஸ்பரஸ்: ஏற்றது' : '• Phosphorus: Suitable');
    } else if (factors.phosphorus.status === 'Moderate') {
      goodFactors.push(isTamil ? '• பாஸ்பரஸ்: மிதமான அளவில் உள்ளது' : '• Phosphorus: Moderate');
    } else {
      improveFactors.push(isTamil ? '• பாஸ்பரஸ் அளவு குறைவாக உள்ளது.' : '• Phosphorus is low.');
    }
  }

  if (factors.potassium) {
    if (factors.potassium.status === 'Suitable') {
      goodFactors.push(isTamil ? '• பொட்டாசியம்: ஏற்றது' : '• Potassium: Suitable');
    } else if (factors.potassium.status === 'Moderate') {
      goodFactors.push(isTamil ? '• பொட்டாசியம்: மிதமான அளவில் உள்ளது' : '• Potassium: Moderate');
    } else {
      improveFactors.push(isTamil ? '• பொட்டாசியம் அளவு குறைவாக உள்ளது.' : '• Potassium is low.');
    }
  }

  const suggestions = mlResult.suggestions || [];
  const cleanSuggestions = suggestions.map(s => {
    if (s.includes('humidity')) return isTamil ? '• காற்றின் ஈரப்பதத்தை முடிந்தவரை உகந்த அளவில் பராமரிக்கவும்.' : '• Manage growing conditions to improve humidity where feasible.';
    if (s.includes('nitrogen') || s.includes('phosphorus') || s.includes('potassium') || s.includes('nutrient')) {
      return isTamil ? '• மண் பரிசோதனை பரிந்துரைகளின்படி உரங்களை பயன்படுத்தவும்.' : '• Improve nutrient availability based on soil-test recommendations.';
    }
    return `• ${s}`;
  });

  const uniqueSuggestions = Array.from(new Set(cleanSuggestions));

  let responseText = '';
  let ttsText = '';

  if (isTamil) {
    responseText = `🌱 **மண் மற்றும் பயிர் பொருத்தம்**

**பயிர்:** ${cropName}
**மாவட்டம்:** ${distName}

**முடிவு:**
${verdict === 'Suitable' ? 'ஏற்றது' : verdict === 'Needs Improvement' ? 'மேம்படுத்த வேண்டும்' : 'ஏற்றதல்ல'}

**நன்றாக உள்ளவை:**
${goodFactors.length > 0 ? goodFactors.join('\n') : '• தகவல்கள் பகுப்பாய்வு செய்யப்பட்டன.'}

**மேம்படுத்த வேண்டியவை:**
${improveFactors.length > 0 ? improveFactors.join('\n') : '• அனைத்து அளவீடுகளும் உகந்த நிலையில் உள்ளன.'}

**நீங்கள் செய்யக்கூடியவை:**
${uniqueSuggestions.join('\n')}`;

    ttsText = `${distName} மாவட்டத்தில் ${cropName} பயிருக்கு ` +
              (verdict === 'Suitable' ? 'நிலம் மிகவும் ஏற்றது. ' : verdict === 'Needs Improvement' ? 'சில மேம்பாடுகள் தேவை. ' : 'நிலம் ஏற்றதல்ல. ') +
              (improveFactors.length > 0 ? 'சில காரணிகள் மேம்படுத்தப்பட வேண்டும். ' : 'அனைத்து அளவீடுகளும் உகந்த நிலையில் உள்ளன. ') +
              'மண் பரிசோதனை பரிந்துரைகளின்படி பயிர் செய்ய அணுகவும்.';
  } else {
    responseText = `🌱 **Soil & Crop Suitability**

**Crop:** ${cropName}
**District:** ${distName}

**Result:**
${verdict}

**What is good:**
${goodFactors.length > 0 ? goodFactors.join('\n') : '• Analyzed parameters.'}

**What needs improvement:**
${improveFactors.length > 0 ? improveFactors.join('\n') : '• All parameters are within preferred levels.'}

**What you can do:**
${uniqueSuggestions.join('\n')}`;

    ttsText = `${cropName} in ${distName} result is ${verdict.toLowerCase()}. ` +
              (improveFactors.length > 0 ? 'Some factors need improvement. ' : 'All parameters are suitable. ') +
              'Follow soil test recommendations for best crop yield.';
  }

  return { responseText, ttsText };
}

// 1. Get Chatbot Configuration (ADMIN only)
router.get('/config', auth, authorize('ADMIN'), async (req, res) => {
  try {
    let config = null;
    try {
      config = await prisma.chatbotConfig.findFirst();
      if (!config) {
        config = await prisma.chatbotConfig.create({
          data: {
            prompt: "You are a helpful assistant for a Cooperative Society Management System and Agricultural Advisory. Use the provided live database and soil dataset context to answer the user's questions accurately.",
            knowledge: "This cooperative society provides seeds, fertilizers, pesticide services, government schemes (PM-KISAN, PMFBY, Drip Irrigation), and comprehensive Tamil Nadu soil suitability advisory across 37 districts and 57 crops."
          }
        });
      }
    } catch (dbErr) {
      config = {
        prompt: "You are a helpful assistant for a Cooperative Society Management System and Agricultural Advisory. Use the provided live database and soil dataset context to answer the user's questions accurately.",
        knowledge: "This cooperative society provides seeds, fertilizers, pesticide services, government schemes (PM-KISAN, PMFBY, Drip Irrigation), and comprehensive Tamil Nadu soil suitability advisory across 37 districts and 57 crops."
      };
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// 2. Update Chatbot Configuration (ADMIN only)
router.put('/config', auth, authorize('ADMIN'), async (req, res) => {
  try {
    const { prompt, knowledge } = req.body;
    let config = null;
    try {
      config = await prisma.chatbotConfig.findFirst();
      if (config) {
        config = await prisma.chatbotConfig.update({
          where: { id: config.id },
          data: { prompt, knowledge }
        });
      } else {
        config = await prisma.chatbotConfig.create({
          data: { prompt, knowledge }
        });
      }
    } catch (dbErr) {
      config = { prompt, knowledge };
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// 3. Process chatbot messages
router.post('/', auth, async (req, res) => {
  try {
    const { message, language, sessionMemory } = req.body;
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const query = message.trim();
    const queryLower = query.toLowerCase();

    // Determine preferred language from explicit user setting or query text
    const prefLanguage = (language === 'ta' || language === 'Tamil' || (language !== 'en' && language !== 'English' && isTamilText(query))) ? 'Tamil' : 'English';
    const isTamil = (prefLanguage === 'Tamil');

    // Fetch user/farmer profile with safe fallback
    let farmer = null;
    if (req.user && req.user.role === 'FARMER') {
      try {
        farmer = await prisma.farmer.findUnique({
          where: { userId: req.user.id }
        });
      } catch (err) {
        farmer = null;
      }
    }

    const userDistrict = farmer?.district || (farmer?.village ? extractDistrictFromText(farmer.village) : null);

    // Process prediction session (Strict stale-value prevention & multi-turn collection)
    const predResult = processPredictionSession(query, sessionMemory, isTamil);
    const sessionState = predResult.session;

    const updatedSessionMemory = {
      lastLanguage: prefLanguage,
      lastDistrict: sessionState.district_name || sessionMemory?.lastDistrict || userDistrict || null,
      lastCrop: sessionState.CROPS || sessionMemory?.lastCrop || null,
      predictionSession: predResult.isComplete ? null : sessionState, // Clear session once prediction completes
      lastCompletedInputs: predResult.isComplete ? sessionState : (sessionMemory?.lastCompletedInputs || null)
    };

    // =========================================================================
    // DETERMINISTIC SOIL INTENT DETECTION & DIRECT RESPONSES
    // =========================================================================

    // 0. Explicit Chennai Check (Obeying strict rule: Chennai is NOT in dataset)
    if (queryLower.includes('chennai') || queryLower.includes('சென்னை')) {
      const chennaiMsg = isTamil
        ? "மன்னித்துக்கொள்ளுங்கள், தற்போதைய மண் தரவுத்தளத்தில் இந்த மாவட்டத்திற்கான சரிபார்க்கப்பட்ட தரவு இல்லை (நகர்ப்புற சென்னைக்கான பதிவுகள் கிடைக்கவில்லை)."
        : "Sorry, the current soil dataset does not contain verified data for this district.";
      return res.json({ response: chennaiMsg, ttsText: chennaiMsg, sessionMemory: updatedSessionMemory });
    }

    // 0b. Unsupported Crop Check
    const queryCrop = extractCropFromText(query);
    if (queryCrop && !soilService.cropsSet.has(queryCrop) && !soilService.cropAliases[queryCrop.toLowerCase()]) {
      const unsuppCropMsg = isTamil
        ? "மன்னித்துக்கொள்ளுங்கள், தற்போதைய மண் பொருத்தம் அமைப்பில் இந்த பயிருக்கு போதுமான சரிபார்க்கப்பட்ட தரவு இல்லை."
        : "Sorry, the current soil suitability system does not have enough verified data for this crop.";
      return res.json({ response: unsuppCropMsg, ttsText: unsuppCropMsg, sessionMemory: updatedSessionMemory });
    }

    // 0c. Unsupported District Check
    const queryDistrict = extractDistrictFromText(query);
    if (queryDistrict && !soilService.districtsSet.has(queryDistrict) && !soilService.districtAliases[queryDistrict.toLowerCase()]) {
      const unsuppDistMsg = isTamil
        ? "மன்னித்துக்கொள்ளுங்கள், தற்போதைய மண் தரவுத்தளத்தில் இந்த மாவட்டத்திற்கான சரிபார்க்கப்பட்ட தரவு இல்லை."
        : "Sorry, the current soil dataset does not contain verified data for this district.";
      return res.json({ response: unsuppDistMsg, ttsText: unsuppDistMsg, sessionMemory: updatedSessionMemory });
    }

    // 1. CATBOOST ML SOIL DECISION ENGINE ROUTING
    // If complete 8 parameters are provided for the current session, run CatBoost inference!
    if (predResult.isComplete) {
      const mlResult = mlSoilService.runDecisionEngine(sessionState);

      if (mlResult && mlResult.supported_crop === false) {
        const msg = isTamil
          ? "மன்னித்துக்கொள்ளுங்கள், தற்போதைய மண் பொருத்தம் அமைப்பில் இந்த பயிருக்கு போதுமான சரிபார்க்கப்பட்ட தரவு இல்லை."
          : "Sorry, the current soil suitability system does not have enough verified data for this crop.";
        return res.json({ response: msg, ttsText: msg, soilResult: mlResult, sessionMemory: updatedSessionMemory });
      }

      if (mlResult && mlResult.prediction) {
        const { responseText, ttsText } = formatFarmerResponse(mlResult, sessionState, isTamil);
        let finalResponse = responseText;

        if (predResult.isExplicitReuse) {
          const reuseNotice = isTamil 
            ? `*(உங்கள் முந்தைய அளவீடுகள் பயன்படுத்தப்பட்டது)*\n\n`
            : `*(Reusing your previous measurements)*\n\n`;
          finalResponse = reuseNotice + responseText;
        }

        return res.json({ response: finalResponse, ttsText, soilResult: mlResult, sessionMemory: updatedSessionMemory });
      }
    }

    // 2. Multi-turn Input Collection for Prediction Queries
    const isSuitabilityQuestion = /suitable|suitability|verdict|score|improve|why|can\s+i\s+grow|grow|suitable\s+ah|suitablea|ஏற்றதா|பயிரிடலாமா/i.test(query);
    if (isSuitabilityQuestion && !predResult.isComplete) {
      const cropStr = sessionState.CROPS ? sessionState.CROPS.charAt(0).toUpperCase() + sessionState.CROPS.slice(1) : (isTamil ? 'பயிர்' : 'crop');
      const distStr = sessionState.district_name || (isTamil ? 'உங்கள் மாவட்டம்' : 'your district');

      let multiTurnMsg = '';
      if (isTamil) {
        multiTurnMsg = `நிச்சயமாக. ${distStr} மாவட்டத்தில் ${cropStr} பயிர் பொருத்தத்தை கணிக்க பின்வரும் விவரங்கள் தேவை:\n\n` +
                       predResult.missingFields.map(m => `• ${m}`).join('\n') +
                       `\n\nதயவுசெய்து இந்த மதிப்புகளை வழங்கவும்.`;
      } else {
        multiTurnMsg = `Sure. To check ${cropStr} suitability for ${distStr}, I need:\n\n` +
                       predResult.missingFields.map(m => `• ${m}`).join('\n') +
                       `\n\nPlease provide these values.`;
      }

      return res.json({ response: multiTurnMsg, ttsText: multiTurnMsg, sessionMemory: updatedSessionMemory });
    }

    // 3. Quick / General Agricultural Questions (Do NOT force 8-input prediction form)
    if (
      queryLower.includes('water requirement') || 
      queryLower.includes('water need') || 
      queryLower.includes('how much water') || 
      queryLower.includes('தண்ணீர் தேவை') || 
      queryLower.includes('நீர் தேவை') ||
      queryLower.includes('water req') ||
      queryLower.includes('water evlo') ||
      queryLower.includes('evlo water') ||
      (queryLower.includes('water') && extractedCrop)
    ) {
      const targetCrop = extractedCrop || 'rice';
      const waterResult = await soilService.getWaterRequirement(targetCrop, extractedDistrict);
      if (waterResult.success) {
        let responseText = '';
        if (isTamil) {
          responseText = `💧 **தண்ணீர் தேவை விவரம் (${waterResult.crop}):**\n\n${waterResult.crop} பயிருக்கான தண்ணீர் தேவை அளவு: **${waterResult.waterRequirement}**.\n\n${waterResult.isNumeric ? `சுமார் ${waterResult.waterRequirement} மி.மீ பாசன நீர் தேவைப்படுகிறது.` : `நீர் பாசன மேலாண்மைக்கு ${waterResult.waterRequirement} நீர் அளவு உகந்தது.`}`;
        } else {
          responseText = `💧 **Water Requirement for ${waterResult.crop.charAt(0).toUpperCase() + waterResult.crop.slice(1)}:**\n\n${waterResult.formattedRequirement}\n\n• Crop: ${waterResult.crop}\n• Required Level: ${waterResult.waterRequirement}`;
        }
        return res.json({ response: responseText, ttsText: responseText.replace(/[*#_`]/g, ''), sessionMemory: updatedSessionMemory });
      }
    }

    // 4. Climate (Temperature / Humidity) Requirement Quick Questions
    if (
      queryLower.includes('temperature') ||
      queryLower.includes('humidity') ||
      queryLower.includes('climate') ||
      queryLower.includes('weather requirement') ||
      queryLower.includes('வெப்பநிலை') ||
      queryLower.includes('ஈரப்பதம்')
    ) {
      const targetCrop = extractedCrop || 'rice';
      const climateResult = await soilService.getCropClimate(targetCrop, extractedDistrict);
      if (climateResult.success) {
        let responseText = '';
        if (isTamil) {
          responseText = `🌤️ **காலநிலை மற்றும் சுற்றுச்சூழல் விவரங்கள் (${climateResult.crop}):**\n\n• உகந்த வெப்பநிலை வரம்பு: **${climateResult.cropRequirements.minTemperature}°C – ${climateResult.cropRequirements.maxTemperature}°C**\n• உகந்த ஈரப்பதம் வரம்பு: **${climateResult.cropRequirements.minHumidity}% – ${climateResult.cropRequirements.maxHumidity}%**`;
        } else {
          responseText = `🌤️ **Climate Requirements for ${climateResult.crop.charAt(0).toUpperCase() + climateResult.crop.slice(1)}:**\n\n• Preferred Temperature Range: **${climateResult.cropRequirements.minTemperature}°C – ${climateResult.cropRequirements.maxTemperature}°C**\n• Preferred Humidity Range: **${climateResult.cropRequirements.minHumidity}% – ${climateResult.cropRequirements.maxHumidity}%**`;
        }
        return res.json({ response: responseText, ttsText: responseText.replace(/[*#_`]/g, ''), sessionMemory: updatedSessionMemory });
      }
    }

    // 5. Crop Recommendation Quick Questions
    if (
      (
        queryLower.includes('crop') ||
        queryLower.includes('podalam') ||
        queryLower.includes('enna') ||
        queryLower.includes('ஏற்றது') ||
        queryLower.includes('பரிந்துரை') ||
        queryLower.includes('மண்ணுக்கு') ||
        queryLower.includes('பயிர்')
      ) && (
        queryLower.includes('suitable') ||
        queryLower.includes('best') ||
        queryLower.includes('recommend') ||
        queryLower.includes('grow') ||
        queryLower.includes('podalam') ||
        queryLower.includes('enna') ||
        queryLower.includes('ஏற்றது') ||
        queryLower.includes('பரிந்துரை') ||
        queryLower.includes('மண்ணுக்கு')
      ) && !queryCrop
    ) {
      if (!extractedDistrict) {
        const askMsg = isTamil 
          ? "நீங்கள் எந்த மாவட்டத்தில் விவசாயம் செய்கிறீர்கள்? மாவட்டத்தின் பெயரை குறிப்பிட்டால் (எ.கா. சேலம், தஞ்சாவூர், ஈரோடு) மிகவும் பொருத்தமான பயிர்களை பரிந்துரைக்க முடியும்."
          : "Which district are you farming in? Please specify your district (e.g., Salem, Thanjavur, Erode) so I can recommend the most suitable crops for your soil.";
        return res.json({ response: askMsg, ttsText: askMsg, sessionMemory: updatedSessionMemory });
      }

      const recResult = await soilService.getSuitableCrops(extractedDistrict);
      if (recResult.success) {
        let responseText = '';
        if (isTamil) {
          responseText = `🌾 **${recResult.district} மாவட்டத்திற்கு ஏற்ற சிறந்த பயிர்கள்:**\n\n${recResult.topCrops.slice(0, 5).map((c, i) => `${i + 1}. **${c.crop}** — நீர் தேவை: ${c.waterRequirement}`).join('\n')}\n\n💡 உங்கள் குறிப்பிட்ட நிலத்தின் NPK மற்றும் பாசன வசதியை பொறுத்து சிறந்த பயிரை தேர்வு செய்யலாம்.`;
        } else {
          responseText = `🌾 **Recommended Crops for ${recResult.district}:**\n\n${recResult.topCrops.slice(0, 6).map((c, i) => `${i + 1}. **${c.crop.charAt(0).toUpperCase() + c.crop.slice(1)}** (Water requirement: ${c.waterRequirement})`).join('\n')}`;
        }
        return res.json({ response: responseText, ttsText: responseText.replace(/[*#_`]/g, ''), cropsData: recResult, sessionMemory: updatedSessionMemory });
      } else {
        return res.json({ response: recResult.error, ttsText: recResult.error, sessionMemory: updatedSessionMemory });
      }
    }

    // =========================================================================
    // COOPERATIVE CONTEXT BUILDER (PRESERVING EXISTING FUNCTIONALITY)
    // =========================================================================
    let chatbotConfig = {
      prompt: "You are a helpful assistant for a Cooperative Society Management System. Use the following context to answer the user's question accurately.",
      knowledge: "This cooperative society provides seeds, fertilizers, and pesticide services. We support PM-KISAN, PMFBY, and Drip Irrigation Subsidy schemes."
    };

    try {
      const config = await prisma.chatbotConfig.findFirst();
      if (config) chatbotConfig = config;
    } catch (e) {
      // Use default config if db is temporarily unreachable
    }

    let context = '';
    try {
      if (req.user && req.user.role === 'FARMER') {
        if (farmer) {
          const allSchemes = await prisma.scheme.findMany({ where: { isActive: true } });
          const eligibleSchemes = allSchemes.filter(scheme => {
            try {
              const rules = JSON.parse(scheme.eligibilityRules || '{}');
              if (rules.minLandSize && farmer.landSize < rules.minLandSize) return false;
              if (rules.maxLandSize && farmer.landSize > rules.maxLandSize) return false;
              if (rules.requiredCrops && !rules.requiredCrops.includes(farmer.crop)) return false;
              if (rules.villages && !rules.villages.includes(farmer.village)) return false;
              return true;
            } catch (e) {
              return true;
            }
          });

          const inventory = await prisma.inventory.findMany();
          const announcements = await prisma.announcement.findMany({
            orderBy: { createdAt: 'desc' },
            take: 5
          });

          context = `
Farmer Profile:
- Name: ${farmer.name}
- Membership ID: ${farmer.membershipId}
- Village: ${farmer.village}
- District: ${farmer.district || 'Not specified'}
- Land Size: ${farmer.landSize} ${farmer.landUnit || 'Acres'}
- Registered Crop: ${farmer.crop}

Eligible Schemes:
${eligibleSchemes.map(s => `- ${s.title}: ${s.benefits} (Deadline: ${s.deadline.toISOString().split('T')[0]})`).join('\n')}

Inventory Status (Fertilizers, Seeds, Pesticides):
${inventory.map(i => `- ${i.name} (${i.type}): ${i.quantity} ${i.unit} ${i.quantity <= i.minStock ? '(LOW STOCK)' : ''}`).join('\n')}

Recent Announcements:
${announcements.map(a => `- ${a.title}: ${a.content}`).join('\n')}
`;
        }
      } else {
        const totalFarmers = await prisma.farmer.count();
        const inventory = await prisma.inventory.findMany();
        const activeSchemes = await prisma.scheme.count({ where: { isActive: true } });
        const warehouse = await prisma.warehouseData.findFirst({ orderBy: { timestamp: 'desc' } });

        context = `
Dashboard Overview:
- Total Farmers: ${totalFarmers}
- Active Schemes: ${activeSchemes}
- Inventory Items: ${inventory.length}
- Warehouse Temperature: ${warehouse?.temperature || 'N/A'}°C
- Warehouse Humidity: ${warehouse?.humidity || 'N/A'}%
`;
      }
    } catch (e) {
      context = `
Cooperative Overview:
- Urea (Fertilizer): 250 Bags (Available in stock)
- DAP (Fertilizer): 180 Bags (Available in stock)
- Schemes Supported: PM-KISAN, PMFBY Crop Insurance, Drip Irrigation Subsidy
- Announcements: Fertilizer distribution scheduled this week for registered members.
`;
    }

    // Direct match for quick cooperative questions
    const mockCoop = getCoopMockResponse(query, context, isTamil);
    if (mockCoop) {
      return res.json({ response: mockCoop, ttsText: mockCoop, sessionMemory: updatedSessionMemory });
    }

    // =========================================================================
    // GEMINI PROMPT & GENERATION (WITH COMPLETE COOPERATIVE + SOIL CONTEXT)
    // =========================================================================
    const systemPrompt = `
${chatbotConfig.prompt}

Preferred response language:
${prefLanguage}

Cooperative General Knowledge:
${chatbotConfig.knowledge}

Cooperative Live Database Context:
${context}

User Question: ${query}

CRITICAL INSTRUCTIONS:
1. Always respond in the requested Preferred response language: ${prefLanguage}. If Tamil, respond entirely in natural Tamil. If English, respond in English.
2. Answer accurately using live context and cooperative knowledge. Do not invent data.
3. Keep the answer professional, concise, and farmer-friendly.
`;

    if (!genAI) {
      const fallback = getCoopMockResponse(query, context, isTamil) || (isTamil ? "மன்னித்துக்கொள்ளுங்கள், கூட்டுறவு சங்கம் மற்றும் விவசாய கேள்விகளுக்கு மட்டுமே என்னால் பதிலளிக்க முடியும்." : "I'm sorry, I can only answer questions related to the cooperative society and agriculture.");
      return res.json({
        response: fallback,
        ttsText: fallback,
        sessionMemory: updatedSessionMemory
      });
    }

    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent(systemPrompt);
      const response = await result.response;
      const text = response.text();
      res.json({ response: text, ttsText: text.replace(/[*#_`]/g, ''), sessionMemory: updatedSessionMemory });
    } catch (apiError) {
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
        const result = await model.generateContent(systemPrompt);
        const response = await result.response;
        const text = response.text();
        res.json({ response: text, ttsText: text.replace(/[*#_`]/g, ''), sessionMemory: updatedSessionMemory });
      } catch (err) {
        const fallback = getCoopMockResponse(query, context, isTamil) || (isTamil ? "மன்னித்துக்கொள்ளுங்கள், கூட்டுறவு சங்கம் மற்றும் விவசாய கேள்விகளுக்கு மட்டுமே என்னால் பதிலளிக்க முடியும்." : "I'm sorry, I can only answer questions related to the cooperative society and agriculture.");
        res.json({
          response: fallback,
          ttsText: fallback,
          sessionMemory: updatedSessionMemory
        });
      }
    }
  } catch (error) {
    console.error('Chatbot route error:', error);
    res.status(500).json({ error: 'Failed to process chat request' });
  }
});

// Helper for Cooperative Rule-Based Responses
function getCoopMockResponse(message, context, isTamil = false) {
  const query = message.toLowerCase();

  if (query.includes('eligible') || query.includes('scheme') || query.includes('திட்டம்')) {
    if (context && context.includes('Eligible Schemes:')) {
      const schemesPart = context.split('Eligible Schemes:')[1].split('\n\n')[0].trim();
      return isTamil
        ? `உங்கள் சுயவிவரத்தின் படி, நீங்கள் பின்வரும் அரசு திட்டங்களுக்கு தகுதியுடையவர்:\n${schemesPart}`
        : `Based on your profile, you are eligible for the following schemes:\n${schemesPart}`;
    }
    return isTamil
      ? "அரசு திட்டங்கள் பக்கத்தில் உங்கள் PM-KISAN, PMFBY மற்றும் சொட்டு நீர் பாசன மானிய தகுதிகளை சரிபார்க்கலாம்."
      : "You can check your eligible schemes (such as PM-KISAN, PMFBY, and Drip Irrigation Subsidy) on the Government Schemes dashboard tab.";
  }

  if (query.includes('urea') || query.includes('fertilizer') || query.includes('dap') || query.includes('உரம்') || query.includes('stock') || query.includes('available')) {
    if (context && context.includes('Inventory Status')) {
      const inventoryPart = context.split('Inventory Status (Fertilizers, Seeds, Pesticides):')[1].split('\n\n')[0].trim();
      if (query.includes('urea')) {
        const line = inventoryPart.split('\n').find(l => l.toLowerCase().includes('urea'));
        return isTamil
          ? (line ? `யுரியா உரம் கையிருப்பு: ${line.substring(2)}` : "யுரியா உரம் தற்போது கூட்டுறவு சங்கத்தில் கையிருப்பில் உள்ளது.")
          : (line ? `Urea status: ${line.substring(2)}` : "Urea is currently in stock at the cooperative society.");
      }
      if (query.includes('dap')) {
        const line = inventoryPart.split('\n').find(l => l.toLowerCase().includes('dap'));
        return isTamil
          ? (line ? `டிஏபி உரம் கையிருப்பு: ${line.substring(2)}` : "டிஏபி உரம் தற்போது கூட்டுறவு சங்கத்தில் கையிருப்பில் உள்ளது.")
          : (line ? `DAP status: ${line.substring(2)}` : "DAP is currently in stock at the cooperative society.");
      }
      return isTamil
        ? `தற்போதைய உரங்கள் மற்றும் விதைகள் கையிருப்பு விவரம்:\n${inventoryPart}`
        : `Current inventory stock status:\n${inventoryPart}`;
    }
    return isTamil
      ? "ஆம், கூட்டுறவு சங்கத்தில் யுரியா மற்றும் டிஏபி உரங்கள் கையிருப்பில் உள்ளன. சரக்கு பக்கத்தில் அளவை பார்க்கலாம்."
      : "Yes, fertilizer stock (including Urea and DAP) is available at the cooperative society. You can check current quantity in the Inventory tab.";
  }

  if (query.includes('profile') || query.includes('my name') || query.includes('membership') || query.includes('சுயவிவரம்')) {
    if (context && context.includes('Farmer Profile:')) {
      const profilePart = context.split('Farmer Profile:')[1].split('\n\n')[0].trim();
      return isTamil
        ? `இதோ உங்கள் விவசாயி சுயவிவர விவரங்கள்:\n${profilePart}`
        : `Here is your profile information:\n${profilePart}`;
    }
    return isTamil
      ? "உங்கள் விவசாயி சுயவிவரம் ஸ்மார்ட் கூட்டுறவு சங்கத்தில் பதிவு செய்யப்பட்டுள்ளது."
      : "Your farmer profile is registered with the Smart Cooperative Society. You can view full details on your dashboard.";
  }

  if (query.includes('announcement') || query.includes('news') || query.includes('update') || query.includes('அறிவிப்பு')) {
    if (context && context.includes('Recent Announcements:')) {
      const annPart = context.split('Recent Announcements:')[1].trim();
      return isTamil
        ? `சமீபத்திய கூட்டுறவு சங்க அறிவிப்புகள்:\n${annPart}`
        : `Here are the latest announcements:\n${annPart}`;
    }
    return isTamil
      ? "சமீபத்திய அறிவிப்பு: கூட்டுறவு சங்க அலுவலகத்தில் உரம் விநியோகம் மற்றும் பயிர் காப்பீட்டு விண்ணப்பங்கள் பெறப்படுகின்றன."
      : "Latest announcement: Fertilizer distribution and crop insurance subsidy applications are currently active at the society office.";
  }

  return null;
}

module.exports = router;
