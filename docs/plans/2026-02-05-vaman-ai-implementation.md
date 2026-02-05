# Vaman-AI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a lightweight personal AI assistant with Discord, Gmail, CLI, and voice interfaces, powered by a WebSocket gateway on top of pi-mono's agentic harness.

**Architecture:** TypeScript monorepo using npm workspaces. Gateway process manages all channels and sessions via WebSocket. Each channel adapter connects to the gateway. Agent runtime wraps @mariozechner/pi-agent-core and pi-ai for multi-provider LLM access.

**Tech Stack:** TypeScript (ESM), Node.js >= 22, pi-agent-core, pi-ai, discord.js, googleapis, ws, chokidar, croner, commander, vitest, biome

**Design Doc:** `docs/plans/2026-02-05-vaman-ai-design.md`

---

## Phase 1: Foundation (Monorepo + Agent + Basic CLI)

### Task 1: Scaffold Monorepo Root

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `biome.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `.env`
- Create: `AGENTS.md`

**Step 1: Create root package.json**

```json
{
  "name": "vaman-ai",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "clean": "npm run clean --workspaces --if-present",
    "build": "npm run build --workspaces --if-present",
    "dev": "npm run dev --workspaces --if-present",
    "check": "biome check --write . && tsc --noEmit",
    "test": "npm run test --workspaces --if-present"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.3.5",
    "@types/node": "^22.10.5",
    "typescript": "^5.9.2",
    "vitest": "^3.2.4",
    "tsx": "^4.20.3"
  },
  "engines": {
    "node": ">=22.0.0"
  }
}
```

**Step 2: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "moduleResolution": "Node16",
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "paths": {
      "@vaman-ai/shared": ["./packages/shared/src/index.ts"],
      "@vaman-ai/shared/*": ["./packages/shared/src/*"],
      "@vaman-ai/agent": ["./packages/agent/src/index.ts"],
      "@vaman-ai/agent/*": ["./packages/agent/src/*"],
      "@vaman-ai/gateway": ["./packages/gateway/src/index.ts"],
      "@vaman-ai/gateway/*": ["./packages/gateway/src/*"]
    }
  },
  "include": ["packages/*/src/**/*", "packages/*/test/**/*"],
  "exclude": ["**/dist/**"]
}
```

**Step 4: Create biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.3.5/schema.json",
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "noNonNullAssertion": "off",
        "useConst": "error"
      },
      "suspicious": {
        "noExplicitAny": "off"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "lineWidth": 100
  },
  "files": {
    "includes": [
      "packages/*/src/**/*.ts",
      "packages/*/test/**/*.ts",
      "!**/node_modules/**/*"
    ]
  }
}
```

**Step 5: Create .gitignore**

```
node_modules/
dist/
.env
config/credentials/
data/sessions/
data/reports/
data/podcasts/
data/cron/runs/
data/logs/
*.log
.DS_Store
```

**Step 6: Create .env.example**

```bash
# LLM Providers
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
OPENROUTER_API_KEY=
GEMINI_API_KEY=

# Default model (OpenRouter format)
DEFAULT_MODEL=google/gemini-3.0-flash
DEFAULT_PROVIDER=openrouter

# Discord
DISCORD_BOT_TOKEN=

# Gmail
GMAIL_CREDENTIALS_PATH=./config/credentials/gmail-oauth.json
GMAIL_ADDRESS=

# Gateway
GATEWAY_PORT=18790
```

**Step 7: Create .env with actual keys**

Populate from user's existing keys (Anthropic, OpenAI, OpenRouter, Gemini, Discord bot token). Copy Gmail credentials.json to `config/credentials/gmail-oauth.json`.

**Step 8: Create AGENTS.md**

```markdown
# Vaman-AI Agent Rules

## Code Style
- TypeScript ESM, strict mode
- Tab indentation, 100 char line width
- Use biome for formatting: `npm run check`

## Git Rules
- Never use `git add -A` or `git add .`
- Stage specific files only
- Commit messages: `type(scope): description`

## Testing
- Run `npm test` before committing
- Colocated tests: `src/foo.ts` -> `test/foo.test.ts`

