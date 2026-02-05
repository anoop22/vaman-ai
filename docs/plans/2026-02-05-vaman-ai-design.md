# Vaman-AI: Personal AI Assistant Design Document

**Date**: 2026-02-05
**Status**: Approved
**Inspired by**: OpenClaw (gateway pattern), Pi-mono (agentic harness)

---

## Overview

Vaman-AI is a lightweight, personal AI assistant that runs on your own machine. It answers you across Discord, Gmail, CLI terminal, and voice -- all through a single WebSocket gateway that manages sessions, heartbeats, cron jobs, and self-restart.

Built as a TypeScript monorepo on top of pi-mono's agentic harness (`@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`), it adopts OpenClaw's gateway architecture in a focused, extensible package that anyone can fork and customize.

## Key Decisions

| Decision | Choice |
|----------|--------|
| Project name | vaman-ai |
| Location | `/Users/anoopsharma/Desktop/vaman-ai/` |
| Language | TypeScript (ESM, strict) |
| Runtime | Node.js >= 22 |
| Default model | Gemini 3.0 Flash via OpenRouter |
| LLM providers | Anthropic (API), OpenAI (API), Gemini (OpenRouter + Gemini API) |
| Discord | Existing bot (discord.js) |
| Gmail | OAuth2 Desktop app credentials, dedicated address filtering |
| Voice | mlx-audio: Parakeet STT + Kokoro TTS (Apple Silicon) |
| Podcasts | Single-voice Kokoro TTS (Gemini podcast model harness ready) |
| Daemon | LaunchAgent (auto-start) + manual CLI (start/stop/restart) |
| License | MIT |

---

## 1. Monorepo Structure

```
/Users/anoopsharma/Desktop/vaman-ai/
├── packages/
│   ├── gateway/          # WebSocket control plane
│   ├── agent/            # Core agent runtime (wraps pi-agent-core)
│   ├── discord/          # Discord channel adapter
│   ├── gmail/            # Gmail send/receive channel adapter
│   ├── voice/            # mlx-audio: Parakeet STT + Kokoro TTS
│   ├── cli/              # Terminal interface + session browser
│   ├── skills/           # Built-in skills (deep-research, podcast)
│   └── shared/           # Types, config, utilities
├── config/
│   └── default.json      # Default configuration template
├── data/
│   ├── sessions/         # JSONL session transcripts
│   ├── cron/             # Cron job definitions + run history
│   ├── heartbeat/        # HEARTBEAT.md per agent
│   ├── reports/          # Deep research report outputs
│   ├── podcasts/         # Generated podcast audio files
│   └── skills/           # User-added custom skills
├── scripts/
│   └── onboard.ts        # Interactive setup wizard
├── docs/
│   ├── plans/            # Design documents
│   ├── setup-discord.md  # Discord bot setup guide
│   ├── setup-gmail.md    # Gmail OAuth setup guide
│   ├── setup-voice.md    # mlx-audio setup guide
│   └── extending.md      # How to add skills/channels
├── .env.example          # Template for API keys
├── .env                  # Actual keys (gitignored)
├── .gitignore
├── package.json          # npm workspaces root
├── tsconfig.base.json    # Shared TypeScript config
├── biome.json            # Linting/formatting
├── AGENTS.md             # Rules for AI agents
├── README.md             # Quick start + architecture
└── LICENSE               # MIT
```

### Package Dependency Hierarchy

```
shared (types, config, utils)
  └── agent (wraps pi-agent-core + pi-ai)
       ├── gateway (WebSocket server, session manager, heartbeat, cron)
       │    ├── discord (channel adapter)
       │    ├── gmail (channel adapter)
       │    ├── voice (channel adapter)
       │    └── cli (channel adapter + TUI)
       └── skills (deep-research, podcast)
```

---

## 2. Gateway Architecture

The gateway is a long-lived WebSocket server that acts as the control plane for all channels and agent sessions.

### Connection Diagram

