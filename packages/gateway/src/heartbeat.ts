import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { createLogger } from "@vaman-ai/shared";
import type { VamanConfig } from "@vaman-ai/shared";

export interface HeartbeatRunRecord {
	timestamp: number;
	completedAt: number;
	success: boolean;
	delivery: string;
	response?: string;
	error?: string;
}

const log = createLogger("heartbeat");

export interface HeartbeatOptions {
	config: VamanConfig;
	dataDir: string;
	onHeartbeat: (prompt: string) => Promise<string>;
	onDeliver: (channel: string, message: string) => Promise<void>;
}

export class HeartbeatRunner {
	private interval: ReturnType<typeof setInterval> | null = null;
	private heartbeatPath: string;
	private runsPath: string;

	constructor(private options: HeartbeatOptions) {
		this.heartbeatPath = resolve(options.dataDir, "heartbeat", "HEARTBEAT.md");
		this.runsPath = resolve(options.dataDir, "heartbeat", "runs.jsonl");
		mkdirSync(dirname(this.runsPath), { recursive: true });
	}

	/** Start the heartbeat loop */
	start(): void {
		const { config } = this.options;
		if (!config.heartbeat.enabled) {
			log.info("Heartbeat disabled");
			return;
		}

		log.info(`Heartbeat started (interval: ${config.heartbeat.intervalMs}ms)`);
		this.interval = setInterval(() => this.tick(), config.heartbeat.intervalMs);

		// Also run once at startup
		this.tick();
	}

	/** Stop the heartbeat loop */
	stop(): void {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
			log.info("Heartbeat stopped");
		}
	}

	/** Single heartbeat tick */
	async tick(): Promise<void> {
		if (!this.isActiveHours()) {
			log.debug("Outside active hours, skipping heartbeat");
			return;
		}

		const content = this.readHeartbeat();
		if (!content) {
			log.debug("No heartbeat content, skipping");
			return;
		}

		log.info("Heartbeat triggered, running agent...");
		const startedAt = Date.now();
		const delivery = this.options.config.heartbeat.defaultDelivery;

		try {
			const response = await this.options.onHeartbeat(content);
			await this.options.onDeliver(delivery, response);
			log.info(`Heartbeat delivered to ${delivery}`);
			this.logRun({ timestamp: startedAt, completedAt: Date.now(), success: true, delivery, response });
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			log.error("Heartbeat error:", err);
			this.logRun({ timestamp: startedAt, completedAt: Date.now(), success: false, delivery, error });
		}
	}

	/** Log a heartbeat run result to JSONL */
	private logRun(record: HeartbeatRunRecord): void {
		try {
			appendFileSync(this.runsPath, JSON.stringify(record) + "\n", "utf-8");
		} catch (err) {
			log.error("Failed to log heartbeat run:", err);
		}
	}

	/** Read HEARTBEAT.md content (returns null if empty/missing) */
	readHeartbeat(): string | null {
		if (!existsSync(this.heartbeatPath)) return null;
		const content = readFileSync(this.heartbeatPath, "utf-8").trim();
		if (!content) return null;
		return content;
	}

	/** Check if current time is within active hours */
	isActiveHours(): boolean {
		const { activeHoursStart, activeHoursEnd } = this.options.config.heartbeat;
		const now = new Date();
		const currentMinutes = now.getHours() * 60 + now.getMinutes();

		const [startH, startM] = activeHoursStart.split(":").map(Number);
		const [endH, endM] = activeHoursEnd.split(":").map(Number);

		const startMinutes = startH * 60 + startM;
		const endMinutes = endH * 60 + endM;

		return currentMinutes >= startMinutes && currentMinutes < endMinutes;
	}
}
