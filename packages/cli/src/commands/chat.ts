import { createInterface } from "readline";
import { loadConfig, createLogger } from "@vaman-ai/shared";
import { createVamanAgent } from "@vaman-ai/agent";

const log = createLogger("cli");

export async function chatCommand() {
	const config = loadConfig();
	log.info(`Starting Vaman AI (${config.agent.defaultProvider}/${config.agent.defaultModel})`);

	const agent = createVamanAgent({ config });

	// Subscribe to agent events for streaming output
	agent.subscribe((event: any) => {
		if (event.type === "message_update") {
			const assistantEvent = event.assistantMessageEvent;
			if (assistantEvent?.type === "text_delta") {
				process.stdout.write(assistantEvent.delta);
			}
		}
		if (event.type === "message_end") {
			console.log("");
			rl.prompt();
		}
	});

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: "\nvaman> ",
	});

	console.log("Vaman AI ready. Type your message (Ctrl+C to exit).\n");
	rl.prompt();

	rl.on("line", async (line) => {
		const input = line.trim();
		if (!input) {
			rl.prompt();
			return;
		}

		if (input === "/quit" || input === "/exit") {
			console.log("Goodbye!");
			process.exit(0);
		}

		try {
			process.stdout.write("\nvaman: ");
			await agent.prompt(input);
		} catch (err) {
			log.error("Agent error:", err);
			rl.prompt();
		}
	});

	rl.on("close", () => {
		console.log("\nGoodbye!");
		process.exit(0);
	});
}