## Package Structure
Each package in `packages/` has: `src/`, `test/`, `package.json`, `tsconfig.json`
```

**Step 9: Commit**

```bash
git add package.json tsconfig.base.json tsconfig.json biome.json .gitignore .env.example AGENTS.md
git commit -m "feat: scaffold monorepo root"
```

---

### Task 2: Create packages/shared

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/config.ts`
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/logger.ts`
- Test: `packages/shared/test/config.test.ts`

**Step 1: Write failing test for config loader**

```typescript
// packages/shared/test/config.test.ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads config from environment variables", () => {
    process.env.GATEWAY_PORT = "18790";
    process.env.DEFAULT_MODEL = "google/gemini-3.0-flash";
    process.env.DEFAULT_PROVIDER = "openrouter";

    const config = loadConfig();

    expect(config.gateway.port).toBe(18790);
    expect(config.agent.defaultModel).toBe("google/gemini-3.0-flash");
    expect(config.agent.defaultProvider).toBe("openrouter");
  });

  it("uses defaults when env vars are missing", () => {
    delete process.env.GATEWAY_PORT;
    const config = loadConfig();
    expect(config.gateway.port).toBe(18790);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run test/config.test.ts`
Expected: FAIL - module not found

**Step 3: Create package.json for shared**

```json
{
  "name": "@vaman-ai/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist",
    "test": "vitest run"
  },
  "dependencies": {
    "dotenv": "^16.4.7"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

**Step 4: Create tsconfig.json for shared**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

**Step 5: Implement types.ts**

```typescript
// packages/shared/src/types.ts

export interface VamanConfig {
  gateway: {
    port: number;
    host: string;
  };
  agent: {
    defaultModel: string;
    defaultProvider: string;
  };
  discord: {
    token: string;
    enabled: boolean;
  };
  gmail: {
    credentialsPath: string;
    address: string;
    enabled: boolean;
    pollIntervalMs: number;
  };
  heartbeat: {
    enabled: boolean;
    intervalMs: number;
    activeHoursStart: string;
    activeHoursEnd: string;
    defaultDelivery: string;
  };
}

export interface SessionKey {
  agent: string;
  channel: string;
  target: string;
}

export interface OutboundMessage {
  text?: string;
  files?: Array<{ name: string; data: Buffer; mimeType: string }>;
  replyTo?: string;
}

export interface ChannelHealth {
  name: string;
  connected: boolean;
  lastActivity?: Date;
  error?: string;
}

export interface ChannelAdapter {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(target: string, message: OutboundMessage): Promise<void>;
  health(): ChannelHealth;
}

// Gateway wire protocol
export type GatewayRequest = {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type GatewayResponse = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
};

export type GatewayEvent = {
  type: "event";
  event: string;
  payload?: unknown;
};

export type GatewayMessage = GatewayRequest | GatewayResponse | GatewayEvent;
```

**Step 6: Implement config.ts**

```typescript
// packages/shared/src/config.ts
import type { VamanConfig } from "./types.js";

export function loadConfig(): VamanConfig {
  return {
    gateway: {
      port: parseInt(process.env.GATEWAY_PORT || "18790", 10),
      host: process.env.GATEWAY_HOST || "127.0.0.1",
    },
    agent: {
      defaultModel: process.env.DEFAULT_MODEL || "google/gemini-3.0-flash",
      defaultProvider: process.env.DEFAULT_PROVIDER || "openrouter",
    },
    discord: {
      token: process.env.DISCORD_BOT_TOKEN || "",
      enabled: !!process.env.DISCORD_BOT_TOKEN,
    },
    gmail: {
      credentialsPath: process.env.GMAIL_CREDENTIALS_PATH || "./config/credentials/gmail-oauth.json",
      address: process.env.GMAIL_ADDRESS || "",
      enabled: !!process.env.GMAIL_ADDRESS,
      pollIntervalMs: parseInt(process.env.GMAIL_POLL_INTERVAL_MS || "60000", 10),
    },
    heartbeat: {
      enabled: process.env.HEARTBEAT_ENABLED !== "false",
      intervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || "1800000", 10),
      activeHoursStart: process.env.HEARTBEAT_ACTIVE_START || "08:00",
      activeHoursEnd: process.env.HEARTBEAT_ACTIVE_END || "22:00",
      defaultDelivery: process.env.HEARTBEAT_DELIVERY || "discord:dm",
    },
  };
}
```

**Step 7: Implement logger.ts**

```typescript
// packages/shared/src/logger.ts

const DEBUG = process.env.VAMAN_DEBUG === "true";

export function createLogger(prefix: string) {
  return {
    info: (msg: string, ...args: unknown[]) => {
      console.log(`[${prefix}] ${msg}`, ...args);
    },
    error: (msg: string, ...args: unknown[]) => {
      console.error(`[${prefix}] ERROR: ${msg}`, ...args);
    },
    debug: (msg: string, ...args: unknown[]) => {
      if (DEBUG) {
        console.log(`[${prefix}] DEBUG: ${msg}`, ...args);
      }
    },
    warn: (msg: string, ...args: unknown[]) => {
      console.warn(`[${prefix}] WARN: ${msg}`, ...args);
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
```

**Step 8: Create index.ts barrel export**

```typescript
// packages/shared/src/index.ts
export * from "./types.js";
export * from "./config.js";
export * from "./logger.js";
```

**Step 9: Run tests**

Run: `cd packages/shared && npx vitest run`
Expected: PASS

**Step 10: Commit**

```bash
git add packages/shared/
git commit -m "feat(shared): add config, types, and logger"
```

---

### Task 3: Create packages/agent (Pi wrapper)

**Files:**
- Create: `packages/agent/package.json`
- Create: `packages/agent/tsconfig.json`
- Create: `packages/agent/src/index.ts`
- Create: `packages/agent/src/vaman-agent.ts`
- Create: `packages/agent/src/providers.ts`
- Test: `packages/agent/test/providers.test.ts`

**Step 1: Write failing test for provider setup**

```typescript
// packages/agent/test/providers.test.ts
import { describe, it, expect } from "vitest";
import { resolveProvider } from "../src/providers.js";

describe("resolveProvider", () => {
  it("resolves openrouter provider config", () => {
    const provider = resolveProvider("openrouter", "google/gemini-3.0-flash");
    expect(provider.name).toBe("openrouter");
    expect(provider.model).toBe("google/gemini-3.0-flash");
  });

  it("resolves anthropic provider config", () => {
    const provider = resolveProvider("anthropic", "claude-sonnet-4-5-20250929");
    expect(provider.name).toBe("anthropic");
  });

  it("resolves openai provider config", () => {
    const provider = resolveProvider("openai", "gpt-4o");
    expect(provider.name).toBe("openai");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx vitest run test/providers.test.ts`
Expected: FAIL

**Step 3: Create package.json**

```json
{
  "name": "@vaman-ai/agent",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist",
    "test": "vitest run"
  },
  "dependencies": {
    "@mariozechner/pi-ai": "^0.51.6",
    "@mariozechner/pi-agent-core": "^0.51.6",
    "@vaman-ai/shared": "*"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

**Step 4: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

**Step 5: Implement providers.ts**

```typescript
// packages/agent/src/providers.ts

export interface ProviderConfig {
  name: string;
  model: string;
  apiKeyEnv: string;
}

const PROVIDER_MAP: Record<string, { apiKeyEnv: string }> = {
  openrouter: { apiKeyEnv: "OPENROUTER_API_KEY" },
  anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" },
  openai: { apiKeyEnv: "OPENAI_API_KEY" },
  google: { apiKeyEnv: "GEMINI_API_KEY" },
};

export function resolveProvider(name: string, model: string): ProviderConfig {
  const provider = PROVIDER_MAP[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}. Available: ${Object.keys(PROVIDER_MAP).join(", ")}`);
  }
  return { name, model, apiKeyEnv: provider.apiKeyEnv };
}

export function getApiKey(provider: ProviderConfig): string {
  const key = process.env[provider.apiKeyEnv];
  if (!key) {
    throw new Error(`Missing API key: set ${provider.apiKeyEnv} environment variable`);
  }
  return key;
}
```

**Step 6: Implement vaman-agent.ts**

```typescript
// packages/agent/src/vaman-agent.ts
import { Agent } from "@mariozechner/pi-agent-core";
import type { VamanConfig } from "@vaman-ai/shared";
import { resolveProvider, getApiKey } from "./providers.js";
import { createLogger } from "@vaman-ai/shared";

const log = createLogger("agent");

export interface VamanAgentOptions {
  config: VamanConfig;
  systemPrompt?: string;
  tools?: any[];
}

export async function createVamanAgent(options: VamanAgentOptions): Promise<Agent> {
  const { config, systemPrompt, tools } = options;
  const provider = resolveProvider(config.agent.defaultProvider, config.agent.defaultModel);
  const apiKey = getApiKey(provider);

  log.info(`Creating agent with provider=${provider.name} model=${provider.model}`);

  const agent = new Agent({
    apiKey,
    provider: provider.name,
    model: provider.model,
    systemPrompt: systemPrompt || getDefaultSystemPrompt(),
    tools: tools || [],
  });

  return agent;
}

function getDefaultSystemPrompt(): string {
  return `You are Vaman, a personal AI assistant. You help your user across Discord, Gmail, terminal, and voice.

You have access to tools for web search, file management, and system control. Be concise, helpful, and proactive.

When you don't know something, say so. When you can help, do it efficiently.`;
}
```

**Step 7: Create index.ts**

```typescript
// packages/agent/src/index.ts
export * from "./vaman-agent.js";
export * from "./providers.js";
```

**Step 8: Run tests**

Run: `cd packages/agent && npx vitest run`
Expected: PASS (provider tests pass; agent creation needs API key so is integration-level)

**Step 9: Commit**

```bash
git add packages/agent/
git commit -m "feat(agent): wrap pi-agent-core with multi-provider support"
```

---

### Task 4: Create packages/cli (Basic interactive mode)

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/cli.ts`
- Create: `packages/cli/src/commands/chat.ts`

**Step 1: Create package.json**

```json
{
  "name": "@vaman-ai/cli",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "vaman": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "start": "tsx src/cli.ts"
  },
  "dependencies": {
    "@vaman-ai/shared": "*",
    "@vaman-ai/agent": "*",
    "commander": "^13.1.0",
    "dotenv": "^16.4.7",
    "readline": "^1.3.0"
  },
  "devDependencies": {
    "vitest": "^3.2.4",
    "tsx": "^4.20.3"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

**Step 3: Implement cli.ts (entry point)**

```typescript
#!/usr/bin/env node
// packages/cli/src/cli.ts
import { Command } from "commander";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env from monorepo root
config({ path: resolve(import.meta.dirname, "../../../.env") });

import { chatCommand } from "./commands/chat.js";

const program = new Command();

program
  .name("vaman")
  .description("Vaman AI - Personal AI Assistant")
  .version("0.1.0");

program
  .command("chat")
  .description("Start interactive chat session")
  .action(chatCommand);

// Default to chat if no command given
program.action(chatCommand);

program.parse();
```

**Step 4: Implement commands/chat.ts**

```typescript
// packages/cli/src/commands/chat.ts
import { createInterface } from "readline";
import { loadConfig, createLogger } from "@vaman-ai/shared";
import { createVamanAgent } from "@vaman-ai/agent";

const log = createLogger("cli");

export async function chatCommand() {
  const config = loadConfig();
  log.info(`Starting Vaman AI (${config.agent.defaultProvider}/${config.agent.defaultModel})`);

  const agent = await createVamanAgent({ config });

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\nvaman> ",
  });

  console.log("Vaman AI ready. Type your message (Ctrl+C to exit).\n");
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === "/quit" || input === "/exit") {
      console.log("Goodbye!");
      process.exit(0);
    }

    try {
      process.stdout.write("\nvaman: ");

      agent.subscribe((event) => {
        if (event.type === "message_update" && event.content) {
          process.stdout.write(event.content);
        }
        if (event.type === "message_end") {
          console.log("");
          rl.prompt();
        }
      });

      await agent.prompt(input);
    } catch (err) {
      log.error("Agent error:", err);
      rl.prompt();
    }
  });

  rl.on("close", () => {
    console.log("\nGoodbye!");
    process.exit(0);
  });
}
```

**Step 5: Create index.ts**

```typescript
// packages/cli/src/index.ts
export * from "./commands/chat.js";
```

**Step 6: Install dependencies and test**

Run: `cd /Users/anoopsharma/Desktop/vaman-ai && npm install`
Run: `cd packages/cli && npx tsx src/cli.ts`
Expected: Interactive prompt appears, can send a message and get a response

**Step 7: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): add basic interactive chat command"
```

