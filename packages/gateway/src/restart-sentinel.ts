import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { createLogger } from "@vaman-ai/shared";

const log = createLogger("restart");

export interface RestartSentinel {
	reason: string;
	timestamp: number;
	sessionKey?: string;
	discordTarget?: string;
	replyTo?: string;
}

export interface RestartResult {
	ok: boolean;
	method: "systemd";
	detail?: string;
}

export class RestartManager {
	private sentinelPath: string;
	private systemdUnit: string;

	constructor(dataDir: string, systemdUnit = "vaman-gateway.service") {
		this.sentinelPath = resolve(dataDir, "restart-sentinel.json");
		this.systemdUnit = systemdUnit;
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
			const data = readFileSync(this.sentinelPath, "utf-8").trim();
			if (!data) return null;
			const sentinel: RestartSentinel = JSON.parse(data);
			unlinkSync(this.sentinelPath);
			log.info(`Restart sentinel consumed: ${sentinel.reason}`);
			return sentinel;
		} catch (err) {
			log.error("Failed to read restart sentinel:", err);
			try { unlinkSync(this.sentinelPath); } catch {}
			return null;
		}
	}

	/**
	 * Trigger a gateway restart via systemctl.
	 * systemd kills the old process and starts a new one externally.
	 *
	 * Note: spawnSync may not return cleanly because systemd kills our process
	 * as part of the restart. This is expected — the sentinel file persists
	 * and the new process picks it up.
	 */
	triggerRestart(sentinel: RestartSentinel): RestartResult {
		this.write(sentinel);

		const args = ["--user", "restart", this.systemdUnit];
		log.info(`Triggering restart via: systemctl ${args.join(" ")}`);

		try {
			const result = spawnSync("systemctl", args, {
				encoding: "utf-8",
				timeout: 5000,
			});

			if (!result.error && result.status === 0) {
				return { ok: true, method: "systemd" };
			}

			// spawnSync may fail because systemd killed us mid-call — that's success
			const detail = result.stderr?.trim() || result.stdout?.trim() || "";
			if (!detail) {
				// Empty error = process was killed during spawnSync, restart actually worked
				return { ok: true, method: "systemd" };
			}

			log.error(`systemctl restart failed: ${detail}`);
			return { ok: false, method: "systemd", detail };
		} catch {
			// If we get here at all, systemd likely killed us and we're in cleanup
			return { ok: true, method: "systemd" };
		}
	}
}
