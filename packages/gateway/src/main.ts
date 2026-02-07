#!/usr/bin/env node
/**
 * Gateway main entry point. Starts the WebSocket server,
 * channel adapters (Discord), and agent for message handling.
 *
 * Usage: npx tsx packages/gateway/src/main.ts
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";

// Load .env from monorepo root (cwd should be monorepo root)
config({ path: resolve(process.cwd(), ".env") });

import { loadConfig, createLogger } from "@vaman-ai/shared";
import { createVamanAgent, resolveProvider, resolveModel, getProviders, getModels } from "@vaman-ai/agent";
import { DiscordAdapter } from "@vaman-ai/discord";
import { loadSkills, skillsToSystemPrompt } from "@vaman-ai/skills";
import { GatewayServer } from "./server.js";
import { SessionManager } from "./session-manager.js";
import { HeartbeatRunner } from "./heartbeat.js";
import { CronService } from "./cron-service.js";
import { createCronManageTool } from "./tools/cron-manage-tool.js";
import { createGatewayRestartTool } from "./tools/gateway-tool.js";
import {
	WorldModelManager,
	SessionBufferManager,
	ArchiveManager,
	ExtractorService,
	createTransformContext,
	createArchiveSearchTool,
	createArchiveReadTool,
	createStateReadTool,
} from "./state/index.js";
import { registerApiRoutes } from "./api/index.js";

const log = createLogger("gateway:main");

async function main() {
	const vamanConfig = loadConfig();
	const dataDir = resolve(process.cwd(), "data");

	// ── Continuous State initialization ──
	const worldModel = new WorldModelManager(resolve(process.cwd(), vamanConfig.state.worldModelPath));
	const sessionBuffer = new SessionBufferManager(vamanConfig.state.conversationHistory);
	const archive = new ArchiveManager(resolve(process.cwd(), vamanConfig.state.archivePath));
	archive.init();

	// Track the current session key for transformContext closure
	let currentSessionKey = "";

	// Load skills for system prompt
	const builtInDir = resolve(process.cwd(), "packages/skills/built-in");
	const skills = loadSkills(dataDir, builtInDir);
	const skillsPrompt = skillsToSystemPrompt(skills);

	// Create coding tools (read, bash, edit, write)
	const workspaceDir = resolve(process.cwd());
	const toolsModulePath = resolve(process.cwd(), "node_modules/@mariozechner/pi-coding-agent/dist/core/tools/index.js");
	const { createCodingTools } = await import(`file://${toolsModulePath}`);
	const codingTools = createCodingTools(workspaceDir);
	log.info(`Loaded ${codingTools.length} coding tools for workspace: ${workspaceDir}`);

	// Archive tools (search, read, state_read)
	const archiveTools = [
		createArchiveSearchTool(archive),
		createArchiveReadTool(archive),
		createStateReadTool(worldModel),
	];

	// ── Proactive systems: Heartbeat & Cron ──
	// Track last DM user/session for proactive message delivery & session integration
	let lastDMUserId = "";
	let lastDMSessionKey = "";

	// Delivery function — routes proactive messages to Discord channels
	// Called by heartbeat and cron when they have a response to deliver
	async function deliverMessage(channel: string, message: string): Promise<void> {
		if (!discord) {
			log.warn(`Cannot deliver to ${channel}: Discord not connected`);
			return;
		}

		// Parse delivery channel format: "discord:dm", "discord:channel:<id>"
		if (channel === "discord:dm") {
			if (!lastDMUserId) {
				log.warn("Cannot deliver to discord:dm: no DM user known yet");
				return;
			}
			log.info(`Delivering proactive message to DM user ${lastDMUserId}`);
			await discord.send(`dm:${lastDMUserId}`, { text: message });
		} else if (channel.startsWith("discord:channel:")) {
			const channelId = channel.slice("discord:channel:".length);
			log.info(`Delivering proactive message to channel ${channelId}`);
			await discord.send(`channel:${channelId}`, { text: message });
		} else {
			log.warn(`Unknown delivery channel: ${channel}`);
		}
	}

	// Heartbeat — periodic proactive check-ins (reads HEARTBEAT.md)
	// Runs inside the DM session so the agent has conversation context and
	// the exchange gets logged, buffered, and extracted like a normal message.
	const heartbeat = new HeartbeatRunner({
		config: vamanConfig,
		dataDir: dataDir,
		getModelRef: () => getHeartbeatModel().current,
		onHeartbeat: async (prompt) => {
			const sk = lastDMSessionKey;
			if (!sk) {
				log.warn("Heartbeat: no DM session key yet, running without session context");
				return promptAgent(prompt);
			}

			// Set session context so transformContext injects world model + buffer
			currentSessionKey = sk;

			// Lazy restore session buffer from archive if empty
			if (sessionBuffer.isEmpty(sk)) {
				const recentTurns = archive.getRecentTurns(sk, vamanConfig.state.conversationHistory);
				if (recentTurns.length > 0) {
					sessionBuffer.restore(sk, recentTurns.reverse().map((t) => ({
						role: t.role as "user" | "assistant",
						content: t.content,
						timestamp: t.timestamp,
						sessionKey: t.sessionKey,
					})));
					log.info(`Heartbeat: restored ${recentTurns.length} turns for ${sk}`);
				}
			}

			// Append heartbeat prompt as a user turn
			const now = Date.now();
			sessions.append(sk, { role: "user", content: prompt, timestamp: now });
			const userEvicted = sessionBuffer.append(sk, {
				role: "user", content: prompt, timestamp: now, sessionKey: sk,
			});
			if (userEvicted.length > 0) archive.archiveTurns(userEvicted);

			// Swap to heartbeat-specific model if override is set
			const hbOverride = loadHeartbeatModel();
			const primaryProvider = vamanConfig.agent.defaultProvider;
			const primaryModel = vamanConfig.agent.defaultModel;
			let swapped = false;

			if (hbOverride) {
				try {
					swapped = switchModel(hbOverride);
					if (swapped) log.info(`Heartbeat: using override model ${hbOverride}`);
				} catch (err) {
					log.warn(`Heartbeat: failed to switch to ${hbOverride}, using global model: ${err}`);
				}
			}

			try {
				// Get agent response
				const response = await promptAgent(prompt);

				// Append assistant turn
				const assistantNow = Date.now();
				sessions.append(sk, { role: "assistant", content: response, timestamp: assistantNow });
				const assistantEvicted = sessionBuffer.append(sk, {
					role: "assistant", content: response, timestamp: assistantNow, sessionKey: sk,
				});
				if (assistantEvicted.length > 0) archive.archiveTurns(assistantEvicted);

				// Fire extraction so the world model updates from heartbeat exchanges
				extractor.extract({
					userMessage: prompt,
					assistantResponse: response,
					sessionKey: sk,
				});

				return response;
			} finally {
				// Always restore global model after heartbeat
				if (swapped) {
					try { switchModel(`${primaryProvider}/${primaryModel}`); }
					catch (err) { log.error(`Failed to restore primary model after heartbeat: ${err}`); }
				}
			}
		},
		onDeliver: deliverMessage,
	});

	// Cron — scheduled jobs (persisted to data/cron/jobs.json)
	const cron = new CronService(dataDir, {
		onJobRun: (job) => promptAgent(job.prompt),
		onDeliver: deliverMessage,
	});

	// Cron management tool — lets the agent CRUD cron jobs
	const cronTool = createCronManageTool(cron);

	// Tools array — gateway_restart is pushed later after gateway is created
	const allTools = [...codingTools, ...archiveTools, cronTool];

	// Context assembler — replaces agent's internal message array each LLM call
	const transformContext = createTransformContext(worldModel, sessionBuffer, () => currentSessionKey, vamanConfig);

	// Create agent with skills, tools, and transformContext
	const basePrompt = `You are Nova, a personal AI assistant built by Anoop. You chat with your user across Discord, Gmail, terminal, and voice.

Be friendly, natural, and helpful — like a knowledgeable friend, not a corporate chatbot. Match the energy of the conversation: casual when chatting, precise when working on technical tasks. Use your judgment on response length — short answers for simple questions, longer when the topic calls for it.

You have a world model that tracks what you know about your user — it's automatically in your context. You also have archive tools to search past conversations when you need to recall something.

Your source code is at ${workspaceDir}. You can use your tools to read files, run commands, edit code, and explore the filesystem.

Gateway management:
- To restart the gateway, use the gateway_restart tool — NEVER use bash to kill/restart the process directly
- After restarting, you will automatically come back online and confirm in the chat
- Use gateway_restart after making code changes, adding/editing skills, or when configuration needs reloading
- You ARE the gateway process — using bash to kill it would kill you mid-response with no reply`;

	const agent = createVamanAgent({
		config: vamanConfig,
		systemPrompt: basePrompt + skillsPrompt,
		tools: allTools,
		transformContext,
	});

	// Per-request response tracking (prevents cross-talk between concurrent prompts)
	let activeRequest: { id: number; buffer: string; resolve: (text: string) => void } | null = null;
	let requestCounter = 0;
	const requestQueue: Array<{ input: string; resolve: (text: string) => void }> = [];
	let processing = false;

	agent.subscribe((event: any) => {
		log.debug(`Agent event: ${event.type}`);
		if (!activeRequest) return;
		if (event.type === "message_update") {
			const assistantEvent = event.assistantMessageEvent;
			if (assistantEvent?.type === "text_delta") {
				activeRequest.buffer += assistantEvent.delta;
			}
		}
		if (event.type === "message_end" && event.message?.role === "assistant") {
			// Only resolve when the message has actual text content.
			// Skip messages with only thinking blocks, tool calls, or any combo without text —
			// the agent loop will continue and eventually produce a text response.
			const msg = event.message;
			const hasText = msg?.content?.some((c: any) => c.type === "text");
			if (!hasText) {
				const types = msg?.content?.map((c: any) => c.type).join(", ") || "none";
				log.info(`Agent non-text message (req#${activeRequest.id}) [${types}], waiting for text...`);
				return;
			}
			log.info(`Agent response complete (req#${activeRequest.id}), length: ${activeRequest.buffer.length}`);
			activeRequest.resolve(activeRequest.buffer);
			activeRequest = null;
		}
	});

	/** Switch agent to a different model, updating config so getApiKey resolves correctly */
	function switchModel(modelRef: string): boolean {
		const si = modelRef.indexOf("/");
		if (si === -1) return false;
		const prov = modelRef.slice(0, si);
		const mod = modelRef.slice(si + 1);
		const provider = resolveProvider(prov, mod);
		const model = resolveModel(provider);
		agent.setModel(model);
		vamanConfig.agent.defaultProvider = prov;
		vamanConfig.agent.defaultModel = mod;
		return true;
	}

	async function processQueue(): Promise<void> {
		if (processing) return;
		processing = true;
		while (requestQueue.length > 0) {
			const req = requestQueue.shift()!;
			const id = ++requestCounter;
			log.info(`Prompting agent (req#${id}): ${req.input.slice(0, 100)}`);
			activeRequest = { id, buffer: "", resolve: req.resolve };

			// Save primary model so we can restore after fallback
			const primaryProvider = vamanConfig.agent.defaultProvider;
			const primaryModel = vamanConfig.agent.defaultModel;

			try {
				await agent.prompt(req.input);
				log.info(`agent.prompt() resolved (req#${id})`);
			} catch (err) {
				log.error(`Primary model failed (req#${id}): ${err}`);

				// Try fallback models in order
				if (activeRequest?.id === id) {
					const fallbacks = loadFallbacks();
					let recovered = false;

					for (const fb of fallbacks) {
						try {
							log.info(`Trying fallback: ${fb} (req#${id})`);
							switchModel(fb);
							activeRequest.buffer = "";
							await agent.prompt(req.input);
							log.info(`Fallback succeeded: ${fb} (req#${id})`);
							recovered = true;
							break;
						} catch (fbErr) {
							log.error(`Fallback ${fb} also failed (req#${id}): ${fbErr}`);
						}
					}

					// Restore primary model for next request
					try {
						switchModel(`${primaryProvider}/${primaryModel}`);
					} catch (restoreErr) {
						log.error(`Failed to restore primary model: ${restoreErr}`);
					}

					if (!recovered && activeRequest?.id === id) {
						activeRequest.resolve(`Error: all models failed. ${err instanceof Error ? err.message : err}`);
						activeRequest = null;
					}
				}
			}

			// Clear agent's internal messages — our buffer is the source of truth
			agent.clearMessages();

			// If resolve wasn't called by event (edge case), timeout after brief wait
			if (activeRequest?.id === id) {
				await new Promise((r) => setTimeout(r, 500));
				if (activeRequest?.id === id) {
					log.warn(`Timeout waiting for message_end (req#${id}), using buffer`);
					activeRequest.resolve(activeRequest.buffer || "(no response)");
					activeRequest = null;
				}
			}
		}
		processing = false;
	}

	function promptAgent(input: string): Promise<string> {
		return new Promise<string>((resolve) => {
			requestQueue.push({ input, resolve });
			processQueue();
		});
	}

	// Session manager for logging conversations (kept as audit log)
	const sessions = new SessionManager(dataDir);

	// Extractor — uses main agent's model + fallback chain
	const extractor = new ExtractorService(vamanConfig, worldModel, archive, loadFallbacks);

	// Start gateway WebSocket server
	const gateway = new GatewayServer({ config: vamanConfig, dataDir });

	// Gateway restart tool — lets the agent restart itself
	const gatewayRestartTool = createGatewayRestartTool({
		restartManager: gateway.restart,
		getCurrentSessionKey: () => currentSessionKey,
		getDiscordTarget: () => {
			const parts = currentSessionKey.split(":");
			return parts.slice(2).join(":");
		},
	});

	allTools.push(gatewayRestartTool);
	log.info(`Total tools: ${allTools.length} (${codingTools.length} coding + ${archiveTools.length} archive + 1 cron + 1 gateway)`);

	// ── Status data builder ──
	const startedAt = Date.now();

	function getStatus(): object {
		const health = gateway.getHealth();
		const uptimeSec = process.uptime();
		const model = `${vamanConfig.agent.defaultProvider}/${vamanConfig.agent.defaultModel}`;
		const thinkingLevel = agent.state?.thinkingLevel || "off";
		const fallbacks = loadFallbacks();
		const aliases = loadAliases();
		const cronJobs = cron.listJobs();
		const sessionList = sessions.list();
		const worldModelContent = worldModel.load();
		const heartbeatContent = heartbeat.readHeartbeat();
		const heartbeatActive = heartbeat.isActiveHours();

		// Last heartbeat run (read last line of runs.jsonl)
		let lastHeartbeatRun: any = null;
		try {
			const runsPath = resolve(dataDir, "heartbeat", "runs.jsonl");
			if (existsSync(runsPath)) {
				const lines = readFileSync(runsPath, "utf-8").trim().split("\n").filter(Boolean);
				if (lines.length > 0) {
					lastHeartbeatRun = JSON.parse(lines[lines.length - 1]);
				}
			}
		} catch {}

		return {
			// Core
			status: "ok",
			version: "0.1.0",
			node: process.versions.node,
			platform: `${process.platform} ${process.arch}`,
			startedAt,
			uptime: uptimeSec,

			// Gateway
			gateway: {
				host: vamanConfig.gateway.host,
				port: vamanConfig.gateway.port,
				clients: (health as any).clients,
			},

			// Model
			model: {
				current: model,
				thinkingLevel,
				fallbacks,
				aliases,
			},

			// Channels
			channels: {
				discord: {
					enabled: vamanConfig.discord.enabled,
					connected: !!discord,
				},
				gmail: {
					enabled: vamanConfig.gmail.enabled,
				},
			},

			// Heartbeat
			heartbeat: {
				enabled: vamanConfig.heartbeat.enabled,
				intervalMs: vamanConfig.heartbeat.intervalMs,
				activeHours: `${vamanConfig.heartbeat.activeHoursStart}-${vamanConfig.heartbeat.activeHoursEnd}`,
				currentlyActive: heartbeatActive,
				hasContent: !!heartbeatContent,
				delivery: vamanConfig.heartbeat.defaultDelivery,
				lastRun: lastHeartbeatRun,
			},

			// Cron
			cron: {
				jobCount: cronJobs.length,
				jobs: cronJobs.map((j) => ({ name: j.name, schedule: j.schedule, enabled: j.enabled })),
			},

			// Sessions
			sessions: {
				count: sessionList.length,
				recent: sessionList.slice(0, 5),
			},

			// State
			state: {
				worldModelChars: worldModelContent.length,
				conversationHistory: vamanConfig.state.conversationHistory,
				extractionEnabled: vamanConfig.state.extractionEnabled,
			},

			// Skills
			skills: {
				count: skills.length,
				names: skills.map((s) => s.name),
			},
		};
	}

	// ── REST API registration (must happen before gateway.start()) ──
	// Deferred: aliases/fallbacks/switchModel defined below, registered after
	let apiRegistered = false;
	function registerApi() {
		if (apiRegistered) return;
		apiRegistered = true;
		registerApiRoutes(gateway.router, {
			config: vamanConfig,
			worldModel,
			sessions,
			archive,
			cron,
			switchModel,
			loadAliases,
			saveAliases,
			loadFallbacks,
			saveFallbacks,
			getHealth: () => ({
				...gateway.getHealth(),
				model: `${vamanConfig.agent.defaultProvider}/${vamanConfig.agent.defaultModel}`,
				heartbeat: vamanConfig.heartbeat.enabled,
				cronJobs: cron.listJobs().length,
			}),
			getStatus,
			getHeartbeatModel,
			setHeartbeatModel,
			skills,
			dataDir,
			builtInDir,
		});
		log.info("REST API routes registered");
	}

	// Model aliases (persisted to data/model-aliases.json)
	const aliasFile = resolve(dataDir, "model-aliases.json");
	function loadAliases(): Record<string, string> {
		try {
			if (existsSync(aliasFile)) return JSON.parse(readFileSync(aliasFile, "utf-8"));
		} catch {}
		return {};
	}
	function saveAliases(aliases: Record<string, string>): void {
		mkdirSync(dirname(aliasFile), { recursive: true });
		writeFileSync(aliasFile, JSON.stringify(aliases, null, 2), "utf-8");
	}
	function resolveAlias(input: string): string | null {
		const aliases = loadAliases();
		return aliases[input.toLowerCase()] ?? null;
	}

	// Model fallbacks — tried in order when primary model fails
	const fallbackFile = resolve(dataDir, "model-fallbacks.json");
	function loadFallbacks(): string[] {
		try {
			if (existsSync(fallbackFile)) return JSON.parse(readFileSync(fallbackFile, "utf-8"));
		} catch {}
		return [];
	}
	function saveFallbacks(list: string[]): void {
		mkdirSync(dirname(fallbackFile), { recursive: true });
		writeFileSync(fallbackFile, JSON.stringify(list, null, 2), "utf-8");
	}

	// Heartbeat model override (persisted to data/heartbeat/model.json)
	const heartbeatModelFile = resolve(dataDir, "heartbeat", "model.json");
	function loadHeartbeatModel(): string | null {
		try {
			if (existsSync(heartbeatModelFile)) {
				const data = JSON.parse(readFileSync(heartbeatModelFile, "utf-8"));
				return data.ref || null;
			}
		} catch {}
		return null;
	}
	function saveHeartbeatModel(ref: string | null): void {
		mkdirSync(dirname(heartbeatModelFile), { recursive: true });
		writeFileSync(heartbeatModelFile, JSON.stringify({ ref }, null, 2), "utf-8");
	}
	function getHeartbeatModel(): { override: string | null; current: string; inherited: boolean } {
		const override = loadHeartbeatModel();
		const globalModel = `${vamanConfig.agent.defaultProvider}/${vamanConfig.agent.defaultModel}`;
		return { override, current: override || globalModel, inherited: override === null };
	}
	function setHeartbeatModel(ref: string | null): { ok: boolean; error?: string } {
		if (ref === null) {
			saveHeartbeatModel(null);
			return { ok: true };
		}
		const resolved = resolveAlias(ref) || ref;
		if (!resolved.includes("/")) {
			return { ok: false, error: `Invalid model ref: "${resolved}" (must be provider/model)` };
		}
		saveHeartbeatModel(resolved);
		return { ok: true };
	}

	// Register REST API now that all dependencies are available
	registerApi();

	// Gateway-level command handler (intercepts before agent, zero token cost)
	const PROVIDER_ENV_MAP: Record<string, { envVar: string; isOAuth?: boolean }> = {
		openrouter: { envVar: "OPENROUTER_API_KEY" },
		anthropic: { envVar: "ANTHROPIC_API_KEY" },
		openai: { envVar: "OPENAI_API_KEY" },
		google: { envVar: "GEMINI_API_KEY" },
		"openai-codex": { envVar: "", isOAuth: true },
		xai: { envVar: "XAI_API_KEY" },
		groq: { envVar: "GROQ_API_KEY" },
		zai: { envVar: "ZAI_API_KEY" },
		"kimi-coding": { envVar: "KIMI_API_KEY" },
		mistral: { envVar: "MISTRAL_API_KEY" },
		cerebras: { envVar: "CEREBRAS_API_KEY" },
		opencode: { envVar: "OPENCODE_API_KEY" },
		huggingface: { envVar: "HF_TOKEN" },
	};

	function handleCommand(content: string): string | null {
		const trimmed = content.trim();

		// /models or models [provider] - list providers or models for a provider
		const modelsMatch = trimmed.match(/^\/?(models)(?:\s+(.*))?$/i);
		if (modelsMatch) {
			const arg = (modelsMatch[2] ?? "").trim();
			const allProviders = getProviders();

			if (!arg) {
				const lines: string[] = ["**Providers:**\n"];
				for (const p of allProviders) {
					const cfg = PROVIDER_ENV_MAP[p];
					const configured = cfg
						? cfg.isOAuth || (cfg.envVar && process.env[cfg.envVar])
						: false;
					const status = configured ? "\u2713" : "\u2717";
					try {
						const models = getModels(p as any);
						lines.push(`${status} **${p}** (${models.length} models)`);
					} catch {
						lines.push(`${status} **${p}** (error)`);
					}
				}
				const aliases = loadAliases();
				const aliasEntries = Object.entries(aliases);
				if (aliasEntries.length > 0) {
					lines.push("", "**Aliases:**");
					for (const [name, target] of aliasEntries) {
						lines.push(`  **${name}** -> ${target}`);
					}
				}
				lines.push(
					"",
					"Use: `models <provider>` to list models",
					"Switch: `model <alias>` or `model <provider/model>`",
					`Current: **${vamanConfig.agent.defaultProvider}/${vamanConfig.agent.defaultModel}**`,
				);
				return lines.join("\n");
			}

			const provider = arg.toLowerCase();
			if (!allProviders.includes(provider as any)) {
				return `Unknown provider: **${provider}**\n\nAvailable: ${allProviders.join(", ")}`;
			}

			try {
				const models = getModels(provider as any);
				if (models.length === 0) {
					return `**${provider}** \u2014 no models registered`;
				}
				const lines: string[] = [`**${provider}** \u2014 ${models.length} models:\n`];
				for (const m of models) {
					const tags: string[] = [];
					if (m.reasoning) tags.push("reasoning");
					if (m.input.includes("image")) tags.push("vision");
					const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
					const ctx = m.contextWindow
						? ` (${Math.round(m.contextWindow / 1000)}k ctx)`
						: "";
					lines.push(`- ${m.id}${tagStr}${ctx}`);
				}
				lines.push("", "Switch: `/model <provider/model>`");
				return lines.join("\n");
			} catch (err) {
				return `Error loading models for ${provider}: ${err}`;
			}
		}

		// /model or model <ref|alias> - switch model
		const modelMatch = trimmed.match(/^\/?(model)(?:\s+(.+))?$/i);
		if (modelMatch && !trimmed.match(/^\/?(models)/i)) {
			const modelRef = (modelMatch[2] ?? "").trim();
			if (!modelRef) return "Usage: `model <provider/model>` or `model <alias>`";

			let resolved = modelRef;
			const aliasTarget = resolveAlias(modelRef);
			if (aliasTarget) {
				resolved = aliasTarget;
				log.info(`Alias "${modelRef}" -> ${resolved}`);
			}

			const slashIdx = resolved.indexOf("/");
			if (slashIdx === -1) {
				const aliases = loadAliases();
				const available = Object.entries(aliases).map(([a, t]) => `  ${a} -> ${t}`).join("\n");
				return `Unknown alias: **${modelRef}**\n\nUsage: \`model <provider/model>\` or \`model <alias>\`${available ? `\n\nAliases:\n${available}` : ""}`;
			}

			const newProvider = resolved.slice(0, slashIdx);
			const newModel = resolved.slice(slashIdx + 1);

			try {
				const provider = resolveProvider(newProvider, newModel);
				const model = resolveModel(provider);
				if (!model) {
					return `Model not found: **${resolved}**`;
				}

				agent.setModel(model);
				vamanConfig.agent.defaultProvider = newProvider;
				vamanConfig.agent.defaultModel = newModel;
				log.info(`Model switched to ${newProvider}/${newModel}`);
				const aliasNote = aliasTarget ? ` (alias: ${modelRef})` : "";
				return `Switched to **${newProvider}/${newModel}**${aliasNote}`;
			} catch (err) {
				return `Error switching model: ${err instanceof Error ? err.message : err}`;
			}
		}

		// alias set|add <name> <provider/model> | alias list | alias remove <name>
		const aliasMatch = trimmed.match(/^\/?(alias)(?:\s+(.+))?$/i);
		if (aliasMatch) {
			const args = (aliasMatch[2] ?? "").trim();

			if (!args || args === "list") {
				const aliases = loadAliases();
				const entries = Object.entries(aliases);
				if (entries.length === 0) {
					return "No aliases configured.\n\nUse: `alias set <name> <provider/model>`";
				}
				const lines = ["**Model Aliases:**\n"];
				for (const [name, target] of entries) {
					const isCurrent = target === `${vamanConfig.agent.defaultProvider}/${vamanConfig.agent.defaultModel}`;
					lines.push(`${isCurrent ? "\u2192" : " "} **${name}** -> ${target}`);
				}
				lines.push("", "Switch: `model <alias>`");
				return lines.join("\n");
			}

			const setMatch = args.match(/^(?:set|add)\s+(\S+)\s+(\S+)$/i);
			if (setMatch) {
				const [, name, target] = setMatch;
				if (!target.includes("/")) {
					return `Target must be \`provider/model\`, got: **${target}**`;
				}
				const aliases = loadAliases();
				aliases[name.toLowerCase()] = target;
				saveAliases(aliases);
				return `Alias set: **${name.toLowerCase()}** -> ${target}`;
			}

			const removeMatch = args.match(/^(?:remove|rm|delete)\s+(\S+)$/i);
			if (removeMatch) {
				const [, name] = removeMatch;
				const aliases = loadAliases();
				const key = name.toLowerCase();
				if (!aliases[key]) {
					return `Alias not found: **${key}**`;
				}
				delete aliases[key];
				saveAliases(aliases);
				return `Alias removed: **${key}**`;
			}

			return "Usage:\n`alias list`\n`alias set <name> <provider/model>`\n`alias remove <name>`";
		}

		// /fallback [list|set <models...>|clear] - manage fallback models
		const fallbackMatch = trimmed.match(/^\/?(fallback)(?:\s+(.+))?$/i);
		if (fallbackMatch) {
			const args = (fallbackMatch[2] ?? "").trim();

			if (!args || args === "list") {
				const list = loadFallbacks();
				if (list.length === 0) {
					return "No fallback models configured.\n\nUse: `fallback set <provider/model> [provider/model ...]`";
				}
				const lines = ["**Fallback chain** (tried in order when primary fails):\n"];
				lines.push(`  Primary: **${vamanConfig.agent.defaultProvider}/${vamanConfig.agent.defaultModel}**`);
				for (let i = 0; i < list.length; i++) {
					lines.push(`  ${i + 1}. ${list[i]}`);
				}
				return lines.join("\n");
			}

			if (args === "clear") {
				saveFallbacks([]);
				return "Fallback chain cleared.";
			}

			const setMatch = args.match(/^set\s+(.+)$/i);
			if (setMatch) {
				const models = setMatch[1].split(/\s+/).filter(Boolean);
				const invalid = models.filter((m) => !m.includes("/"));
				if (invalid.length > 0) {
					return `Invalid model refs (must be provider/model): ${invalid.join(", ")}`;
				}
				saveFallbacks(models);
				const lines = ["**Fallback chain set:**\n"];
				for (let i = 0; i < models.length; i++) {
					lines.push(`  ${i + 1}. ${models[i]}`);
				}
				return lines.join("\n");
			}

			return "Usage:\n`fallback list`\n`fallback set <provider/model> [provider/model ...]`\n`fallback clear`";
		}

		// /think [level] - set thinking/reasoning level
		const thinkMatch = trimmed.match(/^\/?(think)(?:\s+(.+))?$/i);
		if (thinkMatch) {
			const levels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
			const arg = (thinkMatch[2] ?? "").trim().toLowerCase();

			if (!arg) {
				const current = agent.state.thinkingLevel || "off";
				return `**Thinking level:** ${current}\n\nUsage: \`think <level>\`\nLevels: ${levels.join(", ")}\n\n*xhigh only works with GPT-5.2+ and Codex models*`;
			}

			if (!levels.includes(arg as any)) {
				return `Unknown level: **${arg}**\n\nAvailable: ${levels.join(", ")}`;
			}

			agent.setThinkingLevel(arg as any);
			log.info(`Thinking level set to: ${arg}`);
			return `Thinking level set to **${arg}**`;
		}

		// /status - show comprehensive gateway status
		const statusMatch = trimmed.match(/^\/?(status)$/i);
		if (statusMatch) {
			const s = getStatus() as any;
			const uptimeStr = formatUptime(s.uptime);
			const fallbackStr = s.model.fallbacks.length > 0
				? s.model.fallbacks.join(", ")
				: "none";
			const aliasEntries = Object.entries(s.model.aliases as Record<string, string>);
			const aliasStr = aliasEntries.length > 0
				? aliasEntries.map(([k, v]) => `${k}->${v}`).join(", ")
				: "none";
			const hbStatus = !s.heartbeat.enabled
				? "disabled"
				: s.heartbeat.currentlyActive
					? `active (every ${Math.round(s.heartbeat.intervalMs / 60000)}m)`
					: "outside active hours";
			const lastRunStr = s.heartbeat.lastRun
				? `${s.heartbeat.lastRun.success ? "\u2713" : "\u2717"} ${formatAge(Date.now() - s.heartbeat.lastRun.completedAt)}`
				: "never";
			const cronStr = s.cron.jobCount > 0
				? s.cron.jobs.map((j: any) => j.name).join(", ")
				: "none";

			const lines = [
				`**Nova Status**`,
				``,
				`**System**`,
				`  Version: ${s.version} \u00b7 Node ${s.node} \u00b7 ${s.platform}`,
				`  Uptime: ${uptimeStr}`,
				`  Gateway: ws://${s.gateway.host}:${s.gateway.port} (${s.gateway.clients} clients)`,
				``,
				`**Model**`,
				`  Current: **${s.model.current}**`,
				`  Thinking: ${s.model.thinkingLevel}`,
				`  Fallbacks: ${fallbackStr}`,
				`  Aliases: ${aliasStr}`,
				``,
				`**Channels**`,
				`  Discord: ${s.channels.discord.connected ? "\u2713 connected" : "\u2717 disconnected"}`,
				`  Gmail: ${s.channels.gmail.enabled ? "\u2713 enabled" : "\u2717 disabled"}`,
				``,
				`**Heartbeat**`,
				`  Status: ${hbStatus}`,
				`  Hours: ${s.heartbeat.activeHours}`,
				`  Last run: ${lastRunStr}`,
				`  Content: ${s.heartbeat.hasContent ? "configured" : "empty"}`,
				``,
				`**Cron**: ${s.cron.jobCount} jobs (${cronStr})`,
				`**Sessions**: ${s.sessions.count}`,
				`**World Model**: ${(s.state.worldModelChars / 1000).toFixed(1)}k chars`,
				`**Skills**: ${s.skills.count} (${s.skills.names.join(", ")})`,
			];
			return lines.join("\n");
		}

		// /heartbeat [model <ref|alias|clear>] - view/set heartbeat model
		const hbMatch = trimmed.match(/^\/?(heartbeat)(?:\s+(.+))?$/i);
		if (hbMatch) {
			const args = (hbMatch[2] ?? "").trim();
			const info = getHeartbeatModel();

			if (!args) {
				const modelStr = info.inherited
					? `**${info.current}** (inherited from global)`
					: `**${info.current}** (override)`;
				return `**Heartbeat Model:** ${modelStr}\n\nUsage:\n\`heartbeat model <alias or provider/model>\` — set override\n\`heartbeat model clear\` — inherit global model`;
			}

			const modelMatch = args.match(/^model(?:\s+(.+))?$/i);
			if (modelMatch) {
				const ref = (modelMatch[1] ?? "").trim();
				if (!ref) {
					return `**Heartbeat Model:** ${info.inherited ? `${info.current} (inherited)` : `${info.current} (override)`}`;
				}
				if (ref.toLowerCase() === "clear") {
					setHeartbeatModel(null);
					const global = `${vamanConfig.agent.defaultProvider}/${vamanConfig.agent.defaultModel}`;
					return `Heartbeat model override cleared. Now inherits global: **${global}**`;
				}
				const result = setHeartbeatModel(ref);
				if (!result.ok) {
					return `Error: ${result.error}`;
				}
				const updated = getHeartbeatModel();
				return `Heartbeat model set to **${updated.current}**`;
			}

			return `Unknown subcommand: **${args}**\n\nUsage:\n\`heartbeat\` — show current\n\`heartbeat model <alias or provider/model>\` — set override\n\`heartbeat model clear\` — inherit global`;
		}

		// /restart - restart gateway via systemctl (survives because systemd relaunches the process)
		const restartMatch = trimmed.match(/^\/?(restart)$/i);
		if (restartMatch) {
			return null; // handled specially in onMessage (needs sessionKey context)
		}

		return null; // not a command
	}

	function formatUptime(seconds: number): string {
		const d = Math.floor(seconds / 86400);
		const h = Math.floor((seconds % 86400) / 3600);
		const m = Math.floor((seconds % 3600) / 60);
		if (d > 0) return `${d}d ${h}h ${m}m`;
		if (h > 0) return `${h}h ${m}m`;
		return `${m}m`;
	}

	function formatAge(ms: number): string {
		const mins = Math.floor(ms / 60000);
		if (mins < 1) return "just now";
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}

	/** Handle /restart command with session context for sentinel wake */
	function handleRestart(sessionKey: string, discordTarget: string, replyTo?: string): string {
		const result = gateway.restart.triggerRestart({
			reason: "User requested /restart",
			timestamp: Date.now(),
			sessionKey,
			discordTarget,
			replyTo,
		});

		if (result.ok) {
			return "Restarting gateway... I'll be back in a few seconds.";
		}
		return `Restart failed: ${result.detail}\n\nYou may need to restart manually via SSH.`;
	}

	// Start Discord adapter if token is configured
	let discord: DiscordAdapter | null = null;
	if (vamanConfig.discord.enabled && vamanConfig.discord.token) {
		const uploadDir = resolve(dataDir, "uploads");
		mkdirSync(uploadDir, { recursive: true });

		discord = new DiscordAdapter({
			token: vamanConfig.discord.token,
			uploadDir,
			slashCommands: [
				{
					name: "models",
					description: "List available AI providers and models",
					options: [{ name: "provider", description: "Filter by provider name", required: false }],
				},
				{
					name: "model",
					description: "Switch to a different AI model",
					options: [{ name: "name", description: "Model ref (e.g. openai-codex/gpt-5.3-codex)", required: true }],
				},
				{
					name: "restart",
					description: "Restart the gateway safely",
				},
				{
					name: "think",
					description: "Set thinking/reasoning level",
					options: [{ name: "level", description: "off, minimal, low, medium, high, xhigh", required: false }],
				},
				{
					name: "status",
					description: "Show gateway status, model, channels, heartbeat, and sessions",
				},
				{
					name: "heartbeat",
					description: "View or set the heartbeat model",
					options: [{ name: "model", description: "Alias or provider/model (or 'clear' to inherit global)", required: false }],
				},
			],
			onSlashCommand: async (commandName, args, sessionKey) => {
				if (commandName === "models") {
					const content = args.provider ? `/models ${args.provider}` : "/models";
					return handleCommand(content) ?? "Unknown error";
				}
				if (commandName === "model") {
					const content = `/model ${args.name}`;
					return handleCommand(content) ?? "Unknown error";
				}
				if (commandName === "restart") {
					const parts = sessionKey.split(":");
					const target = parts.slice(2).join(":");
					return handleRestart(sessionKey, target);
				}
				if (commandName === "think") {
					const content = args.level ? `/think ${args.level}` : "/think";
					return handleCommand(content) ?? "Unknown error";
				}
				if (commandName === "status") {
					return handleCommand("/status") ?? "Unknown error";
				}
				if (commandName === "heartbeat") {
					const model = args.model;
					const content = model ? `/heartbeat model ${model}` : "/heartbeat";
					return handleCommand(content) ?? "Unknown error";
				}
				return `Unknown command: /${commandName}`;
			},
			onMessage: async (sessionKey, content, replyTo) => {
				log.info(`Discord message [${sessionKey}]: ${content.slice(0, 80)}...`);

				// Set current session key for transformContext
				currentSessionKey = sessionKey;

				// Track DM user ID + session key for proactive delivery & session integration
				const dmUserMatch = sessionKey.match(/:dm:(\d+)$/);
				if (dmUserMatch) {
					lastDMUserId = dmUserMatch[1];
					lastDMSessionKey = sessionKey;
				}

				// Lazy restore: if buffer empty for this session, load from archive
				if (sessionBuffer.isEmpty(sessionKey)) {
					const recentTurns = archive.getRecentTurns(sessionKey, vamanConfig.state.conversationHistory);
					if (recentTurns.length > 0) {
						sessionBuffer.restore(sessionKey, recentTurns.reverse().map((t) => ({
							role: t.role as "user" | "assistant",
							content: t.content,
							timestamp: t.timestamp,
							sessionKey: t.sessionKey,
						})));
						log.info(`Lazy-restored ${recentTurns.length} turns for ${sessionKey}`);
					}
				}

				// Log user message to session (audit log)
				const now = Date.now();
				sessions.append(sessionKey, { role: "user", content, timestamp: now });

				// Buffer user turn
				const userEvicted = sessionBuffer.append(sessionKey, {
					role: "user",
					content,
					timestamp: now,
					sessionKey,
				});
				if (userEvicted.length > 0) {
					archive.archiveTurns(userEvicted);
				}

				try {
					// Handle /restart specially (needs session context for sentinel)
					const trimmedContent = content.trim();
					if (trimmedContent.match(/^\/?(restart)$/i)) {
						const parts = sessionKey.split(":");
						const target = parts.slice(2).join(":");
						const response = handleRestart(sessionKey, target, replyTo);
						sessions.append(sessionKey, { role: "assistant", content: response, timestamp: Date.now() });
						if (discord) await discord.send(target, { text: response, replyTo });
						return;
					}

					// Check for gateway commands first (instant, no AI tokens)
					const commandResponse = handleCommand(content);
					const response = commandResponse ?? await promptAgent(content);

					// Buffer assistant turn
					const assistantNow = Date.now();
					const assistantEvicted = sessionBuffer.append(sessionKey, {
						role: "assistant",
						content: response,
						timestamp: assistantNow,
						sessionKey,
					});
					if (assistantEvicted.length > 0) {
						archive.archiveTurns(assistantEvicted);
					}

					// Log assistant response to session (audit log)
					sessions.append(sessionKey, {
						role: "assistant",
						content: response,
						timestamp: assistantNow,
					});

					// Fire async extraction (non-blocking)
					if (!commandResponse) {
						extractor.extract({
							userMessage: content,
							assistantResponse: response,
							sessionKey,
						});
					}

					// Reply via Discord
					if (discord) {
						const parts = sessionKey.split(":");
						const target = parts.slice(2).join(":");
						await discord.send(target, { text: response, replyTo });
					}
				} catch (err) {
					log.error(`Agent error for ${sessionKey}: ${err}`);
					if (discord) {
						const parts = sessionKey.split(":");
						const target = parts.slice(2).join(":");
						await discord.send(target, {
							text: `Sorry, I encountered an error: ${err instanceof Error ? err.message : err}`,
						});
					}
				}
			},
		});

		try {
			await discord.start();
			log.info("Discord adapter started");

			// Start proactive systems now that Discord can deliver messages
			heartbeat.start();
			cron.start();
			log.info("Heartbeat and cron services started");

			// Check for restart sentinel — confirm back in chat via the agent
			const sentinel = gateway.restart.consume();
			if (sentinel && sentinel.discordTarget) {
				const sentinelWake = async () => {
					// Wait for Discord to be fully connected
					await new Promise((r) => setTimeout(r, 1500));

					const sk = sentinel.sessionKey || "";
					if (sk) {
						currentSessionKey = sk;
						// Also restore DM tracking so heartbeat/proactive features work
						const dmMatch = sk.match(/:dm:(\d+)$/);
						if (dmMatch) {
							lastDMUserId = dmMatch[1];
							lastDMSessionKey = sk;
						}
					}

					// Eagerly restore session buffer from archive for conversation context
					if (sk && sessionBuffer.isEmpty(sk)) {
						const recentTurns = archive.getRecentTurns(sk, vamanConfig.state.conversationHistory);
						if (recentTurns.length > 0) {
							sessionBuffer.restore(sk, recentTurns.reverse().map((t) => ({
								role: t.role as "user" | "assistant",
								content: t.content,
								timestamp: t.timestamp,
								sessionKey: t.sessionKey,
							})));
							log.info(`Sentinel recovery: restored ${recentTurns.length} turns for ${sk}`);
						}
					}

					const elapsed = Date.now() - sentinel.timestamp;
					const seconds = Math.round(elapsed / 1000);
					const systemPrompt = `[SYSTEM] Gateway restarted successfully after ${seconds}s. ` +
						`Reason: ${sentinel.reason}. ` +
						`Confirm to the user that you are back online. If you remember what you ` +
						`were doing before the restart, briefly mention it.`;

					log.info(`Sentinel wake: sending through agent for ${sentinel.discordTarget}`);

					try {
						// Send through agent so it has conversation context and responds naturally
						const now = Date.now();
						if (sk) {
							sessions.append(sk, { role: "user", content: systemPrompt, timestamp: now });
							const userEvicted = sessionBuffer.append(sk, {
								role: "user", content: systemPrompt, timestamp: now, sessionKey: sk,
							});
							if (userEvicted.length > 0) archive.archiveTurns(userEvicted);
						}

						const response = await promptAgent(systemPrompt);

						if (sk) {
							const assistantNow = Date.now();
							sessions.append(sk, { role: "assistant", content: response, timestamp: assistantNow });
							const assistantEvicted = sessionBuffer.append(sk, {
								role: "assistant", content: response, timestamp: assistantNow, sessionKey: sk,
							});
							if (assistantEvicted.length > 0) archive.archiveTurns(assistantEvicted);
						}

						await discord!.send(sentinel.discordTarget!, { text: response });
						log.info("Sentinel wake: agent confirmed restart in chat");
					} catch (err) {
						// Fallback: send raw message if agent fails
						log.error(`Sentinel wake agent failed: ${err}, sending raw message`);
						const fallback = `Gateway restarted successfully (${seconds}s). Reason: ${sentinel.reason}`;
						try {
							await discord!.send(sentinel.discordTarget!, { text: fallback });
						} catch {
							log.error("Sentinel wake: failed to send even raw fallback");
						}
					}
				};
				sentinelWake();
			}
		} catch (err) {
			log.error(`Discord adapter failed to start: ${err}`);
			discord = null;
		}
	} else {
		log.info("Discord not configured (no DISCORD_BOT_TOKEN)");
	}

	// Handle graceful shutdown
	const shutdown = async () => {
		log.info("Shutting down gateway...");

		// Stop proactive systems first
		heartbeat.stop();
		cron.stop();

		// Flush session buffers to archive before shutdown
		const allBuffered = sessionBuffer.flushAll();
		for (const [, turns] of allBuffered) {
			archive.archiveTurns(turns);
		}
		archive.close();

		if (discord) await discord.stop();
		await gateway.stop();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
	process.on("SIGUSR1", () => {
		log.info("Received SIGUSR1, shutting down for restart...");
		shutdown();
	});

	await gateway.start();
	log.info(`Gateway running on ws://${vamanConfig.gateway.host}:${vamanConfig.gateway.port}`);
}

main().catch((err) => {
	log.error(`Gateway failed to start: ${err}`);
	process.exit(1);
});