---

### Task 5: npm install, build, and smoke test

**Step 1: Install all dependencies**

Run: `cd /Users/anoopsharma/Desktop/vaman-ai && npm install`

**Step 2: Build all packages**

Run: `npm run build`
Expected: All packages compile without errors

**Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Smoke test the CLI**

Run: `cd packages/cli && npx tsx src/cli.ts`
Expected: Can chat with the agent interactively

**Step 5: Commit any fixes**

```bash
git add -A && git commit -m "feat: Phase 1 complete - foundation with agent and CLI"
```

---

## Phase 2: Gateway

### Task 6: Create packages/gateway - WebSocket server

**Files:**
- Create: `packages/gateway/package.json`
- Create: `packages/gateway/tsconfig.json`
- Create: `packages/gateway/src/index.ts`
- Create: `packages/gateway/src/server.ts`
- Create: `packages/gateway/src/session-manager.ts`
- Create: `packages/gateway/src/restart-sentinel.ts`
- Create: `packages/gateway/src/config-watcher.ts`
- Test: `packages/gateway/test/server.test.ts`
- Test: `packages/gateway/test/session-manager.test.ts`

**Key dependencies:** `ws`, `chokidar`, `croner`

**What it does:**
- WebSocket server on `ws://127.0.0.1:18790`
- JSON-RPC wire protocol (req/res/event)
- Session manager: JSONL files in `data/sessions/`, hierarchical keys
- Restart sentinel: write/read `data/restart-sentinel.json`
- Config watcher: hot-reload via chokidar
- Health tick every 30s

