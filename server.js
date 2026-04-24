#!/usr/bin/env node
import express from 'express';
import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const app = express();
const PORT = process.env.PORT || 3456;

// Load proxy configuration
function loadProxyConfig() {
  // Priority: 1. Environment variable, 2. Config file, 3. No proxy
  if (process.env.https_proxy || process.env.HTTPS_PROXY) {
    return process.env.https_proxy || process.env.HTTPS_PROXY;
  }
  
  // Try to load from config file
  const configPath = join(homedir(), '.config', 'opencode', 'gemini-proxy.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      return config.proxy;
    } catch (e) {
      console.error('Failed to load proxy config:', e.message);
    }
  }
  
  return null;
}

const proxyUrl = loadProxyConfig();
if (proxyUrl) {
  process.env.https_proxy = proxyUrl;
  process.env.http_proxy = proxyUrl;
  console.log(`Using proxy: ${proxyUrl}`);
} else {
  console.log('No proxy configured');
}

app.use(express.json());

// Add logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  console.log('Received request:', JSON.stringify(req.body, null, 2));
  
  try {
    const { messages, model = 'gemini-3.1-flash-lite-preview', stream = false } = req.body;
    
    // Convert messages to prompt
    const prompt = messages
      .map(msg => {
        if (typeof msg.content === 'string') {
          if (msg.role === 'user') return msg.content;
          if (msg.role === 'assistant') return `Assistant: ${msg.content}`;
          if (msg.role === 'system') return `System: ${msg.content}`;
        } else if (Array.isArray(msg.content)) {
          return msg.content
            .map(part => part.type === 'text' ? part.text : '')
            .filter(Boolean)
            .join(' ');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
    
    if (!prompt.trim()) {
      console.error('No prompt provided');
      return res.status(400).json({ error: 'No prompt provided' });
    }
    
    console.log('Calling Gemini CLI with prompt:', prompt.substring(0, 100) + '...');
    
    const args = [
      '--prompt', prompt,
      '-o', 'json',
      '-m', model,
      '--approval-mode', 'plan'
    ];
    
    const gemini = spawn('gemini', args, {
      env: {
        ...process.env,
        ...(proxyUrl ? {
          https_proxy: proxyUrl,
          http_proxy: proxyUrl
        } : {})
      }
    });
    
    let stdout = '';
    let stderr = '';
    
    gemini.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    
    gemini.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    
    gemini.on('close', (code) => {
      console.log('Gemini CLI exited with code:', code);
      
      if (code !== 0) {
        console.error('Gemini CLI error:', stderr);
        return res.status(500).json({ 
          error: 'Gemini CLI failed',
          details: stderr 
        });
      }
      
      try {
        const data = JSON.parse(stdout);
        console.log('Gemini response:', data.response?.substring(0, 100));
        
        const response = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: data.response || ''
            },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: data.stats?.tokens?.input || 0,
            completion_tokens: data.stats?.tokens?.candidates || 0,
            total_tokens: (data.stats?.tokens?.input || 0) + (data.stats?.tokens?.candidates || 0)
          }
        };
        
        console.log('Sending response');
        res.json(response);
      } catch (e) {
        console.error('Failed to parse Gemini response:', e);
        console.error('Raw stdout:', stdout);
        res.status(500).json({ 
          error: 'Failed to parse response',
          details: e.message 
        });
      }
    });
    
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Gemini CLI API server running on http://localhost:${PORT}`);
  console.log(`OpenAI-compatible endpoint: http://localhost:${PORT}/v1/chat/completions`);
  if (proxyUrl) {
    console.log(`Proxy: ${proxyUrl}`);
  }
});
