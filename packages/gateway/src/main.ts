#!/usr/bin/env node
/**
 * Gateway main entry point. Run this to start the gateway server.
 *
 * Usage: npx tsx packages/gateway/src/main.ts
 */
import { config } from "dotenv";
import { resolve } from "path";

// Load .env from monorepo root (cwd should be monorepo root)
config({ path: resolve(process.cwd(), ".env") });

import { loadConfig, createLogger } from "@vaman-ai/shared";
import { GatewayServer } from "./server.js";

const log = createLogger("gateway:main");

async function main() {
	const vamanConfig = loadConfig();
	const dataDir = resolve(process.cwd(), "data");

	const gateway = new GatewayServer({ config: vamanConfig, dataDir });

	// Handle graceful shutdown
	const shutdown = async () => {
		log.info("Shutting down gateway...");
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
