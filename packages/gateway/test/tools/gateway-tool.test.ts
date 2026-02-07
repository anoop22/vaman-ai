import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createGatewayRestartTool, type GatewayRestartToolOpts } from "../../src/tools/gateway-tool.js";
import { RestartManager } from "../../src/restart-sentinel.js";

describe("createGatewayRestartTool", () => {
	let tmpDir: string;
	let restartManager: RestartManager;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "vaman-tool-test-"));
		restartManager = new RestartManager(tmpDir);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	function makeTool(overrides?: Partial<GatewayRestartToolOpts>) {
		return createGatewayRestartTool({
			restartManager,
			getCurrentSessionKey: () => "discord:guild:dm:123456",
			getDiscordTarget: () => "dm:123456",
			...overrides,
		});
	}

	it("has correct name and label", () => {
		const tool = makeTool();
		expect(tool.name).toBe("gateway_restart");
		expect(tool.label).toBe("gateway_restart");
	});

	it("writes restart sentinel on execute", async () => {
		const tool = makeTool();
		vi.useFakeTimers();

		const result = await tool.execute("call-1", { reason: "test restart" });

		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("Gateway restart scheduled");
		expect(text).toContain("test restart");

		// Verify sentinel was written (read the file directly, don't consume)
		const sentinelPath = join(tmpDir, "restart-sentinel.json");
		expect(existsSync(sentinelPath)).toBe(true);
		const sentinel = JSON.parse(readFileSync(sentinelPath, "utf-8"));
		expect(sentinel.reason).toBe("test restart");
		expect(sentinel.sessionKey).toBe("discord:guild:dm:123456");
		expect(sentinel.discordTarget).toBe("dm:123456");

		vi.useRealTimers();
	});

	it("uses default delay of 2000ms", async () => {
		const tool = makeTool();
		vi.useFakeTimers();

		const result = await tool.execute("call-2", { reason: "default delay" });
		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("2000ms");

		vi.useRealTimers();
	});

	it("respects custom delayMs", async () => {
		const tool = makeTool();
		vi.useFakeTimers();

		const result = await tool.execute("call-3", { reason: "custom delay", delayMs: 5000 });
		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("5000ms");

		vi.useRealTimers();
	});
});
