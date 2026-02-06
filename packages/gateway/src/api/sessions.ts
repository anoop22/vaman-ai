import { sendJson, sendError } from "../http-router.js";
import type { ApiContext } from "./index.js";
import type { HttpRouter } from "../http-router.js";

export function registerSessionRoutes(router: HttpRouter, ctx: ApiContext): void {
	router.get("/api/sessions", async (_req, res) => {
		sendJson(res, ctx.sessions.list());
	});

	router.get("/api/sessions/:key", async (_req, res, params) => {
		const key = decodeURIComponent(params.key);
		if (!ctx.sessions.exists(key)) {
			sendError(res, 404, `Session not found: ${key}`);
			return;
		}
		sendJson(res, ctx.sessions.read(key));
	});
}
