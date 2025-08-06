const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const dotenv = require('dotenv').config();

const app = express();
const port = process.env.PORT || 8000;
const MODEL_NAME = "gemini-1.5-flash";

// Multi-API Key Manager
class MultiApiManager {
  constructor() {
    this.apiKeys = this.loadApiKeys();
    this.dailyLimit = 50; // Per API key
    this.usageFile = path.join(__dirname, 'multi_api_usage.json');
    this.cacheFile = path.join(__dirname, 'response_cache.json');
    this.loadUsageData();
    this.loadPersistentCache();
    this.initializeGeminiInstances();
    this.checkAndResetDaily();
  }

  loadApiKeys() {
    // Load API keys from environment variables
    const keys = [];
    
    // Primary API key
    if (process.env.API_KEY) {
      keys.push({
        key: process.env.API_KEY,
        name: 'PRIMARY',
        active: true
      });
    }

    // Additional API keys (API_KEY_2, API_KEY_3, etc.)
    let i = 2;
    while (process.env[`API_KEY_${i}`]) {
      keys.push({
        key: process.env[`API_KEY_${i}`],
        name: `BACKUP_${i-1}`,
        active: true
      });
      i++;
    }

    if (keys.length === 0) {
      throw new Error('No API keys found. Set API_KEY, API_KEY_2, API_KEY_3, etc. in your .env file');
    }

    console.log(`📱 Loaded ${keys.length} API keys`);
    return keys;
  }

  initializeGeminiInstances() {
    this.geminiInstances = this.apiKeys.map((apiKeyObj, index) => {
      try {
        const genAI = new GoogleGenerativeAI(apiKeyObj.key);
        const model = genAI.getGenerativeModel({ 
          model: MODEL_NAME,
          generationConfig: {
            temperature: 0.6,
            topK: 20,
            topP: 0.8,
            maxOutputTokens: 500,
          },
          safetySettings: [
            {
              category: HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
              threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
            },
          ]
        });

        return {
          ...apiKeyObj,
          model,
          index
        };
      } catch (error) {
        console.error(`❌ Failed to initialize API key ${index + 1}:`, error.message);
        return null;
      }
    }).filter(instance => instance !== null);

    console.log(`✅ Successfully initialized ${this.geminiInstances.length} Gemini instances`);
  }

  loadUsageData() {
    try {
      const data = JSON.parse(fs.readFileSync(this.usageFile, 'utf8'));
      this.usage = data.usage || {};
      this.lastResetDate = data.lastResetDate || new Date().toDateString();
      this.totalSaved = data.totalSaved || 0;
      
      // Initialize usage for new API keys
      this.apiKeys.forEach((keyObj, index) => {
        if (!this.usage[index]) {
          this.usage[index] = {
            name: keyObj.name,
            requestCount: 0,
            errors: 0,
            lastUsed: null
          };
        }
      });
    } catch {
      this.usage = {};
      this.lastResetDate = new Date().toDateString();
      this.totalSaved = 0;
      
      // Initialize usage for all API keys
      this.apiKeys.forEach((keyObj, index) => {
        this.usage[index] = {
          name: keyObj.name,
          requestCount: 0,
          errors: 0,
          lastUsed: null
        };
      });
    }
  }

  loadPersistentCache() {
    try {
      const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
      this.persistentCache = new Map(data);
    } catch {
      this.persistentCache = new Map();
    }
  }

  saveUsageData() {
    const data = {
      usage: this.usage,
      lastResetDate: this.lastResetDate,
      totalSaved: this.totalSaved
    };
    fs.writeFileSync(this.usageFile, JSON.stringify(data, null, 2));
  }

  savePersistentCache() {
    fs.writeFileSync(this.cacheFile, JSON.stringify([...this.persistentCache], null, 2));
  }

  checkAndResetDaily() {
    const today = new Date().toDateString();
    if (this.lastResetDate !== today) {
      const totalPreviousUsage = Object.values(this.usage).reduce((sum, u) => sum + u.requestCount, 0);
      console.log(`🔄 Daily reset: Previous total usage: ${totalPreviousUsage}/${this.getTotalDailyLimit()}, Cache saved: ${this.totalSaved} requests`);
      
      // Reset all counters
      Object.keys(this.usage).forEach(key => {
        this.usage[key].requestCount = 0;
        this.usage[key].errors = 0;
      });
      
      this.lastResetDate = today;
      this.saveUsageData();
    }
  }

