import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CronService, parseDuration } from "../src/cron-service.js";

describe("CronService", () => {
	let tmpDir: string;
	let onJobRun: ReturnType<typeof vi.fn>;
	let onDeliver: ReturnType<typeof vi.fn>;
	let service: CronService;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "vaman-cron-test-"));
		onJobRun = vi.fn().mockResolvedValue("Job completed");
		onDeliver = vi.fn().mockResolvedValue(undefined);
		service = new CronService(tmpDir, { onJobRun, onDeliver });
	});

	afterEach(() => {
		service.stop();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("adds and lists jobs", () => {
		const job = service.addJob({
			name: "Test Job",
			scheduleType: "cron",
			schedule: "0 * * * *",
			prompt: "do something",
			delivery: "discord:dm",
			enabled: false,
		});

		expect(job.id).toBeDefined();
		expect(job.name).toBe("Test Job");

		const jobs = service.listJobs();
		expect(jobs).toHaveLength(1);
		expect(jobs[0].name).toBe("Test Job");
	});

	it("removes jobs", () => {
		const job = service.addJob({
			name: "To Remove",
			scheduleType: "cron",
			schedule: "0 * * * *",
			prompt: "test",
			delivery: "discord:dm",
			enabled: false,
		});

		expect(service.removeJob(job.id)).toBe(true);
		expect(service.listJobs()).toHaveLength(0);
	});

	it("gets a specific job", () => {
		const job = service.addJob({
			name: "Specific",
			scheduleType: "every",
			schedule: "30m",
			prompt: "check",
			delivery: "discord:dm",
			enabled: false,
		});

		const found = service.getJob(job.id);
		expect(found?.name).toBe("Specific");
		expect(service.getJob("nonexistent")).toBeUndefined();
	});

	it("persists jobs across instances", () => {
		service.addJob({
			name: "Persistent",
			scheduleType: "cron",
			schedule: "0 9 * * *",
			prompt: "morning",
			delivery: "discord:dm",
			enabled: false,
		});

		// Create new instance with same data dir
		const service2 = new CronService(tmpDir, { onJobRun, onDeliver });
		service2.start();

		expect(service2.listJobs()).toHaveLength(1);
		expect(service2.listJobs()[0].name).toBe("Persistent");
		service2.stop();
	});
});

describe("parseDuration", () => {
	it("parses seconds", () => expect(parseDuration("30s")).toBe(30000));
	it("parses minutes", () => expect(parseDuration("5m")).toBe(300000));
	it("parses hours", () => expect(parseDuration("2h")).toBe(7200000));
	it("parses days", () => expect(parseDuration("1d")).toBe(86400000));
	it("throws for invalid", () => expect(() => parseDuration("abc")).toThrow());
});
