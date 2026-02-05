import { describe, it, expect } from "vitest";
import { resolveProvider } from "../src/providers.js";

describe("resolveProvider", () => {
	it("resolves openrouter provider config", () => {
		const provider = resolveProvider("openrouter", "google/gemini-3.0-flash");
		expect(provider.name).toBe("openrouter");
		expect(provider.model).toBe("google/gemini-3.0-flash");
	});

	it("resolves anthropic provider config", () => {
		const provider = resolveProvider("anthropic", "claude-sonnet-4-5-20250929");
		expect(provider.name).toBe("anthropic");
	});

	it("resolves openai provider config", () => {
		const provider = resolveProvider("openai", "gpt-4o");
		expect(provider.name).toBe("openai");
	});

	it("throws for unknown provider", () => {
		expect(() => resolveProvider("unknown", "model")).toThrow("Unknown provider");
	});
});