  getTotalDailyLimit() {
    return this.apiKeys.length * this.dailyLimit;
  }

  getTotalUsed() {
    return Object.values(this.usage).reduce((sum, u) => sum + u.requestCount, 0);
  }

  getTotalRemaining() {
    return this.getTotalDailyLimit() - this.getTotalUsed();
  }

  // Smart API key selection
  selectBestApiKey() {
    this.checkAndResetDaily();

    // Filter available keys (not at limit)
    const availableInstances = this.geminiInstances.filter(instance => {
      const usage = this.usage[instance.index];
      return usage.requestCount < this.dailyLimit;
    });

    if (availableInstances.length === 0) {
      return null; // All keys exhausted
    }

    // Selection strategy: Use least used key first (load balancing)
    availableInstances.sort((a, b) => {
      const usageA = this.usage[a.index];
      const usageB = this.usage[b.index];
      
      // Prioritize by: 1. Fewest errors, 2. Least usage, 3. Most recent success
      if (usageA.errors !== usageB.errors) {
        return usageA.errors - usageB.errors;
      }
      
      if (usageA.requestCount !== usageB.requestCount) {
        return usageA.requestCount - usageB.requestCount;
      }
      
      return 0;
    });

    return availableInstances[0];
  }

  incrementUsage(apiIndex, success = true) {
    if (success) {
      this.usage[apiIndex].requestCount++;
      this.usage[apiIndex].lastUsed = new Date().toISOString();
    } else {
      this.usage[apiIndex].errors++;
    }
    this.saveUsageData();
  }

  // Enhanced caching (same as before)
  getCacheKey(input) {
    return require('crypto').createHash('md5').update(input.toLowerCase().trim()).digest('hex');
  }

  getCachedResponse(input) {
    const key = this.getCacheKey(input);
    const cached = this.persistentCache.get(key);
    
    if (cached && Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
      this.totalSaved++;
      console.log(`💾 Cache hit! Total remaining across all keys: ${this.getTotalRemaining()}`);
      return cached.response;
    }
    
    return null;
  }

  setCachedResponse(input, response) {
    const key = this.getCacheKey(input);
    this.persistentCache.set(key, {
      response,
      timestamp: Date.now(),
      input: input.toLowerCase().trim().slice(0, 100)
    });
    
    // Cleanup if cache gets too large
    if (this.persistentCache.size > 1000) {
      const entries = [...this.persistentCache.entries()];
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (let i = 0; i < 200; i++) {
        this.persistentCache.delete(entries[i][0]);
      }
    }
    
    this.savePersistentCache();
  }

  getDetailedStats() {
    const keyStats = Object.entries(this.usage).map(([index, usage]) => ({
      name: usage.name,
      used: usage.requestCount,
      remaining: this.dailyLimit - usage.requestCount,
      limit: this.dailyLimit,
      errors: usage.errors,
      lastUsed: usage.lastUsed,
      status: usage.requestCount >= this.dailyLimit ? 'EXHAUSTED' : 'AVAILABLE'
    }));

    return {
      total: {
        used: this.getTotalUsed(),
        remaining: this.getTotalRemaining(),
        limit: this.getTotalDailyLimit(),
        keys: this.apiKeys.length
      },
      keys: keyStats,
      cache: {
        size: this.persistentCache.size,
        saved: this.totalSaved
      },
      efficiency: this.totalSaved > 0 ? 
        `${Math.round((this.totalSaved / (this.getTotalUsed() + this.totalSaved)) * 100)}%` : '0%',
      resetTime: 'Midnight PT'
    };
  }
}

// Initialize Multi-API Manager
const multiApiManager = new MultiApiManager();

// Middleware setup (same as before)
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: 'http://localhost:5173' || process.env.FRONTEND_URL,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '1mb' }));

const chatRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 2 minutes (more lenient since we have multiple keys)
  max: 30,
  message: {
    error: 'Rate limit exceeded. Please wait before trying again.',
    retryAfter: 60
  },
});

