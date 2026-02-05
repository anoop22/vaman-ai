import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
	it("loads config from environment variables", () => {
		process.env.GATEWAY_PORT = "18790";
		process.env.DEFAULT_MODEL = "google/gemini-3-flash-preview";
		process.env.DEFAULT_PROVIDER = "openrouter";

		const config = loadConfig();

		expect(config.gateway.port).toBe(18790);
		expect(config.agent.defaultModel).toBe("google/gemini-3-flash-preview");
		expect(config.agent.defaultProvider).toBe("openrouter");
	});

	it("uses defaults when env vars are missing", () => {
		delete process.env.GATEWAY_PORT;
		const config = loadConfig();
		expect(config.gateway.port).toBe(18790);
	});
});
