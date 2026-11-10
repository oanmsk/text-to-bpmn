// Copyright (c) 2025 Davide Chen
// SPDX-License-Identifier: MIT

import express from 'express';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// __dirname workaround for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ─────────── LOADS SYSTEM PROMPT ON STARTUP ─────────── */
const SYSTEM_PROMPT_PATH = path.join(__dirname, 'system_prompt.txt');
const SYSTEM_PROMPT = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');


// Serve static files (HTML, CSS, JS) from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

/* ─────────── BACKEND PROXY FOR EXTERNAL LLM APIs ─────────── */
app.post('/api/process', express.json(), async (req, res) => {

const userPrompt = req.body.prompt;
const modelSelected = req.body.model;
const reasoner = req.body.reasoner;

  let apiUrl = '';
  let apiKey = '';
  let modelName = '';

  // Decide which provider to use
  if (modelSelected === 'chatgpt') {
    apiUrl = 'https://api.openai.com/v1/chat/completions';
    apiKey = process.env.OPENAI_API_KEY;
    modelName = reasoner ? 'o3-2025-04-16' : 'gpt-4o';
    
  } else if (modelSelected === 'deepseek') {
    apiUrl = 'https://api.deepseek.com/v1/chat/completions';
    apiKey = process.env.DEEPSEEK_API_KEY;
    modelName = modelName = reasoner ? 'deepseek-reasoner' : 'deepseek-chat';
  } else {
    return res.status(400).json({ error: 'Invalid model selected' });
  }

  try {
    const apiResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages:  [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt }
            ],
        stream: true,
        ...(modelName !== 'o3-2025-04-16' && { temperature: 0.0 })
      })
    });
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    apiResponse.body.on('data', (chunk) => {
      res.write(chunk);
    });

    apiResponse.body.on('end', () => {
      res.end();
    });

    apiResponse.body.on('error', (err) => {
      console.error('Stream error:', err);
      res.status(500).json({ error: 'Error while streaming response' });
    });

  } catch (error) {
    console.error('Streaming error:', error);
    res.status(500).json({
      error: 'Streaming API error',
      details: error.message
    });
  }
});

/* ─────────── START THE SERVER ─────────── */
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});