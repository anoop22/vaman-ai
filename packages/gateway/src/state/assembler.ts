import { createLogger } from "@vaman-ai/shared";
import type { WorldModelManager } from "./world-model.js";
import type { SessionBufferManager } from "./session-buffer.js";

const log = createLogger("state:assembler");

// AgentMessage from pi-agent-core is a union of Message types from pi-ai.
// We construct UserMessage and AssistantMessage objects directly.
interface UserMessage {
	role: "user";
	content: string;
	timestamp: number;
}

/**
 * Creates a transformContext closure for the Agent.
 *
 * Called before each LLM call. Replaces the agent's internal message array with:
 * 1. World model as first user message (in <world_model> tags) + synthetic assistant ack
 * 2. Buffered turns from session buffer
 * 3. Current-turn messages from the agent's own array (the latest prompt)
 */
export function createTransformContext(
	worldModel: WorldModelManager,
	sessionBuffer: SessionBufferManager,
	getCurrentSessionKey: () => string,
) {
	return async (messages: any[]): Promise<any[]> => {
		const sessionKey = getCurrentSessionKey();
		if (!sessionKey) {
			// No session yet (startup), pass through unchanged
			return messages;
		}

		const result: any[] = [];

		// 1. World model injection
		const wmContent = worldModel.load();
		const wmMessage: UserMessage = {
			role: "user",
			content: `<world_model>\n${wmContent}\n</world_model>\n\nThis is your current world model — a living snapshot of what you know. Use it for context. Do not repeat it back.`,
			timestamp: Date.now() - 2,
		};

		// Synthetic assistant ack to maintain message alternation
		const ackMessage = {
			role: "assistant" as const,
			content: [{ type: "text" as const, text: "Understood. I have my world model loaded." }],
			timestamp: Date.now() - 1,
			// Minimal fields — convertToLlm handles the rest
			api: "messages" as any,
			provider: "anthropic" as any,
			model: "synthetic",
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			stopReason: "end_turn" as any,
		};

		result.push(wmMessage, ackMessage);

		// 2. Buffered turns from session buffer
		const turns = sessionBuffer.getTurns(sessionKey);
		for (const turn of turns) {
			if (turn.role === "user") {
				result.push({
					role: "user",
					content: turn.content,
					timestamp: turn.timestamp,
				});
			} else {
				result.push({
					role: "assistant",
					content: [{ type: "text", text: turn.content }],
					timestamp: turn.timestamp,
					api: "messages",
					provider: "anthropic",
					model: "buffered",
					usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
					stopReason: "end_turn",
				});
			}
		}

		// 3. Current-turn messages (the latest prompt just added by agent.prompt())
		// These are messages newer than the last buffered turn
		const lastBufferedTs = turns.length > 0 ? turns[turns.length - 1].timestamp : 0;
		for (const msg of messages) {
			if (msg.timestamp && msg.timestamp > lastBufferedTs) {
				result.push(msg);
			}
		}

		// If no current-turn messages were found, include the last message from agent
		// (the prompt that triggered this call)
		if (result.length === 2 + turns.length && messages.length > 0) {
			result.push(messages[messages.length - 1]);
		}

		log.debug(
			`Assembled context: wm(1) + ack(1) + buffer(${turns.length}) + current(${result.length - 2 - turns.length}) = ${result.length} messages`,
		);

		return result;
	};
}
