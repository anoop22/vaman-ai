import { describe, it, expect } from "vitest";
import { chunkMessage } from "../src/adapter.js";

describe("chunkMessage", () => {
	it("returns single chunk for short messages", () => {
		expect(chunkMessage("hello", 2000)).toEqual(["hello"]);
	});

	it("splits long messages at newlines", () => {
		const text = "line1\n".repeat(500);
		const chunks = chunkMessage(text, 100);
		for (const chunk of chunks) {
			expect(chunk.length).toBeLessThanOrEqual(100);
		}
		expect(chunks.join("").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
	});

	it("handles messages with no good split points", () => {
		const text = "a".repeat(5000);
		const chunks = chunkMessage(text, 2000);
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.join("")).toBe(text);
	});

	it("preserves full content after splitting", () => {
		const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}: some content here`);
		const text = lines.join("\n");
		const chunks = chunkMessage(text, 200);
		const reassembled = chunks.join("\n");
		// All original content should be present
		for (const line of lines) {
			expect(reassembled).toContain(line);
		}
	});
});
