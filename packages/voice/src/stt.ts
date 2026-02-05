import { spawn } from "child_process";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createLogger } from "@vaman-ai/shared";

const log = createLogger("voice:stt");

export interface SttOptions {
	audioPath: string;
	model?: string;
	format?: "txt" | "json";
}

export interface SttResult {
	text: string;
	durationMs: number;
}

function getPythonPath(): string {
	return process.env.VOICE_PYTHON_PATH || "python3";
}

/**
 * Transcribe audio to text using Parakeet STT via mlx-audio.
 * Spawns a Python subprocess that uses mlx_audio.stt.generate.
 */
export async function sttTranscribe(options: SttOptions): Promise<SttResult> {
	const {
		audioPath,
		model = "mlx-community/parakeet-tdt-0.6b-v2",
		format = "txt",
	} = options;

	const pythonPath = getPythonPath();
	const outputPath = join(tmpdir(), `vaman-stt-${Date.now()}`);

	log.info(`Transcribing: ${audioPath} with model=${model}`);

	const start = Date.now();

	const args = [
		"-m",
		"mlx_audio.stt.generate",
		"--model",
		model,
		"--audio",
		audioPath,
		"--output",
		outputPath,
		"--format",
		format,
	];

	return new Promise<SttResult>((res, rej) => {
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
				log.error(`STT failed (code ${code}): ${stderr}`);
				rej(new Error(`STT transcription failed: ${stderr}`));
				return;
			}

			const txtFile = `${outputPath}.${format}`;
			if (!existsSync(txtFile)) {
				rej(new Error(`STT output not found at ${txtFile}`));
				return;
			}

			const text = readFileSync(txtFile, "utf-8").trim();

			// Clean up temp file
			try {
				unlinkSync(txtFile);
			} catch {
				// ignore
			}

			log.info(`STT complete in ${durationMs}ms: "${text.slice(0, 80)}..."`);
			res({ text, durationMs });
		});

		proc.on("error", (err) => {
			rej(new Error(`Failed to spawn Python: ${err.message}. Set VOICE_PYTHON_PATH.`));
		});
	});
}
