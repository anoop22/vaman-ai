import { createInterface } from "readline";
import { createLogger } from "@vaman-ai/shared";
import { ttsGenerate, playAudio, cleanupAudio } from "./tts.js";
import { sttTranscribe } from "./stt.js";
import { startRecording } from "./recorder.js";

const log = createLogger("voice");

export interface VoiceLoopOptions {
	/** Called with transcribed user text. Should return the agent's text response. */
	onUserMessage: (text: string) => Promise<string>;
	/** Called when the voice loop starts. */
	onStart?: () => void;
	/** Called when the voice loop ends. */
	onEnd?: () => void;
	/** TTS voice name. Defaults to "af_heart". */
	voice?: string;
	/** TTS speed. Defaults to 1.0. */
	speed?: number;
	/** STT model. Defaults to "mlx-community/parakeet-tdt-0.6b-v2". */
	sttModel?: string;
	/** TTS model. Defaults to "prince-canuma/Kokoro-82M". */
	ttsModel?: string;
}

/**
 * Run an interactive voice conversation loop.
 *
 * Flow: Press Enter to record -> STT -> agent callback -> TTS -> playback -> repeat
 *
 * Press Ctrl+C or type /quit to exit.
 */
export async function runVoiceLoop(options: VoiceLoopOptions): Promise<void> {
	const { onUserMessage, onStart, onEnd, voice, speed, sttModel, ttsModel } = options;

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	onStart?.();

	console.log("\nVaman Voice Mode");
	console.log("================");
	console.log("Press ENTER to start recording, ENTER again to stop.");
	console.log("Type /quit to exit voice mode.\n");

	const promptForInput = () => {
		rl.question("[Press ENTER to speak, /quit to exit] ", async (input) => {
			if (input.trim() === "/quit" || input.trim() === "/exit") {
				console.log("Exiting voice mode.");
				onEnd?.();
				rl.close();
				return;
			}

			try {
				// Start recording
				console.log("🎤 Recording... (press ENTER to stop)");
				const recording = startRecording();

				// Wait for user to press Enter to stop recording
				await new Promise<void>((resolve) => {
					rl.question("", () => resolve());
				});

				const { audioPath: recPath } = await recording.stop();
				console.log("⏹️  Recording stopped.");

				// Transcribe
				console.log("🔄 Transcribing...");
				const { text: userText } = await sttTranscribe({
					audioPath: recPath,
					model: sttModel,
				});
				cleanupAudio(recPath);

				if (!userText || userText.trim().length === 0) {
					console.log("(no speech detected)");
					promptForInput();
					return;
				}

				console.log(`You: ${userText}`);

				// Get agent response
				console.log("🤔 Thinking...");
				const agentText = await onUserMessage(userText);
				console.log(`Vaman: ${agentText}`);

				// Generate and play TTS
				console.log("🔊 Speaking...");
				const { audioPath: ttsPath } = await ttsGenerate({
					text: agentText,
					voice,
					speed,
					model: ttsModel,
				});

				await playAudio(ttsPath);
				cleanupAudio(ttsPath);
			} catch (err) {
				log.error(`Voice loop error: ${err}`);
				console.log(`Error: ${err instanceof Error ? err.message : err}`);
			}

			promptForInput();
		});
	};

	promptForInput();
}