```
Discord ──────┐
Gmail ────────┤
Voice ────────┤──> Gateway (ws://127.0.0.1:18790) ──> Pi Agent (RPC)
CLI ──────────┤         │
Cron jobs ────┘         ├── Session Manager
                        ├── Heartbeat Runner
                        ├── Cron Service
                        ├── Config Watcher (hot-reload via chokidar)
                        └── Restart Sentinel
```

### Wire Protocol

JSON-RPC over WebSocket:
- **Requests**: `{type:"req", id, method, params}` -> `{type:"res", id, ok, payload|error}`
- **Events**: `{type:"event", event, payload}` (async, fire-and-forget)

### Startup Sequence

1. Load config + credentials from `.env` and `config/`
2. Start WebSocket server on `:18790`
3. Launch channel adapters (Discord, Gmail)
4. Start cron service + heartbeat runner
5. Check restart sentinel -> notify originating channel if recovering
6. Emit `gateway:ready` event

### Key Behaviors

- **Single process** manages all channels, sessions, and scheduling
- **Config hot-reload**: chokidar watches config files
  - Heartbeat/cron changes: reload in-place
  - Channel changes: restart only affected adapter
  - Core changes: full gateway restart
- **Health tick**: Every 30s broadcasts keepalive to connected clients
- **Maintenance**: Every 60s cleans expired dedupe entries and stale state

### Restart Sentinel

Before restart, writes `data/restart-sentinel.json`:
```json
{
  "kind": "restart|config-apply|update",
  "status": "ok|error",
  "sessionKey": "agent:main:discord:dm",
  "deliveryContext": { "channel": "discord", "target": "dm" },
  "timestamp": "2026-02-05T12:00:00Z"
}
```

On boot, the sentinel is consumed (deleted) and the gateway routes a recovery message back to the originating session/channel.

### Self-Restart

- **macOS**: `launchctl kickstart -k` targeting the LaunchAgent
- **Manual**: `vaman restart` CLI command
- **Agent-initiated**: Via the `gateway` tool the agent has access to

---

## 3. Channel Adapters

All adapters implement a shared interface:

```typescript
interface ChannelAdapter {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(target: string, message: OutboundMessage): Promise<void>;
  health(): ChannelHealth;
}
```

### Discord Adapter (`packages/discord/`)

- **Library**: discord.js
- **Listens**: DMs and configured guild channels
- **Session routing**:
  - DMs -> `agent:main:discord:dm`
  - Guild channels -> `agent:main:discord:channel:<channelId>`
- **Features**: Text, file uploads (8MB), voice notes, threaded replies, message chunking (2000 char limit)
- **Slash commands**: `/ask`, `/sessions`, `/new`, `/status`
- **Access control**: Allowlist of authorized Discord user IDs

### Gmail Adapter (`packages/gmail/`)

- **Library**: Google Gmail API (OAuth2 Desktop app)
- **Mode**: Polling (checks every 60s, configurable)
- **Filtering**: Only processes emails addressed to the designated vaman-ai email address. All other emails are ignored.
- **Session routing**: `agent:main:gmail:<sender-email>`
- **Features**: Reply-to-thread, attachments both directions
- **Sender allowlist**: Optional filter to restrict who can email the agent

### CLI Adapter (`packages/cli/`)

- **Wraps**: pi-coding-agent in RPC mode
- **Commands**:
  - `vaman` -> interactive TUI (default)
  - `vaman sessions` -> browse all sessions across all channels
  - `vaman resume <session-id>` -> continue any session from terminal
  - `vaman status` -> gateway health, channels, active sessions
  - `vaman start/stop/restart` -> daemon management
  - `vaman onboard` -> setup wizard

### Voice Adapter (`packages/voice/`)

- **STT**: Parakeet via mlx-audio (Apple Silicon optimized)
- **TTS**: Kokoro via mlx-audio
- **Mode**: `vaman talk` enters voice mode
- **Session**: Shares CLI session context (voice is an input method, not separate session)
- **Flow**: Mic -> Parakeet STT -> text -> agent -> response -> Kokoro TTS -> speaker

---

## 4. Unified Session Management

### Session Store

All channels share one session store at `data/sessions/`. Each session is a JSONL file.

### Session Key Format

