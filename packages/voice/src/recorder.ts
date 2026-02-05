import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createLogger } from "@vaman-ai/shared";

const log = createLogger("voice:recorder");

export interface RecorderOptions {
	/** Output file path. Defaults to a temp WAV file. */
	outputPath?: string;
	/** Sample rate in Hz. Defaults to 16000 for STT compatibility. */
	sampleRate?: number;
	/** Number of audio channels. Defaults to 1 (mono). */
	channels?: number;
	/** Max recording duration in seconds. Defaults to 30. */
	maxDuration?: number;
}

export interface RecordingResult {
	audioPath: string;
	durationMs: number;
}

/**
 * Records audio from the default microphone using ffmpeg.
 *
 * Returns a controller object with a `stop()` method that finalizes
 * the recording and returns the result.
 */
export function startRecording(options: RecorderOptions = {}): {
	stop: () => Promise<RecordingResult>;
	process: ChildProcess;
} {
	const {
		outputPath = join(tmpdir(), `vaman-rec-${Date.now()}.wav`),
		sampleRate = 16000,
		channels = 1,
		maxDuration = 30,
	} = options;

	const startTime = Date.now();

	log.info(`Recording to ${outputPath} (${sampleRate}Hz, ${channels}ch, max ${maxDuration}s)`);

	// Use ffmpeg to capture from default audio input on macOS
	const args =
		process.platform === "darwin"
			? [
					"-f",
					"avfoundation",
					"-i",
					":default",
					"-ac",
					String(channels),
					"-ar",
					String(sampleRate),
					"-t",
					String(maxDuration),
					"-y",
					outputPath,
				]
			: [
					"-f",
					"pulse",
					"-i",
					"default",
					"-ac",
					String(channels),
					"-ar",
					String(sampleRate),
					"-t",
					String(maxDuration),
					"-y",
					outputPath,
				];

	const proc = spawn("ffmpeg", args, {
		stdio: ["pipe", "pipe", "pipe"],
	});

	let stderr = "";
	proc.stderr.on("data", (d) => {
		stderr += d.toString();
	});

	const stop = (): Promise<RecordingResult> => {
		return new Promise((res, rej) => {
			const onExit = () => {
				const durationMs = Date.now() - startTime;

				if (!existsSync(outputPath)) {
					rej(new Error(`Recording failed - no output file. ffmpeg stderr: ${stderr}`));
					return;
				}

				log.info(`Recording saved in ${durationMs}ms -> ${outputPath}`);
				res({ audioPath: outputPath, durationMs });
			};

			if (proc.exitCode !== null) {
				onExit();
				return;
			}

			proc.on("close", () => onExit());

			// Send 'q' to ffmpeg for graceful stop
			proc.stdin.write("q");
			proc.stdin.end();
		});
	};

	return { stop, process: proc };
}