### Task 7: Add heartbeat runner to gateway

**Files:**
- Create: `packages/gateway/src/heartbeat.ts`
- Create: `data/heartbeat/HEARTBEAT.md`
- Test: `packages/gateway/test/heartbeat.test.ts`

**What it does:**
- Reads `data/heartbeat/HEARTBEAT.md` on configurable interval
- If content exists, runs agent with heartbeat prompt
- Delivers response to configured channel
- Respects active hours

### Task 8: Add cron service to gateway

**Files:**
- Create: `packages/gateway/src/cron-service.ts`
- Create: `data/cron/jobs.json`
- Test: `packages/gateway/test/cron-service.test.ts`

**What it does:**
- Schedule types: at, every, cron (via croner)
- Isolated sessions per job
- Job CRUD via API
- Run history in `data/cron/runs/`

### Task 9: Add gateway tool (agent self-management)

**Files:**
- Create: `packages/gateway/src/tools/gateway-tool.ts`
- Test: `packages/gateway/test/tools/gateway-tool.test.ts`

**What it does:**
- Agent tool for: restart, config.get, config.patch, cron.add/remove/list
- SIGUSR1-based restart on macOS
- Restart sentinel for continuity

### Task 10: Add daemon management to CLI

**Files:**
- Create: `packages/cli/src/commands/start.ts`
- Create: `packages/cli/src/commands/stop.ts`
- Create: `packages/cli/src/commands/status.ts`
- Create: `scripts/com.vaman-ai.gateway.plist`

