import { Agent } from "@mariozechner/pi-agent-core";
import type { VamanConfig } from "@vaman-ai/shared";
import { createLogger } from "@vaman-ai/shared";
import { resolveProvider, getApiKey } from "./providers.js";

const log = createLogger("agent");

export interface VamanAgentOptions {
	config: VamanConfig;
	systemPrompt?: string;
	tools?: any[];
}

export async function createVamanAgent(options: VamanAgentOptions): Promise<Agent> {
	const { config, systemPrompt, tools } = options;
	const provider = resolveProvider(config.agent.defaultProvider, config.agent.defaultModel);
	const apiKey = getApiKey(provider);

	log.info(`Creating agent with provider=${provider.name} model=${provider.model}`);

	const agent = new Agent({
		apiKey,
		provider: provider.name,
		model: provider.model,
		systemPrompt: systemPrompt || getDefaultSystemPrompt(),
		tools: tools || [],
	});

	return agent;
}

function getDefaultSystemPrompt(): string {
	return `You are Vaman, a personal AI assistant. You help your user across Discord, Gmail, terminal, and voice.

You have access to tools for web search, file management, and system control. Be concise, helpful, and proactive.

When you don't know something, say so. When you can help, do it efficiently.`;
}
