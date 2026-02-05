import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { createLogger } from "@vaman-ai/shared";

const log = createLogger("restart");

export interface RestartSentinel {
	reason: string;
	timestamp: number;
	activeSession?: string;
	pendingMessage?: string;
}

export class RestartManager {
	private sentinelPath: string;

	constructor(dataDir: string) {
		this.sentinelPath = resolve(dataDir, "restart-sentinel.json");
	}

	/** Write a restart sentinel before shutting down */
	write(sentinel: RestartSentinel): void {
		writeFileSync(this.sentinelPath, JSON.stringify(sentinel, null, "\t"), "utf-8");
		log.info(`Restart sentinel written: ${sentinel.reason}`);
	}

	/** Read and consume the restart sentinel (returns null if none) */
	consume(): RestartSentinel | null {
		if (!existsSync(this.sentinelPath)) return null;
		try {
			const data = readFileSync(this.sentinelPath, "utf-8");
			const sentinel: RestartSentinel = JSON.parse(data);
			writeFileSync(this.sentinelPath, "", "utf-8");
			log.info(`Restart sentinel consumed: ${sentinel.reason}`);
			return sentinel;
		} catch (err) {
			log.error("Failed to read restart sentinel:", err);
			return null;
		}
	}

	/** Check if a sentinel exists without consuming it */
	exists(): boolean {
		if (!existsSync(this.sentinelPath)) return false;
		const data = readFileSync(this.sentinelPath, "utf-8").trim();
		return data.length > 0;
	}
}
