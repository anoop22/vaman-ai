import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { HeartbeatRunner } from "../src/heartbeat.js";
import type { VamanConfig } from "@vaman-ai/shared";

function makeConfig(overrides?: Partial<VamanConfig["heartbeat"]>): VamanConfig {
	return {
		gateway: { port: 18790, host: "127.0.0.1" },
		agent: { defaultModel: "test", defaultProvider: "test" },
		discord: { token: "", enabled: false },
		gmail: { credentialsPath: "", address: "", enabled: false, pollIntervalMs: 60000 },
		heartbeat: {
			enabled: true,
			intervalMs: 60000,
			activeHoursStart: "00:00",
			activeHoursEnd: "23:59",
			defaultDelivery: "discord:dm",
			...overrides,
		},
		state: {
			conversationHistory: 10,
			worldModelPath: "data/state/world-model.md",
			archivePath: "data/state/archive.db",
			extractionEnabled: false,
			extractionTimeoutMs: 5000,
			worldModelMaxTokens: 1000,
			userTimezone: "America/New_York",
		},
	};
}

describe("HeartbeatRunner", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "vaman-hb-test-"));
		mkdirSync(join(tmpDir, "heartbeat"), { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("reads heartbeat content from HEARTBEAT.md", () => {
		writeFileSync(join(tmpDir, "heartbeat", "HEARTBEAT.md"), "Check my emails");

		const runner = new HeartbeatRunner({
			config: makeConfig(),
			dataDir: tmpDir,
			onHeartbeat: async () => "done",
			onDeliver: async () => {},
		});

		expect(runner.readHeartbeat()).toBe("Check my emails");
	});

	it("returns null for empty HEARTBEAT.md", () => {
		writeFileSync(join(tmpDir, "heartbeat", "HEARTBEAT.md"), "");

		const runner = new HeartbeatRunner({
			config: makeConfig(),
			dataDir: tmpDir,
			onHeartbeat: async () => "done",
			onDeliver: async () => {},
		});

		expect(runner.readHeartbeat()).toBeNull();
	});

	it("calls onHeartbeat and onDeliver when content exists", async () => {
		writeFileSync(join(tmpDir, "heartbeat", "HEARTBEAT.md"), "Check emails");

		const onHeartbeat = vi.fn().mockResolvedValue("You have 3 unread emails");
		const onDeliver = vi.fn().mockResolvedValue(undefined);

		const runner = new HeartbeatRunner({
			config: makeConfig(),
			dataDir: tmpDir,
			onHeartbeat,
			onDeliver,
		});

		await runner.tick();

		expect(onHeartbeat).toHaveBeenCalledWith("Check emails");
		expect(onDeliver).toHaveBeenCalledWith("discord:dm", "You have 3 unread emails");
	});

	it("skips when heartbeat file is empty", async () => {
		writeFileSync(join(tmpDir, "heartbeat", "HEARTBEAT.md"), "");

		const onHeartbeat = vi.fn();
		const runner = new HeartbeatRunner({
			config: makeConfig(),
			dataDir: tmpDir,
			onHeartbeat,
			onDeliver: async () => {},
		});

		await runner.tick();
		expect(onHeartbeat).not.toHaveBeenCalled();
	});

	it("checks active hours correctly", () => {
		const runner = new HeartbeatRunner({
			config: makeConfig({ activeHoursStart: "00:00", activeHoursEnd: "23:59" }),
			dataDir: tmpDir,
			onHeartbeat: async () => "",
			onDeliver: async () => {},
		});

		expect(runner.isActiveHours()).toBe(true);
	});
});
