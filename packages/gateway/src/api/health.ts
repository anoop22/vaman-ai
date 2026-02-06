import { sendJson } from "../http-router.js";
import type { ApiContext } from "./index.js";
import type { HttpRouter } from "../http-router.js";

export function registerHealthRoutes(router: HttpRouter, ctx: ApiContext): void {
	router.get("/api/health", async (_req, res) => {
		sendJson(res, ctx.getHealth());
	});
}
