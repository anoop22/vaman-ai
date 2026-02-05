import { resolve } from "path";
import { spawn, execSync } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { loadConfig, createLogger } from "@vaman-ai/shared";

const log = createLogger("cli");

export async function startCommand(opts: { foreground?: boolean }) {
	const config = loadConfig();
	const { port, host } = config.gateway;

	// Check if already running
	try {
		const check = execSync(`lsof -ti:${port} 2>/dev/null`).toString().trim();
		if (check) {
			log.info(`Gateway already running on port ${port} (pid: ${check})`);
			return;
		}
	} catch {
		// Not running, continue
	}

	if (opts.foreground) {
		log.info(`Starting gateway in foreground on ws://${host}:${port}`);
		const gatewayEntry = resolve(import.meta.dirname, "../../gateway/src/index.ts");
		// Use tsx to run gateway directly
		const child = spawn("npx", ["tsx", gatewayEntry], {
			stdio: "inherit",
			cwd: resolve(import.meta.dirname, "../../../"),
			env: { ...process.env },
		});
		child.on("exit", (code) => {
			log.info(`Gateway exited with code ${code}`);
		});
	} else {
		log.info(`Starting gateway daemon on ws://${host}:${port}`);
		const gatewayEntry = resolve(import.meta.dirname, "../../../packages/gateway/src/index.ts");
		const logFile = resolve(import.meta.dirname, "../../../data/logs/gateway.log");
		const child = spawn("npx", ["tsx", gatewayEntry], {
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
			cwd: resolve(import.meta.dirname, "../../../"),
			env: { ...process.env },
		});

		// Write PID file
		const pidFile = resolve(import.meta.dirname, "../../../data/gateway.pid");
		writeFileSync(pidFile, String(child.pid), "utf-8");

		child.unref();
		log.info(`Gateway started (pid: ${child.pid})`);
	}
}
