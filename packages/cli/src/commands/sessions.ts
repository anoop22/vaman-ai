import { resolve } from "path";
import { SessionManager } from "@vaman-ai/gateway";
import { createLogger } from "@vaman-ai/shared";

const log = createLogger("cli");

export async function sessionsCommand() {
	const dataDir = resolve(import.meta.dirname, "../../../../data");
	const sessions = new SessionManager(dataDir);
	const list = sessions.list();

	if (list.length === 0) {
		console.log("No sessions found.");
		return;
	}

	console.log(`\n  Sessions (${list.length}):\n`);

	for (const session of list.sort((a, b) => b.lastActivity - a.lastActivity)) {
		const date = session.lastActivity
			? new Date(session.lastActivity).toLocaleString()
			: "unknown";
		const channel = session.parsed.channel;
		const target = session.parsed.target;
		console.log(`  [${channel}] ${target}`);
		console.log(`    Messages: ${session.messageCount} | Last: ${date}`);
		console.log(`    Key: ${session.key}\n`);
	}
}

export async function resumeCommand(sessionKey: string) {
	if (!sessionKey) {
		console.log("Usage: vaman resume <session-key>");
		console.log("Run 'vaman sessions' to see available sessions.");
		return;
	}

	const dataDir = resolve(import.meta.dirname, "../../../../data");
	const sessions = new SessionManager(dataDir);

	if (!sessions.exists(sessionKey)) {
		console.log(`Session not found: ${sessionKey}`);
		return;
	}

	const entries = sessions.read(sessionKey);
	console.log(`\nResuming session: ${sessionKey} (${entries.length} messages)\n`);

	// Show last few messages for context
	const recent = entries.slice(-6);
	for (const entry of recent) {
		const prefix = entry.role === "user" ? "you" : "vaman";
		const time = new Date(entry.timestamp).toLocaleTimeString();
		console.log(`  [${time}] ${prefix}: ${entry.content.slice(0, 100)}${entry.content.length > 100 ? "..." : ""}`);
	}

	console.log("\n--- Resuming in chat mode ---\n");

	// Import chat with session context
	const { loadConfig } = await import("@vaman-ai/shared");
	const { createVamanAgent } = await import("@vaman-ai/agent");
	const { createInterface } = await import("readline");

	const config = loadConfig();
	const agent = createVamanAgent({ config });

	// Subscribe for streaming
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
			// Save user message to session
			sessions.append(sessionKey, {
				role: "user",
				content: input,
				timestamp: Date.now(),
			});

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
