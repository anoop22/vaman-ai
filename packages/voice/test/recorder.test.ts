import { describe, it, expect } from "vitest";
import { startRecording } from "../src/recorder.js";

describe("recorder module", () => {
	it("exports startRecording function", () => {
		expect(typeof startRecording).toBe("function");
	});

	it("returns stop function and process", () => {
		// Start recording with very short duration
		const recording = startRecording({ maxDuration: 1 });

		expect(typeof recording.stop).toBe("function");
		expect(recording.process).toBeDefined();
		expect(recording.process.pid).toBeDefined();

		// Kill immediately to avoid needing a microphone
		recording.process.kill("SIGTERM");
	});
});
