import { sendJson } from "../http-router.js";
import type { ApiContext } from "./index.js";
import type { HttpRouter } from "../http-router.js";

export function registerConfigRoutes(router: HttpRouter, ctx: ApiContext): void {
	router.get("/api/config", async (_req, res) => {
		// Return config with sensitive fields masked
		const sanitized = {
			gateway: ctx.config.gateway,
			agent: ctx.config.agent,
			discord: {
				enabled: ctx.config.discord.enabled,
				token: ctx.config.discord.token ? "***" : "",
			},
			gmail: {
				enabled: ctx.config.gmail.enabled,
				address: ctx.config.gmail.address,
				pollIntervalMs: ctx.config.gmail.pollIntervalMs,
				credentialsPath: ctx.config.gmail.credentialsPath ? "***" : "",
			},
			heartbeat: ctx.config.heartbeat,
			state: ctx.config.state,
		};
		sendJson(res, sanitized);
	});
}