```
agent:main:main                  -> CLI primary session
agent:main:discord:dm            -> Discord DMs
agent:main:discord:channel:<id>  -> Discord guild channel
agent:main:gmail:<email>         -> Email thread from sender
agent:main:voice                 -> Voice mode (shared with CLI)
cron:<jobId>                     -> Isolated cron job session
```

### Cross-Channel Session Access

`vaman sessions` in the terminal shows ALL sessions from every channel. You can `vaman resume <session-id>` to continue any conversation from the terminal, regardless of which channel originated it.

### Session Lifecycle

- **Reset**: Configurable - daily reset time, idle timeout, or manual `/new`
- **Compaction**: When approaching context limits, summarizes older messages while preserving key context
- **Pruning**: Trims old tool results from in-memory context before LLM calls

---

## 5. Heartbeats

Periodic agent wakeup mechanism for proactive communication.

### Configuration

```json
{
  "heartbeat": {
    "enabled": true,
    "every": "30m",
    "activeHours": { "start": "08:00", "end": "22:00" },
    "defaultDelivery": "discord:dm"
  }
}
```

### Flow

1. Check if enabled and within active hours
2. Check if any requests are in-flight (skip if busy)
3. Read `data/heartbeat/HEARTBEAT.md` for instructions
4. If empty/no-op -> `HEARTBEAT_OK` (no cost, no notification)
5. If actionable -> run agent, deliver response to configured channel

### HEARTBEAT.md

User-editable file that tells the agent what to check proactively:

```markdown
- Check if any cron jobs failed since last heartbeat
- If it's Monday morning, summarize my week ahead
- Check for any pending email threads that need follow-up
```

---

## 6. Cron Jobs

Built-in scheduler within the gateway.

### Storage

`data/cron/jobs.json` - persists across restarts.

### Schedule Types

- `at`: One-shot timestamp execution
- `every`: Fixed interval (e.g., "30m", "2h", "1d")
- `cron`: Standard cron expressions with timezone support (via `croner`)

### Execution

Each job runs in an **isolated session** (`cron:<jobId>`) - no conversation carryover between runs. Results are delivered to the configured channel.

### API

The agent can manage cron jobs via the `gateway` tool:
- `gateway.cron.add` - Create a new job
- `gateway.cron.remove` - Delete a job
- `gateway.cron.list` - List all jobs
- `gateway.cron.run` - Force-run a job

### Run History

`data/cron/runs/<jobId>.jsonl` - append-only log of each execution with timestamps, duration, and outcome.

---

## 7. Built-in Skills

### Deep Research (`packages/skills/deep-research/`)

Triggered by: "research X deeply", "deep dive on Y", "write a report about Z"

**Flow**:
1. Web search to gather sources
2. Fetch and read key pages
3. Synthesize into structured report: Executive Summary, Key Findings, Analysis, Sources
4. Save to `data/reports/YYYY-MM-DD-<topic>.md`
5. Deliver via originating channel

### Podcast (`packages/skills/podcast/`)

Triggered by: "make a podcast about X", "turn this report into a podcast"

**Flow**:
1. Generate podcast script (intro, key points, narrative, outro)
2. Feed script to Kokoro TTS via mlx-audio
3. Output MP3/WAV to `data/podcasts/`
4. Send audio file to channel (Discord voice note, email attachment, local playback)

**Future**: Architecture ready to plug in Gemini's podcast model as an alternative backend.

### Custom Skills

Drop a markdown file in `data/skills/`:

```yaml
---
name: my-skill
description: Use when the user asks about X
---
Instructions for the agent...
```

Auto-discovered on heartbeat or `vaman reload`.

---

## 8. Agent Self-Management

### Gateway Tool

The agent has access to a `gateway` tool for self-management:

| Action | Description |
|--------|-------------|
| `gateway.restart` | Restart the gateway (writes sentinel, triggers launchctl) |
| `gateway.config.get` | Read current configuration |
| `gateway.config.patch` | Modify config and hot-reload |
| `gateway.update` | Pull latest code, rebuild, restart |
| `gateway.skill.add` | Install a new skill, reload |
| `gateway.cron.add/remove` | Manage scheduled jobs |

