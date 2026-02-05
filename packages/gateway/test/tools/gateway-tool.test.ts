import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { GatewayTool } from "../../src/tools/gateway-tool.js";
import { GatewayServer } from "../../src/server.js";
import { CronService } from "../../src/cron-service.js";
import type { VamanConfig } from "@vaman-ai/shared";

function makeConfig(): VamanConfig {
	return {
		gateway: { port: 18798, host: "127.0.0.1" },
		agent: { defaultModel: "test", defaultProvider: "test" },
		discord: { token: "", enabled: false },
		gmail: { credentialsPath: "", address: "", enabled: false, pollIntervalMs: 60000 },
		heartbeat: {
			enabled: false,
			intervalMs: 1800000,
			activeHoursStart: "08:00",
			activeHoursEnd: "22:00",
			defaultDelivery: "discord:dm",
		},
	};
}

describe("GatewayTool", () => {
	let tmpDir: string;
	let server: GatewayServer;
	let cron: CronService;
	let tool: GatewayTool;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "vaman-tool-test-"));
		server = new GatewayServer({ config: makeConfig(), dataDir: tmpDir });
		cron = new CronService(tmpDir, {
			onJobRun: async () => "done",
			onDeliver: async () => {},
		});
		tool = new GatewayTool(server, cron);
	});

	afterEach(async () => {
		cron.stop();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns health info", async () => {
		const result = await tool.execute({ action: "health" });
		expect(result.success).toBe(true);
		expect((result.data as any).status).toBe("ok");
	});

	it("returns config", async () => {
		const result = await tool.execute({ action: "config.get" });
		expect(result.success).toBe(true);
		expect((result.data as any).gateway.port).toBe(18798);
	});

	it("lists cron jobs", async () => {
		const result = await tool.execute({ action: "cron.list" });
		expect(result.success).toBe(true);
		expect(Array.isArray(result.data)).toBe(true);
	});

	it("adds a cron job", async () => {
		const result = await tool.execute({
			action: "cron.add",
			params: {
				name: "Test Cron",
				scheduleType: "cron",
				schedule: "0 9 * * *",
				prompt: "morning check",
				delivery: "discord:dm",
				enabled: false,
			},
		});
		expect(result.success).toBe(true);
		expect((result.data as any).name).toBe("Test Cron");
	});

	it("removes a cron job", async () => {
		const addResult = await tool.execute({
			action: "cron.add",
			params: {
				name: "To Remove",
				scheduleType: "cron",
				schedule: "0 * * * *",
				prompt: "test",
				enabled: false,
			},
		});
		const jobId = (addResult.data as any).id;

		const result = await tool.execute({ action: "cron.remove", params: { id: jobId } });
		expect(result.success).toBe(true);
	});

	it("returns error for unknown action", async () => {
		const result = await tool.execute({ action: "unknown" });
		expect(result.success).toBe(false);
		expect(result.error).toContain("Unknown action");
	});
});
