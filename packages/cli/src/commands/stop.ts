import { resolve } from "path";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { loadConfig, createLogger } from "@vaman-ai/shared";

const log = createLogger("cli");

export async function stopCommand() {
	const config = loadConfig();
	// PID file is at monorepo root data/ (must match start.ts)
	const monorepoRoot = resolve(import.meta.dirname, "../../../..");
	const pidFile = resolve(monorepoRoot, "data/gateway.pid");

	if (existsSync(pidFile)) {
		const pid = readFileSync(pidFile, "utf-8").trim();
		try {
			process.kill(parseInt(pid, 10), "SIGTERM");
			unlinkSync(pidFile);
			log.info(`Gateway stopped (pid: ${pid})`);
		} catch (err) {
			log.error(`Failed to stop gateway (pid: ${pid}):`, err);
			unlinkSync(pidFile);
		}
		return;
	}

	// Fallback: find by port
	const { port } = config.gateway;
	try {
		const pids = execSync(`lsof -ti:${port} 2>/dev/null`).toString().trim();
		if (pids) {
			for (const pid of pids.split("\n")) {
				process.kill(parseInt(pid, 10), "SIGTERM");
			}
			log.info(`Gateway stopped (port ${port})`);
		} else {
			log.info("Gateway is not running");
		}
	} catch {
		log.info("Gateway is not running");
	}
}

export async function restartCommand() {
	await stopCommand();
	// Small delay to let port free up
	await new Promise((r) => setTimeout(r, 500));
	const { startCommand } = await import("./start.js");
	await startCommand({ foreground: false });
}
