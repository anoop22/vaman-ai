#!/usr/bin/env node
/**
 * Gateway main entry point. Starts the WebSocket server,
 * channel adapters (Discord), and agent for message handling.
 *
 * Usage: npx tsx packages/gateway/src/main.ts
 */
import { config } from "dotenv";
import { resolve } from "path";

// Load .env from monorepo root (cwd should be monorepo root)
config({ path: resolve(process.cwd(), ".env") });

import { loadConfig, createLogger } from "@vaman-ai/shared";
import { createVamanAgent } from "@vaman-ai/agent";
import { DiscordAdapter } from "@vaman-ai/discord";
import { loadSkills, skillsToSystemPrompt } from "@vaman-ai/skills";
import { GatewayServer } from "./server.js";
import { SessionManager } from "./session-manager.js";

const log = createLogger("gateway:main");

async function main() {
	const vamanConfig = loadConfig();
	const dataDir = resolve(process.cwd(), "data");

	// Load skills for system prompt
	const builtInDir = resolve(process.cwd(), "packages/skills/built-in");
	const skills = loadSkills(dataDir, builtInDir);
	const skillsPrompt = skillsToSystemPrompt(skills);

	// Create agent with skills injected into system prompt
	const basePrompt = `You are Vaman, a personal AI assistant. You help your user across Discord, Gmail, terminal, and voice.

Be concise, helpful, and proactive. When you don't know something, say so. When you can help, do it efficiently.`;

	const agent = createVamanAgent({
		config: vamanConfig,
		systemPrompt: basePrompt + skillsPrompt,
	});

	// Collect response text from agent events
	let responseBuffer = "";
	let responseResolve: ((text: string) => void) | null = null;

	agent.subscribe((event: any) => {
		if (event.type === "message_update") {
			const assistantEvent = event.assistantMessageEvent;
			if (assistantEvent?.type === "text_delta") {
				responseBuffer += assistantEvent.delta;
			}
		}
		if (event.type === "message_end") {
			if (responseResolve) {
				responseResolve(responseBuffer);
				responseResolve = null;
			}
		}
	});

	async function promptAgent(input: string): Promise<string> {
		responseBuffer = "";
		const promise = new Promise<string>((res) => {
			responseResolve = res;
		});
		await agent.prompt(input);
		return promise;
	}

	// Session manager for logging conversations
	const sessions = new SessionManager(dataDir);

	// Start gateway WebSocket server
	const gateway = new GatewayServer({ config: vamanConfig, dataDir });

	// Start Discord adapter if token is configured
	let discord: DiscordAdapter | null = null;
	if (vamanConfig.discord.enabled && vamanConfig.discord.token) {
		discord = new DiscordAdapter({
			token: vamanConfig.discord.token,
			onMessage: async (sessionKey, content, replyTo) => {
				log.info(`Discord message [${sessionKey}]: ${content.slice(0, 80)}...`);

				// Log user message to session
				sessions.append(sessionKey, { role: "user", content, timestamp: Date.now() });

				try {
					// Get agent response
					const response = await promptAgent(content);

					// Log assistant response to session
					sessions.append(sessionKey, {
						role: "assistant",
						content: response,
						timestamp: Date.now(),
					});

					// Reply via Discord
					if (discord) {
						// Extract channel target from session key: main:discord:dm or main:discord:channel:<id>
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
		if (discord) await discord.stop();
		await gateway.stop();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
	process.on("SIGUSR1", () => {
		log.info("Received SIGUSR1, restarting...");
		gateway.restart.write({ reason: "SIGUSR1", timestamp: Date.now() });
		shutdown();
	});

	await gateway.start();
	log.info(`Gateway running on ws://${vamanConfig.gateway.host}:${vamanConfig.gateway.port}`);
}

main().catch((err) => {
	log.error(`Gateway failed to start: ${err}`);
	process.exit(1);
});
