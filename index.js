import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const GeminiCLIProvider = async () => {
  // Use provider.js for the actual implementation
  const providerFileUrl = new URL(
    existsSync(new URL('./provider.js', import.meta.url)) ? './provider.js' : './provider.ts',
    import.meta.url,
  ).href;

  return {
    async config(config) {
      config.provider = config.provider ?? {};
      const existing = config.provider['gemini-local'] ?? {};

      const builtinModels = {
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
      };

      // User can override models in opencode.json
      const mergedModels = { ...builtinModels, ...(existing.models ?? {}) };

      config.provider['gemini-local'] = {
        ...existing,
        npm: existing.npm ?? providerFileUrl,
        name: existing.name ?? 'Gemini CLI',
        models: mergedModels,
      };
    }
  };
};

export default GeminiCLIProvider;
