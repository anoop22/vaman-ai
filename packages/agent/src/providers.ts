import { getModel, getOAuthApiKey, getProviders, getModels } from "@mariozechner/pi-ai";
import type { Model, Api, KnownProvider, OAuthCredentials } from "@mariozechner/pi-ai";

// Re-export for gateway use
export { getProviders, getModels };
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { createLogger } from "@vaman-ai/shared";

const log = createLogger("providers");

export interface ProviderConfig {
	name: KnownProvider;
	model: string;
	apiKeyEnv: string;
	isOAuth?: boolean;
}

const PROVIDER_MAP: Record<string, { apiKeyEnv: string; isOAuth?: boolean }> = {
	openrouter: { apiKeyEnv: "OPENROUTER_API_KEY" },
	anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" },
	openai: { apiKeyEnv: "OPENAI_API_KEY" },
	google: { apiKeyEnv: "GEMINI_API_KEY" },
	"openai-codex": { apiKeyEnv: "", isOAuth: true },
	xai: { apiKeyEnv: "XAI_API_KEY" },
	groq: { apiKeyEnv: "GROQ_API_KEY" },
	zai: { apiKeyEnv: "ZAI_API_KEY" },
	"kimi-coding": { apiKeyEnv: "KIMI_API_KEY" },
	mistral: { apiKeyEnv: "MISTRAL_API_KEY" },
	cerebras: { apiKeyEnv: "CEREBRAS_API_KEY" },
	opencode: { apiKeyEnv: "OPENCODE_API_KEY" },
	huggingface: { apiKeyEnv: "HF_TOKEN" },
};

// OAuth credentials cache
let oauthCredentials: Record<string, OAuthCredentials> | null = null;

function loadOAuthCredentials(): Record<string, OAuthCredentials> {
	if (oauthCredentials) return oauthCredentials;

	const credsFile = resolve(process.cwd(), "data/oauth/credentials.json");
	if (existsSync(credsFile)) {
		oauthCredentials = JSON.parse(readFileSync(credsFile, "utf-8"));
		return oauthCredentials!;
	}
	return {};
}

function saveOAuthCredentials(creds: Record<string, OAuthCredentials>): void {
	const credsFile = resolve(process.cwd(), "data/oauth/credentials.json");
	writeFileSync(credsFile, JSON.stringify(creds, null, 2), "utf-8");
	oauthCredentials = creds;
}

export function resolveProvider(name: string, model: string): ProviderConfig {
	const provider = PROVIDER_MAP[name];
	if (!provider) {
		throw new Error(
			`Unknown provider: ${name}. Available: ${Object.keys(PROVIDER_MAP).join(", ")}`,
		);
	}
	return { name: name as KnownProvider, model, apiKeyEnv: provider.apiKeyEnv, isOAuth: provider.isOAuth };
}

export function resolveModel(provider: ProviderConfig): Model<any> {
	return getModel(provider.name as any, provider.model as any);
}

export function getApiKey(provider: ProviderConfig): string {
	if (provider.isOAuth) {
		// For OAuth providers, return empty string - actual key is fetched async
		// The agent's getApiKey callback will call getApiKeyAsync
		return "";
	}
	const key = process.env[provider.apiKeyEnv];
	if (!key) {
		throw new Error(`Missing API key: set ${provider.apiKeyEnv} environment variable`);
	}
	return key;
}

/**
 * Get API key for a provider, supporting OAuth token refresh.
 */
export async function getApiKeyAsync(provider: ProviderConfig): Promise<string> {
	if (!provider.isOAuth) {
		return getApiKey(provider);
	}

	const creds = loadOAuthCredentials();
	const result = await getOAuthApiKey(provider.name as any, creds);
	if (!result) {
		throw new Error(
			`No OAuth credentials for ${provider.name}. Run: npx tsx packages/gateway/src/oauth-login.ts ${provider.name}`,
		);
	}

	// Save refreshed credentials
	creds[provider.name] = result.newCredentials;
	saveOAuthCredentials(creds);

	log.info(`OAuth token refreshed for ${provider.name}`);
	return result.apiKey;
}