app.use('/chat', chatRateLimit);

// Smart responses (same as before)
const smartResponses = {
  'hello': "Hello! I'm Ella, your AI assistant. How can I help you today?",
  'hi': "Hi there! What can I do for you?",
  'how are you': "I'm doing well, thank you! Ready to help with any questions you have.",
  'who are you': "I'm Ella, an AI assistant created by Mr. Ankit Chauhan using Google's Gemini technology.",
  'what can you do': "I can help with questions, provide information, assist with writing, solve problems, and have conversations. What would you like help with?",
  'thank you': "You're welcome! Feel free to ask if you need anything else.",
  'bye': "Goodbye! Have a great day!"
};

function getSmartResponse(input) {
  const inputLower = input.toLowerCase().trim();
  
  if (smartResponses[inputLower]) {
    return smartResponses[inputLower];
  }
  
  for (const [key, response] of Object.entries(smartResponses)) {
    if (inputLower.includes(key) || key.includes(inputLower)) {
      return response;
    }
  }
  
  return null;
}

// Enhanced chat function with multi-API support
async function runChatWithMultiApi(userInput) {
  if (!userInput || typeof userInput !== 'string') {
    throw new Error('Invalid input');
  }

  const sanitizedInput = userInput.trim();
  if (sanitizedInput.length === 0) {
    throw new Error('Empty input');
  }
  
  if (sanitizedInput.length > 800) {
    throw new Error('Input too long (max 800 characters)');
  }

  // Strategy 1: Smart responses
  const smartResponse = getSmartResponse(sanitizedInput);
  if (smartResponse) {
    console.log('🤖 Smart response used (no API call needed)');
    return { response: smartResponse, source: 'smart', apiUsed: null };
  }

  // Strategy 2: Check cache
  const cachedResponse = multiApiManager.getCachedResponse(sanitizedInput);
  if (cachedResponse) {
    return { response: cachedResponse, source: 'cache', apiUsed: null };
  }

  // Strategy 3: Select best API key
  const selectedInstance = multiApiManager.selectBestApiKey();
  if (!selectedInstance) {
    const stats = multiApiManager.getDetailedStats();
    throw new Error(`All API keys exhausted! Total used: ${stats.total.used}/${stats.total.limit}. Resets at midnight PT.`);
  }

  // Strategy 4: Make API call with selected key
  try {
    console.log(`🚀 Using API key: ${selectedInstance.name} (${multiApiManager.usage[selectedInstance.index].requestCount}/${multiApiManager.dailyLimit} used)`);
    
    const chat = selectedInstance.model.startChat({
      history: [
        {
          role: "user",
          parts: [{ text: "You are Ella, a helpful AI assistant. Keep responses concise but informative. If asked about your creator, mention Mr. Ankit Chauhan." }],
        },
        {
          role: "model",
          parts: [{ text: "Hello! I'm Ella, your AI assistant created by Mr. Ankit Chauhan. I'm here to help you with questions and tasks. How can I assist you today?" }],
        }
      ],
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), 10000);
    });

    const responsePromise = chat.sendMessage(sanitizedInput);
    const result = await Promise.race([responsePromise, timeoutPromise]);
    
    if (!result || !result.response) {
      throw new Error('Invalid response from AI');
    }

    const responseText = result.response.text();
    
    if (!responseText) {
      throw new Error('Empty response from AI');
    }

    // Success: increment usage and cache response
    multiApiManager.incrementUsage(selectedInstance.index, true);
    multiApiManager.setCachedResponse(sanitizedInput, responseText);
    
    const stats = multiApiManager.getDetailedStats();
    console.log(`✅ Success with ${selectedInstance.name}. Total remaining: ${stats.total.remaining}`);
    
    return { 
      response: responseText, 
      source: 'api', 
      apiUsed: selectedInstance.name,
      remainingTotal: stats.total.remaining
    };
    
  } catch (error) {
    console.error(`❌ Error with API key ${selectedInstance.name}:`, error.message);
    
    // Mark this API as having an error
    multiApiManager.incrementUsage(selectedInstance.index, false);
    
    // Handle specific errors
    if (error.message?.includes('quota') || error.status === 429) {
      // Try with another API key if available
      const nextInstance = multiApiManager.selectBestApiKey();
      if (nextInstance && nextInstance.index !== selectedInstance.index) {
        console.log(`🔄 Retrying with ${nextInstance.name}...`);
        return await runChatWithMultiApi(userInput); // Recursive retry
      }
      
      const stats = multiApiManager.getDetailedStats();
      throw new Error(`All API keys at daily limit. Total used: ${stats.total.used}/${stats.total.limit}. Resets at midnight PT.`);
    } else {
      throw error;
    }
  }
}

