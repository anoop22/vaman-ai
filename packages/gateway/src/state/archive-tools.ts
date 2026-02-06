import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ArchiveManager } from "./archive.js";
import type { WorldModelManager } from "./world-model.js";

/** Search the archive using grep + BM25 in parallel, merged and deduped */
export function createArchiveSearchTool(archive: ArchiveManager): AgentTool<any> {
	const schema = Type.Object({
		query: Type.String({ description: "Search query — keywords, exact phrases, file names, dates, etc." }),
		limit: Type.Optional(Type.Number({ description: "Max results to return (default 10)" })),
	});

	return {
		name: "archive_search",
		label: "archive_search",
		description:
			"Search the conversation archive for past exchanges, decisions, and context. " +
			"Uses both exact text matching and keyword relevance (BM25). " +
			"Use this when you need to recall past conversations, find decisions, or recover context from earlier sessions.",
		parameters: schema,
		execute: async (_toolCallId, params) => {
			const limit = params.limit ?? 10;
			const query = params.query;

			// Run grep and BM25 in parallel
			const [grepResults, bm25Results] = await Promise.all([
				Promise.resolve(archive.searchGrep(query, limit)),
				Promise.resolve(archive.searchBM25(query, limit)),
			]);

			// Merge and dedupe by ID
			const seen = new Set<number>();
			const merged = [];

			for (const r of [...bm25Results, ...grepResults]) {
				if (!seen.has(r.id)) {
					seen.add(r.id);
					merged.push(r);
				}
			}

			// Limit and format
			const results = merged.slice(0, limit);

			if (results.length === 0) {
				return {
					content: [{ type: "text", text: `No archive results for: "${query}"` }],
					details: undefined,
				};
			}

			const lines = results.map((r) => {
				const date = new Date(r.timestamp).toISOString().slice(0, 16);
				const preview = r.content.slice(0, 200);
				const tags = r.tags ? ` [${r.tags}]` : "";
				return `**#${r.id}** (${date}, ${r.role})${tags}\n${preview}${r.content.length > 200 ? "..." : ""}`;
			});

			return {
				content: [{ type: "text", text: `Found ${results.length} results:\n\n${lines.join("\n\n")}` }],
				details: undefined,
			};
		},
	};
}

/** Read a single archived item by ID */
export function createArchiveReadTool(archive: ArchiveManager): AgentTool<any> {
	const schema = Type.Object({
		id: Type.Number({ description: "The archive item ID (from archive_search results)" }),
	});

	return {
		name: "archive_read",
		label: "archive_read",
		description: "Read the full content of a specific archived conversation turn by its ID.",
		parameters: schema,
		execute: async (_toolCallId, params) => {
			const item = archive.read(params.id);

			if (!item) {
				return {
					content: [{ type: "text", text: `Archive item #${params.id} not found.` }],
					details: undefined,
				};
			}

			const date = new Date(item.timestamp).toISOString();
			const tags = item.tags ? `\nTags: ${item.tags}` : "";
			const text = `**Archive #${item.id}**\nDate: ${date}\nSession: ${item.sessionKey}\nRole: ${item.role}${tags}\n\n${item.content}`;

			return {
				content: [{ type: "text", text }],
				details: undefined,
			};
		},
	};
}

/** Read the current world model (debugging/transparency) */
export function createStateReadTool(worldModel: WorldModelManager): AgentTool<any> {
	const schema = Type.Object({});

	return {
		name: "state_read",
		label: "state_read",
		description:
			"Read your current world model — the living snapshot of what you know about the user, " +
			"current tasks, projects, and decisions. Useful for debugging or verifying your context.",
		parameters: schema,
		execute: async () => {
			const content = worldModel.load();
			return {
				content: [{ type: "text", text: content }],
				details: undefined,
			};
		},
	};
}
