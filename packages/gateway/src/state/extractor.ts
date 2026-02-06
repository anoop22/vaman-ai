import { completeSimple, getModel } from "@mariozechner/pi-ai";
import type { VamanConfig } from "@vaman-ai/shared";
import { createLogger } from "@vaman-ai/shared";
import { resolveProvider, getApiKey as getProviderApiKey, getApiKeyAsync } from "@vaman-ai/agent";
import type { WorldModelManager, WorldModelUpdate } from "./world-model.js";
import type { ArchiveManager } from "./archive.js";

const log = createLogger("state:extractor");

export interface ExtractionInput {
	userMessage: string;
	assistantResponse: string;
	sessionKey: string;
}

interface ExtractionOutput {
	world_model_updates: WorldModelUpdate[];
	tags: string[];
	archive_note: string;
}

const EXTRACTION_SYSTEM_PROMPT = `You are a world model librarian. Your job is to analyze a conversation exchange and decide what to update in the world model.

The world model is a living snapshot of what's true RIGHT NOW. It has fixed sections:
- Identity: User info, preferences
- Current Task: What's being worked on right now
- Active Projects: Ongoing projects
- Key Technical Decisions: Important architectural/technical choices
- Preferences & Patterns: How the user works

RULES:
1. REPLACE, don't append. "Working on: X" becomes "Working on: Y", not a new line.
2. Current state only. Completed tasks should be REMOVED (action: "remove"), not kept.
3. Keep it SMALL. Target 500-800 tokens. Archive aggressively.
4. Only update if something actually changed. Most turns need zero updates.
5. Be precise with field names — match existing fields exactly.

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "world_model_updates": [
    {"action": "replace"|"add"|"remove", "section": "Section Name", "field": "Field Name", "value": "new value"}
  ],
  "tags": ["relevant", "tags"],
  "archive_note": "Brief note about what happened in this exchange"
}

If nothing notable happened, respond with:
{"world_model_updates": [], "tags": [], "archive_note": ""}`;

export class ExtractorService {
	private config: VamanConfig;
	private worldModel: WorldModelManager;
	private archive: ArchiveManager;
	private loadFallbacks: () => string[];

	constructor(
		config: VamanConfig,
		worldModel: WorldModelManager,
		archive: ArchiveManager,
		loadFallbacks: () => string[],
	) {
		this.config = config;
		this.worldModel = worldModel;
		this.archive = archive;
		this.loadFallbacks = loadFallbacks;
	}

	/** Fire-and-forget extraction. Catches all errors internally. */
	extract(input: ExtractionInput): void {
		if (!this.config.state.extractionEnabled) {
			log.info("Extraction disabled, skipping");
			return;
		}

		log.info(`Extraction starting for session: ${input.sessionKey}`);
		this.doExtract(input).catch((err) => {
			log.error(`Extraction failed (all models): ${err}`);
		});
	}

	private async doExtract(input: ExtractionInput): Promise<void> {
		const currentWorldModel = this.worldModel.load();

		const userPrompt = `Current world model:
\`\`\`
${currentWorldModel}
\`\`\`

Latest exchange:
User: ${input.userMessage}
Assistant: ${input.assistantResponse}

What updates are needed?`;

		// Build candidate list: current model + fallbacks
		const primary = `${this.config.agent.defaultProvider}/${this.config.agent.defaultModel}`;
		const candidates = [primary, ...this.loadFallbacks()];

		for (const candidate of candidates) {
			try {
				const result = await this.callModel(candidate, userPrompt);
				if (result) {
					this.applyResult(result);
					return;
				}
			} catch (err) {
				log.warn(`Extractor model ${candidate} failed: ${err}`);
			}
		}

		log.error("Extraction failed: all models exhausted");
	}

	private async callModel(modelRef: string, userPrompt: string): Promise<ExtractionOutput | null> {
		const si = modelRef.indexOf("/");
		if (si === -1) return null;

		const providerName = modelRef.slice(0, si);
		const modelName = modelRef.slice(si + 1);

		const providerConfig = resolveProvider(providerName, modelName);
		const model = getModel(providerName as any, modelName as any);
		const apiKey = providerConfig.isOAuth
			? await getApiKeyAsync(providerConfig)
			: getProviderApiKey(providerConfig);

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.config.state.extractionTimeoutMs);

		try {
			log.info(`Calling extractor model: ${modelRef}, apiKey: ${apiKey ? "present" : "MISSING"}`);
			const response = await completeSimple(model, {
				systemPrompt: EXTRACTION_SYSTEM_PROMPT,
				messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
			}, {
				apiKey,
				reasoning: "low" as any,
				signal: controller.signal,
				maxTokens: 1000,
			});

			clearTimeout(timeout);

			// Extract text from response
			const text = response.content
				.filter((c: any) => c.type === "text")
				.map((c: any) => c.text)
				.join("");

			if (!text.trim()) return null;

			// Parse JSON — handle markdown code blocks
			let jsonStr = text.trim();
			if (jsonStr.startsWith("```")) {
				jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
			}

			return JSON.parse(jsonStr) as ExtractionOutput;
		} catch (err) {
			clearTimeout(timeout);
			throw err;
		}
	}

	private applyResult(result: ExtractionOutput): void {
		if (result.world_model_updates.length > 0) {
			this.worldModel.applyUpdates(result.world_model_updates);
			log.info(`Applied ${result.world_model_updates.length} world model updates`);
		}

		if (result.archive_note) {
			log.debug(`Archive note: ${result.archive_note}`);
		}

		if (result.tags.length > 0) {
			log.debug(`Tags: ${result.tags.join(", ")}`);
		}
	}
}