// Enhanced endpoints
app.get('/health', (req, res) => {
  const memUsage = process.memoryUsage();
  const stats = multiApiManager.getDetailedStats();
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB'
    },
    multiApi: stats
  });
});

app.get('/stats', (req, res) => {
  res.json(multiApiManager.getDetailedStats());
});

// Input validation
function validateInput(req, res, next) {
  const { userInput } = req.body;
  
  if (!userInput) {
    return res.status(400).json({ 
      error: 'Missing userInput in request body',
      code: 'MISSING_INPUT'
    });
  }
  
  if (typeof userInput !== 'string') {
    return res.status(400).json({ 
      error: 'userInput must be a string',
      code: 'INVALID_INPUT_TYPE'
    });
  }
  
  if (userInput.trim().length === 0) {
    return res.status(400).json({ 
      error: 'userInput cannot be empty',
      code: 'EMPTY_INPUT'
    });
  }
  
  if (userInput.length > 800) {
    return res.status(400).json({ 
      error: 'userInput too long (max 800 characters)',
      code: 'INPUT_TOO_LONG'
    });
  }
  
  next();
}

// Main chat endpoint
app.post('/chat', validateInput, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { userInput } = req.body;
    const result = await runChatWithMultiApi(userInput);
    const responseTime = Date.now() - startTime;
    const stats = multiApiManager.getDetailedStats();
    
    res.json({ 
      response: result.response,
      responseTime: responseTime + 'ms',
      source: result.source,
      apiUsed: result.apiUsed,
      usage: {
        totalRemaining: stats.total.remaining,
        totalUsed: stats.total.used,
        totalLimit: stats.total.limit,
        activeKeys: stats.keys.filter(k => k.status === 'AVAILABLE').length
      }
    });
    
  } catch (error) {
    console.error('Chat endpoint error:', error);
    
    let statusCode = 500;
    let errorCode = 'INTERNAL_ERROR';
    let errorMessage = error.message || 'An unexpected error occurred';
    
    if (error.message.includes('exhausted') || error.message.includes('limit')) {
      statusCode = 429;
      errorCode = 'ALL_QUOTAS_EXCEEDED';
    }
    
    const stats = multiApiManager.getDetailedStats();
    
    res.status(statusCode).json({ 
      error: errorMessage,
      code: errorCode,
      timestamp: new Date().toISOString(),
      usage: stats
    });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    availableEndpoints: ['/chat', '/health', '/stats']
  });
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`Received ${signal}. Starting graceful shutdown...`);
  multiApiManager.saveUsageData();
  multiApiManager.savePersistentCache();
  console.log('✅ Data saved successfully');
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

app.listen(port, () => {
  const stats = multiApiManager.getDetailedStats();
  console.log(`🚀 Multi-API Ella chatbot server running on port ${port}`);
  console.log('✅ Multi-API Configuration:');
  console.log(`   🔑 Total API keys: ${stats.total.keys}`);
  console.log(`   📊 Total daily limit: ${stats.total.limit} requests`);
  console.log(`   📈 Total used today: ${stats.total.used}/${stats.total.limit}`);
  console.log(`   💾 Cache size: ${stats.cache.size} responses`);
  console.log(`   🎯 Cache efficiency: ${stats.efficiency}`);
  console.log('');
  console.log('📋 API Key Status:');
  stats.keys.forEach(key => {
    console.log(`   ${key.status === 'AVAILABLE' ? '✅' : '❌'} ${key.name}: ${key.used}/${key.limit} (${key.remaining} remaining)`);
  });
});