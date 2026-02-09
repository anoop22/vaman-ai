import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import { Cron } from "croner";
import { createLogger } from "@vaman-ai/shared";

const log = createLogger("cron");

export type ScheduleType = "at" | "every" | "cron";

export interface CronJob {
	id: string;
	name: string;
	scheduleType: ScheduleType;
	schedule: string;
	prompt: string;
	delivery: string;
	enabled: boolean;
	createdAt: number;
}

export interface CronRunResult {
	jobId: string;
	startedAt: number;
	completedAt: number;
	success: boolean;
	response?: string;
	error?: string;
}

export interface CronCallbacks {
	onJobRun: (job: CronJob) => Promise<string>;
	onDeliver: (channel: string, message: string) => Promise<void>;
}

export class CronService {
	private jobs = new Map<string, CronJob>();
	private runners = new Map<string, Cron>();
	private jobsPath: string;
	private runsDir: string;
	private timezone?: string;

	constructor(
		private dataDir: string,
		private callbacks: CronCallbacks,
		timezone?: string,
	) {
		this.jobsPath = resolve(dataDir, "cron", "jobs.json");
		this.runsDir = resolve(dataDir, "cron", "runs");
		this.timezone = timezone;
		mkdirSync(this.runsDir, { recursive: true });
	}

	/** Load jobs from disk and start all enabled ones */
	start(): void {
		this.loadJobs();
		for (const job of this.jobs.values()) {
			if (job.enabled) {
				this.scheduleJob(job);
			}
		}
		log.info(`Cron started with ${this.jobs.size} jobs (${this.runners.size} active)`);
	}

	/** Stop all cron jobs */
	stop(): void {
		for (const [id, runner] of this.runners) {
			runner.stop();
		}
		this.runners.clear();
		log.info("Cron stopped");
	}

	/** Add a new cron job */
	addJob(job: Omit<CronJob, "id" | "createdAt">): CronJob {
		const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const fullJob: CronJob = { ...job, id, createdAt: Date.now() };
		this.jobs.set(id, fullJob);
		this.saveJobs();

		if (fullJob.enabled) {
			this.scheduleJob(fullJob);
		}

		log.info(`Added job: ${fullJob.name} (${fullJob.scheduleType}: ${fullJob.schedule})`);
		return fullJob;
	}

	/** Remove a cron job */
	removeJob(id: string): boolean {
		const runner = this.runners.get(id);
		if (runner) {
			runner.stop();
			this.runners.delete(id);
		}

		const deleted = this.jobs.delete(id);
		if (deleted) {
			this.saveJobs();
			log.info(`Removed job: ${id}`);
		}
		return deleted;
	}

	/** List all jobs */
	listJobs(): CronJob[] {
		return Array.from(this.jobs.values());
	}

	/** Get a specific job */
	getJob(id: string): CronJob | undefined {
		return this.jobs.get(id);
	}

	/** Convert schedule to cron pattern */
	private toCronPattern(job: CronJob): string {
		switch (job.scheduleType) {
			case "cron":
				return job.schedule;
			case "every": {
				const ms = parseDuration(job.schedule);
				const minutes = Math.max(1, Math.round(ms / 60000));
				return `*/${minutes} * * * *`;
			}
			case "at":
				// "at" jobs use a one-shot pattern (date string)
				return job.schedule;
			default:
				throw new Error(`Unknown schedule type: ${job.scheduleType}`);
		}
	}

	/** Schedule a job to run */
	private scheduleJob(job: CronJob): void {
		try {
			const pattern = this.toCronPattern(job);
			const opts = this.timezone ? { timezone: this.timezone } : {};
			const runner = new Cron(pattern, opts, async () => {
				await this.executeJob(job);
			});
			this.runners.set(job.id, runner);
			log.debug(`Scheduled job ${job.name}: ${pattern} (tz: ${this.timezone || "system"})`);
		} catch (err) {
			log.error(`Failed to schedule job ${job.name}:`, err);
		}
	}

	/** Trigger a job on demand by ID */
	async triggerJob(id: string): Promise<string> {
		const job = this.jobs.get(id);
		if (!job) throw new Error(`Job not found: ${id}`);
		log.info(`Manually triggered job: ${job.name}`);
		await this.executeJob(job);
		return `Job "${job.name}" triggered`;
	}

	/** Execute a single job */
	private async executeJob(job: CronJob): Promise<void> {
		const startedAt = Date.now();
		log.info(`Running job: ${job.name}`);

		try {
			const response = await this.callbacks.onJobRun(job);
			await this.callbacks.onDeliver(job.delivery, response);

			this.logRun({
				jobId: job.id,
				startedAt,
				completedAt: Date.now(),
				success: true,
				response,
			});
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			log.error(`Job ${job.name} failed:`, error);

			this.logRun({
				jobId: job.id,
				startedAt,
				completedAt: Date.now(),
				success: false,
				error,
			});
		}
	}

	/** Log a run result */
	private logRun(result: CronRunResult): void {
		const logFile = join(this.runsDir, `${result.jobId}.jsonl`);
		appendFileSync(logFile, JSON.stringify(result) + "\n", "utf-8");
	}

	/** Load jobs from disk */
	private loadJobs(): void {
		if (!existsSync(this.jobsPath)) return;
		try {
			const data = readFileSync(this.jobsPath, "utf-8");
			const jobs: CronJob[] = JSON.parse(data);
			for (const job of jobs) {
				this.jobs.set(job.id, job);
			}
		} catch (err) {
			log.error("Failed to load cron jobs:", err);
		}
	}

	/** Save jobs to disk */
	private saveJobs(): void {
		const data = JSON.stringify(Array.from(this.jobs.values()), null, "\t");
		mkdirSync(resolve(this.dataDir, "cron"), { recursive: true });
		writeFileSync(this.jobsPath, data, "utf-8");
	}
}

/** Parse a duration string like "30m", "2h", "1d" to milliseconds */
function parseDuration(str: string): number {
	const match = str.match(/^(\d+)\s*(s|m|h|d)$/);
	if (!match) throw new Error(`Invalid duration: ${str}`);
	const value = parseInt(match[1], 10);
	const unit = match[2];
	switch (unit) {
		case "s":
			return value * 1000;
		case "m":
			return value * 60 * 1000;
		case "h":
			return value * 60 * 60 * 1000;
		case "d":
			return value * 24 * 60 * 60 * 1000;
		default:
			throw new Error(`Unknown unit: ${unit}`);
	}
}

export { parseDuration };
