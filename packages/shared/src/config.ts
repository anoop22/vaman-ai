import type { VamanConfig } from "./types.js";

export function loadConfig(): VamanConfig {
	return {
		gateway: {
			port: parseInt(process.env.GATEWAY_PORT || "18790", 10),
			host: process.env.GATEWAY_HOST || "127.0.0.1",
		},
		agent: {
			defaultModel: process.env.DEFAULT_MODEL || "google/gemini-3-flash-preview",
			defaultProvider: process.env.DEFAULT_PROVIDER || "openrouter",
		},
		discord: {
			token: process.env.DISCORD_BOT_TOKEN || "",
			enabled: !!process.env.DISCORD_BOT_TOKEN,
		},
		gmail: {
			credentialsPath:
				process.env.GMAIL_CREDENTIALS_PATH || "./config/credentials/gmail-oauth.json",
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
		state: {
			conversationHistory: parseInt(process.env.STATE_CONVERSATION_HISTORY || "10", 10),
			worldModelPath: process.env.STATE_WORLD_MODEL_PATH || "data/state/world-model.md",
			archivePath: process.env.STATE_ARCHIVE_PATH || "data/state/archive.db",
			extractionEnabled: process.env.STATE_EXTRACTION_ENABLED !== "false",
			extractionTimeoutMs: parseInt(process.env.STATE_EXTRACTION_TIMEOUT_MS || "5000", 10),
			worldModelMaxTokens: parseInt(process.env.STATE_WORLD_MODEL_MAX_TOKENS || "1000", 10),
			userTimezone: process.env.USER_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
		},
	};
}