**What it does:**
- `vaman start` - start gateway (LaunchAgent or foreground)
- `vaman stop` - stop gateway
- `vaman restart` - restart
- `vaman status` - health check
- `vaman logs` - tail logs
- LaunchAgent plist for auto-start

### Task 11: Commit Phase 2

```bash
git add packages/gateway/ packages/cli/src/commands/ scripts/ data/
git commit -m "feat(gateway): WebSocket server with sessions, heartbeat, cron, self-restart"
```

---

## Phase 3: Channel Adapters

### Task 12: Discord adapter

**Files:**
- Create: `packages/discord/package.json`
- Create: `packages/discord/tsconfig.json`
- Create: `packages/discord/src/index.ts`
- Create: `packages/discord/src/adapter.ts`
- Create: `packages/discord/src/slash-commands.ts`
- Test: `packages/discord/test/adapter.test.ts`

**Key dependencies:** `discord.js`

**What it does:**
- Connect to Discord via bot token
- Listen for DMs and guild messages
- Route to gateway sessions: `agent:main:discord:dm`, `agent:main:discord:channel:<id>`
- Slash commands: `/ask`, `/sessions`, `/new`, `/status`
- Message chunking (2000 char limit)
- File uploads (8MB limit)
- User allowlist

### Task 13: Gmail adapter

**Files:**
- Create: `packages/gmail/package.json`
- Create: `packages/gmail/tsconfig.json`
- Create: `packages/gmail/src/index.ts`
- Create: `packages/gmail/src/adapter.ts`
- Create: `packages/gmail/src/auth.ts`
- Test: `packages/gmail/test/adapter.test.ts`

**Key dependencies:** `googleapis`

**What it does:**
- OAuth2 flow (first-time browser auth, then refresh token)
- Poll inbox every 60s for emails to designated address only
- Route to sessions: `agent:main:gmail:<sender>`
- Reply-to-thread with agent response
- Attachment support both ways
- Sender allowlist (optional)

### Task 14: Add session browser to CLI

**Files:**
- Create: `packages/cli/src/commands/sessions.ts`
- Create: `packages/cli/src/commands/resume.ts`

**What it does:**
- `vaman sessions` - list all sessions across all channels
- `vaman resume <session-id>` - continue any session from terminal

