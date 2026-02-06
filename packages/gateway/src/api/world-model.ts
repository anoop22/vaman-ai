import { sendJson, sendError, parseBody } from "../http-router.js";
import type { ApiContext } from "./index.js";
import type { HttpRouter } from "../http-router.js";

export function registerWorldModelRoutes(router: HttpRouter, ctx: ApiContext): void {
	router.get("/api/world-model", async (_req, res) => {
		sendJson(res, { content: ctx.worldModel.load() });
	});

	router.put("/api/world-model", async (req, res) => {
		const body = await parseBody<{ content: string }>(req);
		if (!body.content && body.content !== "") {
			sendError(res, 400, "Missing 'content' field");
			return;
		}
		ctx.worldModel.save(body.content);
		sendJson(res, { ok: true });
	});
}
