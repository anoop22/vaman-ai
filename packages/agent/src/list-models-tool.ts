import { Type } from "@sinclair/typebox";
import { getProviders, getModels } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const PROVIDER_API_KEYS: Record<string, { envVar: string; isOAuth?: boolean }> = {
	openrouter: { envVar: "OPENROUTER_API_KEY" },
	anthropic: { envVar: "ANTHROPIC_API_KEY" },
	openai: { envVar: "OPENAI_API_KEY" },
	google: { envVar: "GEMINI_API_KEY" },
	"openai-codex": { envVar: "", isOAuth: true },
	"google-gemini-cli": { envVar: "", isOAuth: true },
	xai: { envVar: "XAI_API_KEY" },
	groq: { envVar: "GROQ_API_KEY" },
	cerebras: { envVar: "CEREBRAS_API_KEY" },
	mistral: { envVar: "MISTRAL_API_KEY" },
	zai: { envVar: "ZAI_API_KEY" },
	opencode: { envVar: "OPENCODE_API_KEY" },
};

const schema = Type.Object({
	provider: Type.Optional(
		Type.String({ description: "Filter by provider name (e.g. 'openai-codex', 'anthropic')" }),
	),
	configured_only: Type.Optional(
		Type.Boolean({
			description: "Only show providers with configured API keys/OAuth (default: true)",
		}),
	),
});

function isProviderConfigured(provider: string): { configured: boolean; method: string } {
	const config = PROVIDER_API_KEYS[provider];
	if (!config) return { configured: false, method: "unknown" };
	if (config.isOAuth) {
		return { configured: true, method: "OAuth" };
	}
	if (config.envVar && process.env[config.envVar]) {
		return { configured: true, method: `env: ${config.envVar}` };
	}
	return { configured: false, method: `needs: ${config.envVar}` };
}

export function createListModelsTool(): AgentTool<typeof schema> {
	return {
		name: "list_models",
		label: "list_models",
		description:
			"List available AI model providers and their models. " +
			"Shows which providers are configured (have API keys or OAuth) " +
			"and what models are available for each. Use /models to trigger this.",
		parameters: schema,
		execute: async (_toolCallId, params) => {
			const configuredOnly = params.configured_only !== false;
			const filterProvider = params.provider;

			const allProviders = getProviders();
			const lines: string[] = [];

			for (const providerName of allProviders) {
				if (filterProvider && providerName !== filterProvider) continue;

				const { configured, method } = isProviderConfigured(providerName);
				if (configuredOnly && !configured) continue;

				const status = configured ? `[CONFIGURED - ${method}]` : "[NOT CONFIGURED]";
				lines.push(`\n## ${providerName} ${status}`);

				try {
					const models = getModels(providerName as any);
					if (models.length === 0) {
						lines.push("  (no models registered)");
					} else {
						for (const m of models) {
							const features: string[] = [];
							if (m.reasoning) features.push("reasoning");
							if (m.input.includes("image")) features.push("vision");
							const featureStr = features.length ? ` [${features.join(", ")}]` : "";
							const ctx = m.contextWindow
								? ` ctx:${Math.round(m.contextWindow / 1000)}k`
								: "";
							lines.push(`  - ${m.id}${featureStr}${ctx}`);
						}
					}
				} catch {
					lines.push("  (error loading models)");
				}
			}

			if (lines.length === 0) {
				const text = configuredOnly
					? "No configured providers found. Use configured_only=false to see all."
					: "No providers found.";
				return { content: [{ type: "text", text }], details: undefined };
			}

			const header = configuredOnly
				? "# Available Models (configured providers)"
				: "# All Known Providers & Models";
			return {
				content: [{ type: "text", text: header + "\n" + lines.join("\n") }],
				details: undefined,
			};
		},
	};
}