### Self-Improvement Flow

User says on Discord: "Add a skill that summarizes YouTube videos"
1. Agent writes the skill markdown to `data/skills/youtube-summary.md`
2. Agent calls `gateway.skill.add` to reload skills
3. Skill is immediately available - no restart needed

For changes requiring restart (new packages, config changes):
1. Agent writes restart sentinel
2. Triggers `launchctl kickstart`
3. Gateway restarts, reads sentinel, notifies user: "Restarted successfully. New capability is live."

---

## 9. Daemon Management

### LaunchAgent (Auto-start)

Installed at `~/Library/LaunchAgents/com.vaman-ai.gateway.plist`:
- Starts on login
- Auto-restarts on crash
- Logs to `data/logs/gateway.log`

### Manual CLI

```bash
vaman start          # Start the gateway daemon
vaman stop           # Stop it
vaman restart        # Restart it
vaman status         # Health check
vaman logs           # Tail gateway logs
vaman onboard        # First-time setup wizard
```

---

## 10. Publishability

### What Ships

The entire codebase: gateway, all channel adapters, skills framework, CLI, voice. MIT licensed.

### What's Gitignored

```
.env
config/credentials/
data/sessions/
data/reports/
data/podcasts/
data/cron/runs/
node_modules/
```

### Onboarding

`vaman onboard` walks new users through:
1. Which LLM providers to configure (API keys)
2. Discord bot setup (token)
3. Gmail OAuth setup (credentials.json)
4. Voice setup (mlx-audio installation check)
5. Default model selection
6. LaunchAgent installation (optional)

### .env.example

```bash
# LLM Providers
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
OPENROUTER_API_KEY=
GEMINI_API_KEY=

# Default model (OpenRouter format)
DEFAULT_MODEL=google/gemini-3.0-flash

# Discord
DISCORD_BOT_TOKEN=

# Gmail
GMAIL_CREDENTIALS_PATH=./config/credentials/gmail-oauth.json
GMAIL_ADDRESS=your-vaman@gmail.com

# Gateway
GATEWAY_PORT=18790
```

---

## 11. Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js >= 22, TypeScript (ESM) |
| Agent core | @mariozechner/pi-agent-core, pi-ai |
| LLM providers | Anthropic, OpenAI, Gemini (via OpenRouter) |
| WebSocket | ws |
| Discord | discord.js |
| Gmail | googleapis (OAuth2) |
| Voice STT | Parakeet via mlx-audio (Python subprocess) |
| Voice TTS | Kokoro via mlx-audio (Python subprocess) |
| Cron | croner |
| Config watch | chokidar |
| CLI framework | commander |
| Schema validation | @sinclair/typebox |
| Build | tsc, npm workspaces |
| Code quality | Biome |
| Testing | vitest |

---

## 12. Implementation Phases

### Phase 1: Foundation
- Monorepo scaffold (package.json, tsconfig, biome)
- `packages/shared` (types, config loader, logger)
- `packages/agent` (wrap pi-agent-core, multi-provider setup)
- Basic CLI: `vaman` runs agent in interactive mode

### Phase 2: Gateway
- `packages/gateway` (WebSocket server, session manager)
- Restart sentinel
- Config hot-reload
- Health tick
- `vaman start/stop/restart/status`
- LaunchAgent plist

### Phase 3: Channels
- `packages/discord` (adapter, slash commands)
- `packages/gmail` (adapter, polling, OAuth flow)
- `packages/cli` (sessions browser, resume)
- Cross-channel session access

### Phase 4: Automation
- Heartbeat runner + HEARTBEAT.md
- Cron service
- Gateway tool (self-restart, config patch, cron management)

### Phase 5: Skills
- `packages/skills/deep-research`
- `packages/skills/podcast` (Kokoro TTS)
- Custom skill discovery

### Phase 6: Voice
- `packages/voice` (Parakeet STT + Kokoro TTS via mlx-audio)
- `vaman talk` command

### Phase 7: Polish & Publish
- `vaman onboard` wizard
- README, setup docs
- .env.example, .gitignore
- GitHub repo setup
