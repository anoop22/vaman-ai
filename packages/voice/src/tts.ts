import { spawn } from "child_process";
import { existsSync, unlinkSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { createLogger } from "@vaman-ai/shared";

const log = createLogger("voice:tts");

export interface TtsOptions {
	text: string;
	model?: string;
	voice?: string;
	speed?: number;
	outputPath?: string;
	play?: boolean;
}

export interface TtsResult {
	audioPath: string;
	durationMs: number;
}

function getPythonPath(): string {
	return process.env.VOICE_PYTHON_PATH || "python3";
}

/**
 * Generate speech from text using Kokoro TTS via mlx-audio.
 * Spawns a Python subprocess that uses mlx_audio.tts.generate.
 */
export async function ttsGenerate(options: TtsOptions): Promise<TtsResult> {
	const {
		text,
		model = "prince-canuma/Kokoro-82M",
		voice = "af_heart",
		speed = 1.0,
		outputPath,
		play = false,
	} = options;

	const prefix = outputPath || join(tmpdir(), `vaman-tts-${Date.now()}`);
	const pythonPath = getPythonPath();

	log.info(`Generating TTS: voice=${voice}, speed=${speed}, model=${model}`);
	log.debug(`Python: ${pythonPath}`);

	const start = Date.now();

	const args = [
		"-m",
		"mlx_audio.tts.generate",
		"--model",
		model,
		"--text",
		text,
		"--voice",
		voice,
		"--speed",
		String(speed),
		"--file_prefix",
		prefix,
		"--join_audio",
	];

	if (play) {
		args.push("--play");
	}

	return new Promise<TtsResult>((res, rej) => {
		const proc = spawn(pythonPath, args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
		});

		let stderr = "";
		proc.stderr.on("data", (d) => {
			stderr += d.toString();
		});

		proc.on("close", (code) => {
			const durationMs = Date.now() - start;

			if (code !== 0) {
				log.error(`TTS failed (code ${code}): ${stderr}`);
				rej(new Error(`TTS generation failed: ${stderr}`));
				return;
			}

			// mlx-audio outputs <prefix>_000.wav
			const audioPath = `${prefix}_000.wav`;
			if (!existsSync(audioPath)) {
				// Try without the _000 suffix
				const altPath = `${prefix}.wav`;
				if (existsSync(altPath)) {
					log.info(`TTS complete in ${durationMs}ms -> ${altPath}`);
					res({ audioPath: altPath, durationMs });
					return;
				}
				rej(new Error(`TTS output not found at ${audioPath} or ${altPath}`));
				return;
			}

			log.info(`TTS complete in ${durationMs}ms -> ${audioPath}`);
			res({ audioPath, durationMs });
		});

		proc.on("error", (err) => {
			rej(new Error(`Failed to spawn Python: ${err.message}. Set VOICE_PYTHON_PATH.`));
		});
	});
}

/**
 * Play an audio file using the system player (afplay on macOS).
 */
export function playAudio(filePath: string): Promise<void> {
	return new Promise((res, rej) => {
		const player = process.platform === "darwin" ? "afplay" : "aplay";
		const proc = spawn(player, [filePath], { stdio: "ignore" });

		proc.on("close", (code) => {
			if (code !== 0) {
				rej(new Error(`Audio playback failed (code ${code})`));
				return;
			}
			res();
		});

		proc.on("error", (err) => {
			rej(new Error(`Failed to play audio: ${err.message}`));
		});
	});
}

/**
 * Clean up a temporary audio file.
 */
export function cleanupAudio(filePath: string): void {
	try {
		if (existsSync(filePath)) {
			unlinkSync(filePath);
		}
	} catch {
		// ignore cleanup errors
	}
}
