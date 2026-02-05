import { describe, it, expect, vi } from "vitest";
import { ttsGenerate, playAudio, cleanupAudio } from "../src/tts.js";
import { existsSync, writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We can't run actual TTS in CI, so test the module structure and error handling
describe("tts module", () => {
	it("exports ttsGenerate function", () => {
		expect(typeof ttsGenerate).toBe("function");
	});

	it("exports playAudio function", () => {
		expect(typeof playAudio).toBe("function");
	});

	it("cleanupAudio removes file", () => {
		const dir = mkdtempSync(join(tmpdir(), "vaman-tts-test-"));
		const filePath = join(dir, "test.wav");
		writeFileSync(filePath, "fake audio");
		expect(existsSync(filePath)).toBe(true);

		cleanupAudio(filePath);
		expect(existsSync(filePath)).toBe(false);
	});

	it("cleanupAudio ignores non-existent files", () => {
		// Should not throw
		cleanupAudio("/tmp/vaman-nonexistent-file.wav");
	});

	it("ttsGenerate rejects when python is not found", async () => {
		const original = process.env.VOICE_PYTHON_PATH;
		process.env.VOICE_PYTHON_PATH = "/nonexistent/python";

		await expect(
			ttsGenerate({ text: "Hello" }),
		).rejects.toThrow("Failed to spawn Python");

		process.env.VOICE_PYTHON_PATH = original;
	});
});
