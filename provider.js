import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Load proxy configuration dynamically
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

function decorateFinishReason(reason) {
  if (process.env.OPENCODE !== '1') return reason;
  const wrapped = new String(reason);
  wrapped.unified = reason;
  wrapped.raw = undefined;
  return wrapped;
}

function createGeminiEnv(proxyUrl) {
  return {
    ...process.env,
    ...(proxyUrl
      ? {
          https_proxy: proxyUrl,
          http_proxy: proxyUrl,
          HTTPS_PROXY: proxyUrl,
          HTTP_PROXY: proxyUrl,
        }
      : {}),
  };
}

class GeminiLanguageModel {
  constructor(modelId) {
    this.modelId = modelId;
  }

  async doGenerate(options) {
    const { prompt, mode } = options;
    const stream = mode?.type === 'object-stream';
    
    const proxyUrl = loadProxyConfig();
    
    // prompt is directly the messages array
    const messages = Array.isArray(prompt) ? prompt : (prompt?.messages || []);
    
    // Convert messages to a single prompt
    const promptText = messages
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
    
    if (!promptText.trim()) {
      throw new Error('No prompt text provided');
    }
    
    const args = [
      '--prompt', promptText,
      '-o', stream ? 'stream-json' : 'json',
      '-m', this.modelId,
      '--approval-mode', 'plan'
    ];
    
    if (stream) {
      return streamResponse(args, proxyUrl, options.abortSignal);
    } else {
      return getResponse(args, proxyUrl);
    }
  }

  doStream(options) {
    return this.doGenerate({ ...options, mode: { type: 'object-stream' } });
  }
}

function streamResponse(args, proxyUrl, abortSignal) {
  const gemini = spawn('gemini', args, {
    env: createGeminiEnv(proxyUrl)
  });
  
  let buffer = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let textStarted = false;
  
  const stream = new ReadableStream({
    start(controller) {
      const abort = () => gemini.kill();
      abortSignal?.addEventListener?.('abort', abort, { once: true });
      gemini.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.type === 'message' && data.role === 'assistant' && data.content) {
              if (!textStarted) {
                controller.enqueue({ type: 'text-start', id: '0' });
                textStarted = true;
              }
              controller.enqueue({
                type: 'text-delta',
                id: '0',
                delta: data.content
              });
            }
            if (data.type === 'result' && data.stats) {
              totalInputTokens = data.stats.input_tokens || data.stats.input || 0;
              totalOutputTokens = data.stats.output_tokens || 0;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      });
      
      gemini.stderr.on('data', () => {});
      
      gemini.on('close', (code) => {
        if (code !== 0) {
          controller.error(new Error(`Gemini CLI exited with code ${code}`));
        } else {
          if (textStarted) {
            controller.enqueue({ type: 'text-end', id: '0' });
          }
          controller.enqueue({ 
            type: 'finish', 
            finishReason: decorateFinishReason('stop'),
            usage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              totalTokens: totalInputTokens + totalOutputTokens
            }
          });
          controller.close();
        }
        abortSignal?.removeEventListener?.('abort', abort);
      });
    },
    cancel() {
      gemini.kill();
    }
  });
  
  return { stream };
}

function getResponse(args, proxyUrl) {
  return new Promise((resolve, reject) => {
    const gemini = spawn('gemini', args, {
      env: createGeminiEnv(proxyUrl)
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
      if (code !== 0) {
        reject(new Error(`Gemini CLI failed: ${stderr}`));
        return;
      }
      
      try {
        const data = JSON.parse(stdout);
        resolve({
          text: data.response || '',
          finishReason: decorateFinishReason('stop'),
          usage: {
            inputTokens: data.stats?.tokens?.input || 0,
            outputTokens: data.stats?.tokens?.candidates || 0,
            totalTokens: (data.stats?.tokens?.input || 0) + (data.stats?.tokens?.candidates || 0)
          }
        });
      } catch (e) {
        reject(new Error(`Failed to parse Gemini response: ${e.message}`));
      }
    });
  });
}

export function createGeminiCLIProvider() {
  return {
    languageModel(modelId) {
      return new GeminiLanguageModel(modelId);
    },
    textEmbeddingModel() {
      throw new Error('Gemini CLI provider does not support text embeddings');
    },
    imageModel() {
      throw new Error('Gemini CLI provider does not support image models');
    }
  };
}
