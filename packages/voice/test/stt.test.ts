import { describe, it, expect } from "vitest";
import { sttTranscribe } from "../src/stt.js";

describe("stt module", () => {
	it("exports sttTranscribe function", () => {
		expect(typeof sttTranscribe).toBe("function");
	});

	it("rejects when python is not found", async () => {
		const original = process.env.VOICE_PYTHON_PATH;
		process.env.VOICE_PYTHON_PATH = "/nonexistent/python";

		await expect(
			sttTranscribe({ audioPath: "/tmp/fake.wav" }),
		).rejects.toThrow("Failed to spawn Python");

		process.env.VOICE_PYTHON_PATH = original;
	});
});
