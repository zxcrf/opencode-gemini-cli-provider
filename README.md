# OpenCode Gemini CLI Provider

Use Google Gemini models in OpenCode through the Gemini CLI, leveraging its free quota without needing an API key.

## Quick Start

```bash
# 1. Install Gemini CLI (if not already installed)
brew install gemini-cli

# 2. Install the OpenCode plugin
opencode plugin add opencode-gemini-cli-provider

# 3. (Optional) Configure proxy if needed
echo '{"proxy": "http://127.0.0.1:10808"}' > ~/.config/opencode/gemini-proxy.json

# 4. Verify Gemini models are available
opencode models | grep gemini-local

# 5. Start using Gemini!
opencode run "Say hello in Chinese" --model gemini-local/gemini-3.1-flash-lite-preview
```

## Features

- 🆓 Use Gemini CLI's free quota
- 🔌 Automatic API server management
- 🌐 Flexible proxy configuration (environment variable, config file, or none)
- 🚀 Zero configuration after installation
- 🔄 Server auto-starts and runs in background

## Prerequisites

**Gemini CLI** must be installed:
```bash
brew install gemini-cli
```

Verify installation:
```bash
gemini --version
```

## Installation

### Option 1: Install from npm (recommended when published)
```bash
opencode plugin add opencode-gemini-cli-provider
```

### Option 2: Install from local directory
```bash
git clone https://github.com/yourusername/opencode-gemini-cli-provider.git
cd opencode-gemini-cli-provider
npm install
opencode plugin add $(pwd)
```

### Option 3: Add to config manually
Edit `~/.config/opencode/opencode.json`:
```json
{
  "plugin": [
    "opencode-gemini-cli-provider"
  ]
}
```

## Proxy Configuration

The plugin supports three ways to configure proxy (in priority order):

### 1. Environment Variable (Highest Priority)
```bash
export https_proxy=http://127.0.0.1:10808
export http_proxy=http://127.0.0.1:10808
opencode run "test" --model gemini-local/gemini-3.1-flash-lite-preview
```

### 2. Config File
Create `~/.config/opencode/gemini-proxy.json`:
```json
{
  "proxy": "http://127.0.0.1:10808"
}
```

### 3. No Proxy (Default)
If you don't need a proxy, just use it directly:
```bash
opencode run "test" --model gemini-local/gemini-3.1-flash-lite-preview
```

## Usage

After installation, the plugin automatically:
1. Starts a local API server on `http://localhost:3456`
2. Registers the `gemini-local` provider with OpenCode
3. Makes three Gemini models available

### Available Models

- `gemini-local/gemini-3-flash-preview`
- `gemini-local/gemini-3.1-pro-preview`
- `gemini-local/gemini-3.1-flash-lite-preview`

### Example Usage

```bash
# One-off command
opencode run "Say hello in Chinese" --model gemini-local/gemini-3.1-flash-lite-preview

# Interactive mode
opencode --model gemini-local/gemini-3.1-flash-lite-preview
```

### Set as Default Model

Edit `~/.config/opencode/opencode.json`:
```json
{
  "model": "gemini-local/gemini-3.1-flash-lite-preview"
}
```

Then simply:
```bash
opencode run "your prompt"
```

## How It Works

1. The plugin starts a local Express server that wraps Gemini CLI
2. The server provides an OpenAI-compatible API endpoint
3. OpenCode connects to this local server as a standard provider
4. Requests are converted to Gemini CLI commands and responses are formatted back

```
┌─────────────┐      HTTP       ┌──────────────┐     CLI      ┌─────────────┐
│  OpenCode   │ ──────────────> │ Local Server │ ──────────> │ Gemini CLI  │
│             │ <────────────── │ (port 3456)  │ <────────── │             │
└─────────────┘   OpenAI API    └──────────────┘   JSON       └─────────────┘
```

## Configuration

### Custom Port

The server runs on port `3456` by default. To change it, set the `PORT` environment variable:

```bash
PORT=8080 opencode
```

### Custom Proxy

Three ways to configure (in priority order):

1. **Environment variable** (recommended for temporary use):
   ```bash
   export https_proxy=http://your-proxy:port
   ```

2. **Config file** (recommended for permanent use):
   ```bash
   echo '{"proxy": "http://your-proxy:port"}' > ~/.config/opencode/gemini-proxy.json
   ```

3. **No proxy** (default if nothing is configured)

## Troubleshooting

### Server not starting

Check if port 3456 is already in use:
```bash
lsof -i :3456
```

Kill the process if needed:
```bash
kill $(lsof -t -i :3456)
```

### Gemini CLI not found

Ensure Gemini CLI is installed and in your PATH:
```bash
which gemini
gemini --version
```

If not installed:
```bash
brew install gemini-cli
```

### Proxy issues

**Check if proxy is configured:**
```bash
# Check environment variable
echo $https_proxy

# Check config file
cat ~/.config/opencode/gemini-proxy.json
```

**Test proxy manually:**
```bash
export https_proxy=http://127.0.0.1:10808
gemini -p "test" -m gemini-3.1-flash-lite-preview --approval-mode plan -o json
```

### Connection timeout

If requests timeout, the Gemini CLI might be waiting for approval. The plugin uses `--approval-mode plan` to avoid interactive prompts, but you can test manually:

```bash
gemini -p "test" -m gemini-3.1-flash-lite-preview --approval-mode plan -o json
```

### Check server logs

The server logs to stdout. To see logs:

```bash
# Find the server process
ps aux | grep "node.*server.js"

# Or check OpenCode logs
opencode --print-logs
```

### Models not showing up

Verify the plugin is loaded:
```bash
opencode debug config | grep gemini-local
```

Should show:
```json
"gemini-local": {
  "options": {
    "baseURL": "http://localhost:3456/v1",
    "apiKey": "dummy"
  },
  "models": { ... }
}
```

## Uninstallation

```bash
# Remove plugin
opencode plugin remove opencode-gemini-cli-provider

# Stop the server
kill $(lsof -t -i :3456)

# Remove config (optional)
rm ~/.config/opencode/gemini-proxy.json
```

## Development

### Project Structure

```
opencode-gemini-cli-provider/
├── index.js          # Plugin entry point, auto-starts server
├── server.js         # Express API server
├── package.json      # Dependencies
└── README.md         # This file
```

### Running locally

```bash
# Install dependencies
npm install

# Start server manually (for testing)
node server.js

# Test API endpoint
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gemini-3.1-flash-lite-preview", "messages": [{"role": "user", "content": "Hello"}]}'
```

## License

MIT

