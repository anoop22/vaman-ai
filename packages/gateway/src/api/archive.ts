import { sendJson, sendError } from "../http-router.js";
import type { ApiContext } from "./index.js";
import type { HttpRouter } from "../http-router.js";

export function registerArchiveRoutes(router: HttpRouter, ctx: ApiContext): void {
	router.get("/api/archive/search", async (_req, res, _params, query) => {
		const q = query.get("q");
		if (!q) {
			sendError(res, 400, "Missing 'q' query parameter");
			return;
		}
		const limit = parseInt(query.get("limit") || "10", 10);

		// Run grep + BM25 in parallel, merge and dedupe
		const [grepResults, bm25Results] = await Promise.all([
			Promise.resolve(ctx.archive.searchGrep(q, limit)),
			Promise.resolve(ctx.archive.searchBM25(q, limit)),
		]);

		const seen = new Set<number>();
		const merged = [];
		for (const r of [...bm25Results, ...grepResults]) {
			if (!seen.has(r.id)) {
				seen.add(r.id);
				merged.push(r);
			}
		}

		sendJson(res, merged.slice(0, limit));
	});

	router.get("/api/archive/:id", async (_req, res, params) => {
		const id = parseInt(params.id, 10);
		if (isNaN(id)) {
			sendError(res, 400, "Invalid archive ID");
			return;
		}
		const item = ctx.archive.read(id);
		if (!item) {
			sendError(res, 404, `Archive item ${id} not found`);
			return;
		}
		sendJson(res, item);
	});
}
