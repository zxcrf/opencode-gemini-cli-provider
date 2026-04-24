import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let serverProcess = null;
const PORT = 3456;

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

async function waitForServer(port, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok) {
        return true;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function startServer() {
  if (serverProcess) {
    return;
  }

  // Check if server is already running
  try {
    const response = await fetch(`http://localhost:${PORT}/health`);
    if (response.ok) {
      console.log(`[Gemini CLI Provider] Server already running on port ${PORT}`);
      return;
    }
  } catch (e) {
    // Server not running, continue to start it
  }

  const serverPath = join(__dirname, 'server.js');
  
  serverProcess = spawn('node', [serverPath], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: PORT.toString()
    }
  });

  serverProcess.unref();

  serverProcess.on('error', (err) => {
    console.error('[Gemini CLI Provider] Failed to start server:', err);
  });

  // Wait for server to be ready
  const ready = await waitForServer(PORT);
  if (!ready) {
    throw new Error('Failed to start Gemini CLI API server');
  }
}

export const GeminiCLIProvider = async (ctx) => {
  const { client } = ctx;
  
  try {
    // Start the API server
    await startServer();
    
    await client.app.log({
      body: {
        service: 'gemini-cli-provider',
        level: 'info',
        message: `Gemini CLI API server running on http://localhost:${PORT}`
      }
    });
  } catch (error) {
    await client.app.log({
      body: {
        service: 'gemini-cli-provider',
        level: 'error',
        message: `Failed to start server: ${error.message}`
      }
    });
    throw error;
  }
  
  return {
    async config(config) {
      config.provider = config.provider ?? {};
      
      config.provider['gemini-local'] = {
        options: {
          baseURL: `http://localhost:${PORT}/v1`,
          apiKey: 'dummy'
        },
        models: {
          'gemini-3-flash-preview': {
            name: 'Gemini 3 Flash Preview',
            limit: {
              context: 128000,
              output: 64000
            }
          },
          'gemini-3.1-pro-preview': {
            name: 'Gemini 3.1 Pro Preview',
            limit: {
              context: 128000,
              output: 64000
            }
          },
          'gemini-3.1-flash-lite-preview': {
            name: 'Gemini 3.1 Flash Lite Preview',
            limit: {
              context: 128000,
              output: 64000
            }
          }
        }
      };
    }
  };
};

export default GeminiCLIProvider;

function streamResponse(args) {
  const gemini = spawn('gemini', args);
  let buffer = '';
  
  return new ReadableStream({
    start(controller) {
      gemini.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.response) {
              controller.enqueue({
                type: 'content',
                content: data.response
              });
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      });
      
      gemini.stderr.on('data', (chunk) => {
        console.error('Gemini CLI error:', chunk.toString());
      });
      
      gemini.on('close', (code) => {
        if (code !== 0) {
          controller.error(new Error(`Gemini CLI exited with code ${code}`));
        } else {
          controller.close();
        }
      });
    }
  });
}

function getResponse(args) {
  return new Promise((resolve, reject) => {
    const gemini = spawn('gemini', args);
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
          content: data.response || '',
          usage: {
            input: data.stats?.tokens?.input || 0,
            output: data.stats?.tokens?.candidates || 0
          }
        });
      } catch (e) {
        reject(new Error(`Failed to parse Gemini response: ${e.message}`));
      }
    });
  });
}
