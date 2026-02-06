import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import WebSocket from "ws";
import { GatewayServer } from "../src/server.js";
import type { VamanConfig, GatewayResponse } from "@vaman-ai/shared";

const TEST_PORT = 18799;

function makeConfig(port = TEST_PORT): VamanConfig {
	return {
		gateway: { port, host: "127.0.0.1" },
		agent: { defaultModel: "google/gemini-3-flash-preview", defaultProvider: "openrouter" },
		discord: { token: "", enabled: false },
		gmail: {
			credentialsPath: "",
			address: "",
			enabled: false,
			pollIntervalMs: 60000,
		},
		heartbeat: {
			enabled: false,
			intervalMs: 1800000,
			activeHoursStart: "08:00",
			activeHoursEnd: "22:00",
			defaultDelivery: "discord:dm",
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

describe("GatewayServer", () => {
	let tmpDir: string;
	let server: GatewayServer;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "vaman-gw-test-"));
		server = new GatewayServer({ config: makeConfig(), dataDir: tmpDir, watchPaths: [] });
		await server.start();
	});

	afterEach(async () => {
		await server.stop();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	function connect(): Promise<WebSocket> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
			ws.on("open", () => resolve(ws));
			ws.on("error", reject);
		});
	}

	function request(ws: WebSocket, method: string, params?: Record<string, unknown>): Promise<GatewayResponse> {
		return new Promise((resolve) => {
			const id = Math.random().toString(36).slice(2);
			ws.on("message", function handler(data) {
				const msg = JSON.parse(data.toString());
				if (msg.type === "res" && msg.id === id) {
					ws.off("message", handler);
					resolve(msg);
				}
			});
			ws.send(JSON.stringify({ type: "req", id, method, params }));
		});
	}

	it("accepts WebSocket connections", async () => {
		const ws = await connect();
		expect(ws.readyState).toBe(WebSocket.OPEN);
		ws.close();
	});

	it("responds to health requests", async () => {
		const ws = await connect();
		const res = await request(ws, "health");
		expect(res.ok).toBe(true);
		expect((res.payload as any).status).toBe("ok");
		ws.close();
	});

	it("responds to sessions.list", async () => {
		const ws = await connect();
		const res = await request(ws, "sessions.list");
		expect(res.ok).toBe(true);
		expect(Array.isArray(res.payload)).toBe(true);
		ws.close();
	});

	it("returns error for unknown methods", async () => {
		const ws = await connect();
		const res = await request(ws, "unknown.method");
		expect(res.ok).toBe(false);
		expect(res.error).toContain("Unknown method");
		ws.close();
	});
});
