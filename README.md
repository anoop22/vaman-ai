# Vaman AI

A lightweight personal AI assistant with Discord, Gmail, CLI, and voice interfaces. Built on [pi-mono](https://github.com/mariozechner/pi-mono)'s agentic harness with multi-provider LLM support.

## Features

- **Multi-channel**: Discord, Gmail, CLI, and Voice
- **WebSocket Gateway**: Central hub managing sessions, heartbeats, and cron jobs
- **Multi-provider LLM**: OpenRouter, Anthropic, OpenAI, Google via pi-agent-core
- **Voice mode**: Parakeet STT + Kokoro TTS on Apple Silicon (mlx-audio)
- **Skills system**: Extensible markdown-based skills with YAML frontmatter
- **Self-management**: Hot-reload config, self-restart, LaunchAgent daemon

## Quick Start

```bash
# Clone and install
git clone https://github.com/yourusername/vaman-ai.git
cd vaman-ai
npm install

# Run setup wizard
npm run build
npx vaman onboard

# Start chatting
npx vaman chat
```

## Commands

```bash
vaman              # Interactive chat (default)
vaman chat         # Explicit chat mode
vaman talk         # Voice conversation mode
vaman start        # Start gateway daemon
vaman stop         # Stop gateway
vaman restart      # Restart gateway
vaman status       # Gateway health check
vaman sessions     # Browse all sessions
vaman resume <id>  # Resume a session
vaman onboard      # Setup wizard
```

## Architecture

```
packages/
  shared/    - Config, types, logger
  agent/     - Pi-agent-core wrapper with multi-provider support
  gateway/   - WebSocket server, sessions, heartbeat, cron
  discord/   - Discord adapter (DMs + guild messages)
  gmail/     - Gmail adapter (OAuth2 polling)
  voice/     - Parakeet STT + Kokoro TTS via mlx-audio
  skills/    - Skill loader + built-in skills
  cli/       - Commander-based CLI entry point
```

## Configuration

Copy `.env.example` to `.env` and fill in your keys, or run `vaman onboard`.

| Variable | Description |
|----------|-------------|
| `DEFAULT_PROVIDER` | LLM provider: openrouter, anthropic, openai, google |
| `DEFAULT_MODEL` | Model ID (e.g., `google/gemini-3-flash-preview`) |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `GMAIL_ADDRESS` | Gmail address for Vaman |
| `GATEWAY_PORT` | WebSocket port (default: 18790) |
| `VOICE_PYTHON_PATH` | Python with mlx-audio installed |

## Voice Setup

Voice mode requires mlx-audio installed in a Python environment:

```bash
pip install mlx-audio
# Set in .env:
# VOICE_PYTHON_PATH=/path/to/python-with-mlx-audio
```

## Skills

Built-in skills live in `packages/skills/built-in/`. User skills go in `data/skills/`.

Each skill is a markdown file with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill does
---
Instructions for the agent when this skill is active.
```

## Development

```bash
npm install          # Install dependencies
npm run build        # Build all packages
npm test             # Run all tests
npm run check        # Lint + typecheck
```

## Requirements

- Node.js >= 22
- macOS (for voice mode with mlx-audio)
- ffmpeg (for audio recording)

## License

MIT
