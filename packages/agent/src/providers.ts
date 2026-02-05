export interface ProviderConfig {
	name: string;
	model: string;
	apiKeyEnv: string;
}

const PROVIDER_MAP: Record<string, { apiKeyEnv: string }> = {
	openrouter: { apiKeyEnv: "OPENROUTER_API_KEY" },
	anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" },
	openai: { apiKeyEnv: "OPENAI_API_KEY" },
	google: { apiKeyEnv: "GEMINI_API_KEY" },
};

export function resolveProvider(name: string, model: string): ProviderConfig {
	const provider = PROVIDER_MAP[name];
	if (!provider) {
		throw new Error(
			`Unknown provider: ${name}. Available: ${Object.keys(PROVIDER_MAP).join(", ")}`,
		);
	}
	return { name, model, apiKeyEnv: provider.apiKeyEnv };
}

export function getApiKey(provider: ProviderConfig): string {
	const key = process.env[provider.apiKeyEnv];
	if (!key) {
		throw new Error(`Missing API key: set ${provider.apiKeyEnv} environment variable`);
	}
	return key;
}
