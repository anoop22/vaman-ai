import { loadConfig, createLogger } from "@vaman-ai/shared";
import { createVamanAgent } from "@vaman-ai/agent";
import { runVoiceLoop } from "@vaman-ai/voice";

const log = createLogger("cli:talk");

export async function talkCommand() {
	const config = loadConfig();
	log.info(`Starting voice mode (${config.agent.defaultProvider}/${config.agent.defaultModel})`);

	const agent = createVamanAgent({ config });

	// Collect full response text from streaming agent
	let responseBuffer = "";

	agent.subscribe((event: any) => {
		if (event.type === "message_update") {
			const assistantEvent = event.assistantMessageEvent;
			if (assistantEvent?.type === "text_delta") {
				responseBuffer += assistantEvent.delta;
			}
		}
	});

	await runVoiceLoop({
		onUserMessage: async (text) => {
			responseBuffer = "";
			await agent.prompt(text);
			return responseBuffer;
		},
		onStart: () => {
			console.log(
				`\nVaman Voice (${config.agent.defaultProvider}/${config.agent.defaultModel})`,
			);
		},
		onEnd: () => {
			console.log("Voice session ended.");
		},
		voice: process.env.VOICE_TTS_VOICE || "af_heart",
		speed: parseFloat(process.env.VOICE_TTS_SPEED || "1.0"),
	});
}
