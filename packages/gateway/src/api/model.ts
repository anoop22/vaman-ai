import { sendJson, sendError, parseBody } from "../http-router.js";
import type { ApiContext } from "./index.js";
import type { HttpRouter } from "../http-router.js";

export function registerModelRoutes(router: HttpRouter, ctx: ApiContext): void {
	router.get("/api/model", async (_req, res) => {
		sendJson(res, {
			current: `${ctx.config.agent.defaultProvider}/${ctx.config.agent.defaultModel}`,
			provider: ctx.config.agent.defaultProvider,
			model: ctx.config.agent.defaultModel,
			aliases: ctx.loadAliases(),
			fallbacks: ctx.loadFallbacks(),
		});
	});

	router.put("/api/model", async (req, res) => {
		const body = await parseBody<{ ref: string }>(req);
		if (!body.ref || !body.ref.includes("/")) {
			sendError(res, 400, "Missing or invalid 'ref' field (must be provider/model)");
			return;
		}
		const ok = ctx.switchModel(body.ref);
		if (ok) {
			sendJson(res, { ok: true, current: body.ref });
		} else {
			sendError(res, 400, `Failed to switch to ${body.ref}`);
		}
	});

	router.get("/api/model/aliases", async (_req, res) => {
		sendJson(res, ctx.loadAliases());
	});

	router.put("/api/model/aliases", async (req, res) => {
		const body = await parseBody<Record<string, string>>(req);
		ctx.saveAliases(body);
		sendJson(res, { ok: true });
	});

	router.get("/api/model/fallbacks", async (_req, res) => {
		sendJson(res, ctx.loadFallbacks());
	});

	router.put("/api/model/fallbacks", async (req, res) => {
		const body = await parseBody<string[]>(req);
		if (!Array.isArray(body)) {
			sendError(res, 400, "Body must be an array of model refs");
			return;
		}
		ctx.saveFallbacks(body);
		sendJson(res, { ok: true });
	});
}
