import { readFileSync, existsSync, appendFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { createLogger } from "@vaman-ai/shared";
import type { VamanConfig } from "@vaman-ai/shared";

export interface HeartbeatRunRecord {
	timestamp: number;
	completedAt: number;
	success: boolean;
	delivery: string;
	model?: string;
	response?: string;
	error?: string;
}

const log = createLogger("heartbeat");

export interface HeartbeatOptions {
	config: VamanConfig;
	dataDir: string;
	onHeartbeat: (prompt: string) => Promise<string>;
	onDeliver: (channel: string, message: string) => Promise<void>;
	getModelRef?: () => string;
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

		// Delay first tick to let Discord connect and establish DM session key
		const startupDelay = 30_000; // 30 seconds
		log.info(`First heartbeat in ${startupDelay / 1000}s (waiting for channels to connect)`);
		setTimeout(() => this.tick(), startupDelay);
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
			const { activeHoursStart, activeHoursEnd } = this.options.config.heartbeat;
			log.info(`Heartbeat skipped: outside active hours (${activeHoursStart}-${activeHoursEnd}, now ${this.getCurrentTimeLabel()})`);
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
		const model = this.options.getModelRef?.();

		try {
			const response = await this.options.onHeartbeat(content);

			if (!response || response.trim().length === 0) {
				log.warn("Heartbeat produced empty response, skipping delivery");
				this.logRun({
					timestamp: startedAt, completedAt: Date.now(),
					success: false, delivery, model,
					error: "Empty response from heartbeat prompt (delivery skipped)",
				});
				return;
			}

			await this.options.onDeliver(delivery, response);
			log.info(`Heartbeat delivered to ${delivery}`);
			this.logRun({ timestamp: startedAt, completedAt: Date.now(), success: true, delivery, model, response });
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			log.error("Heartbeat error:", err);
			this.logRun({ timestamp: startedAt, completedAt: Date.now(), success: false, delivery, model, error });
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
		const currentMinutes = this.getCurrentMinutes();

		const [startH, startM] = activeHoursStart.split(":").map(Number);
		const [endH, endM] = activeHoursEnd.split(":").map(Number);

		const startMinutes = startH * 60 + startM;
		const endMinutes = endH * 60 + endM;

		if (startMinutes === endMinutes) return true;
		if (startMinutes < endMinutes) {
			return currentMinutes >= startMinutes && currentMinutes < endMinutes;
		}

		// Overnight window (e.g., 22:00-06:00)
		return currentMinutes >= startMinutes || currentMinutes < endMinutes;
	}

	private getCurrentMinutes(): number {
		const tz = this.options.config.state.userTimezone;
		const now = new Date();
		if (!tz) return now.getHours() * 60 + now.getMinutes();

		try {
			const parts = new Intl.DateTimeFormat("en-US", {
				timeZone: tz,
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
			}).formatToParts(now);
			const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
			const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
			return hour * 60 + minute;
		} catch {
			return now.getHours() * 60 + now.getMinutes();
		}
	}

	private getCurrentTimeLabel(): string {
		const tz = this.options.config.state.userTimezone;
		if (!tz) return new Date().toTimeString().slice(0, 5);

		try {
			return new Intl.DateTimeFormat("en-US", {
				timeZone: tz,
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
				timeZoneName: "short",
			}).format(new Date());
		} catch {
			return new Date().toTimeString().slice(0, 5);
		}
	}
}