### Task 15: Commit Phase 3

```bash
git add packages/discord/ packages/gmail/ packages/cli/src/commands/sessions.ts packages/cli/src/commands/resume.ts
git commit -m "feat(channels): add Discord and Gmail adapters with session browser"
```

---

## Phase 4: Skills

### Task 16: Skill discovery system

**Files:**
- Create: `packages/skills/package.json`
- Create: `packages/skills/tsconfig.json`
- Create: `packages/skills/src/index.ts`
- Create: `packages/skills/src/loader.ts`
- Test: `packages/skills/test/loader.test.ts`

**What it does:**
- Scan `data/skills/` and `packages/skills/built-in/` for `.md` files
- Parse YAML frontmatter (name, description)
- Inject into system prompt as XML blocks
- Auto-discover on heartbeat or `vaman reload`

### Task 17: Deep research skill

**Files:**
- Create: `packages/skills/built-in/deep-research/SKILL.md`
- Create: `packages/skills/src/tools/web-search.ts`
- Create: `packages/skills/src/tools/web-fetch.ts`

**What it does:**
- Skill markdown with instructions for structured research
- Web search tool (via OpenRouter or dedicated search API)
- Web fetch tool for reading pages
- Output to `data/reports/YYYY-MM-DD-<topic>.md`
- Deliver via originating channel

### Task 18: Podcast skill

**Files:**
- Create: `packages/skills/built-in/podcast/SKILL.md`
- Create: `packages/skills/src/tools/tts-generate.ts`

**What it does:**
- Skill markdown for podcast script generation
- TTS tool wrapping Kokoro via mlx-audio subprocess
- Output MP3/WAV to `data/podcasts/`
- Deliver audio file to channel

### Task 19: Commit Phase 4

```bash
git add packages/skills/ data/skills/
git commit -m "feat(skills): add skill loader, deep-research, and podcast skills"
```

---

## Phase 5: Voice

### Task 20: Voice adapter

**Files:**
- Create: `packages/voice/package.json`
- Create: `packages/voice/tsconfig.json`
- Create: `packages/voice/src/index.ts`
- Create: `packages/voice/src/adapter.ts`
- Create: `packages/voice/src/stt.ts` (Parakeet via mlx-audio)
- Create: `packages/voice/src/tts.ts` (Kokoro via mlx-audio)
- Create: `packages/cli/src/commands/talk.ts`

**What it does:**
- `vaman talk` enters voice mode
- Parakeet STT via Python subprocess (mlx-audio)
- Kokoro TTS via Python subprocess (mlx-audio)
- Shares CLI session context
- Flow: mic -> STT -> text -> agent -> TTS -> speaker
- Push-to-talk or VAD (voice activity detection)

### Task 21: Commit Phase 5

```bash
git add packages/voice/ packages/cli/src/commands/talk.ts
git commit -m "feat(voice): add Parakeet STT + Kokoro TTS voice mode"
```

---

## Phase 6: Polish & Publish

### Task 22: Onboard wizard

**Files:**
- Create: `scripts/onboard.ts`
- Modify: `packages/cli/src/cli.ts` (add onboard command)

**What it does:**
- `vaman onboard` - interactive setup
- Walk through: API keys, Discord bot, Gmail OAuth, voice setup, LaunchAgent
- Write `.env` file
- Copy Gmail credentials

### Task 23: README and docs

**Files:**
- Create: `README.md`
- Create: `docs/setup-discord.md`
- Create: `docs/setup-gmail.md`
- Create: `docs/setup-voice.md`
- Create: `docs/extending.md`
- Create: `LICENSE`

### Task 24: Final commit and tag

```bash
git add .
git commit -m "feat: vaman-ai v0.1.0 - personal AI assistant"
git tag v0.1.0
```

---

## Dependency Install Order

1. `npm install` at root (creates workspaces)
2. Build shared first, then agent, then gateway, then channels/cli
3. `npm run build` handles the order via workspace scripts

## Key Commands Reference

```bash
# Development
npm install          # Install all dependencies
npm run build        # Build all packages
npm run check        # Lint + typecheck
npm test             # Run all tests

# Usage
vaman                # Interactive chat (default)
vaman chat           # Explicit chat mode
vaman start          # Start gateway daemon
vaman stop           # Stop gateway
vaman status         # Health check
vaman sessions       # Browse all sessions
vaman resume <id>    # Resume a session
vaman talk           # Voice mode
vaman onboard        # Setup wizard
vaman logs           # Tail gateway logs
```
