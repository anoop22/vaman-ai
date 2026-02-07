import { Agent } from "@mariozechner/pi-agent-core";
import type { VamanConfig } from "@vaman-ai/shared";
import { createLogger } from "@vaman-ai/shared";
import { resolveProvider, resolveModel, getApiKey as getProviderApiKey, getApiKeyAsync } from "./providers.js";

const log = createLogger("agent");

export interface VamanAgentOptions {
	config: VamanConfig;
	systemPrompt?: string;
	tools?: any[];
	transformContext?: (messages: any[], signal?: AbortSignal) => Promise<any[]>;
}

export function createVamanAgent(options: VamanAgentOptions): Agent {
	const { config, systemPrompt, tools, transformContext } = options;
	const initialProvider = resolveProvider(config.agent.defaultProvider, config.agent.defaultModel);
	const model = resolveModel(initialProvider);

	log.info(`Creating agent with provider=${initialProvider.name} model=${initialProvider.model}`);
	log.info(`Model resolved: ${model?.id || "UNDEFINED"}, tools: ${tools?.length || 0}`);

	const agent = new Agent({
		initialState: {
			systemPrompt: systemPrompt || getDefaultSystemPrompt(),
			model,
			tools: tools || [],
			thinkingLevel: "medium",
		},
		// Dynamic: resolves API key based on current config (supports model switching)
		getApiKey: () => {
			const p = resolveProvider(config.agent.defaultProvider, config.agent.defaultModel);
			return p.isOAuth ? getApiKeyAsync(p) : getProviderApiKey(p);
		},
		transformContext,
	});

	log.info(`Agent created, state.model: ${agent.state?.model?.id || "UNDEFINED"}`);
	return agent;
}

function getDefaultSystemPrompt(): string {
	return `You are Vaman, a personal AI assistant. You help your user across Discord, Gmail, terminal, and voice.

You have access to tools for web search, file management, and system control. Be concise, helpful, and proactive.

When you don't know something, say so. When you can help, do it efficiently.`;
}
