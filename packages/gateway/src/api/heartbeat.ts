import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { sendJson, sendError, parseBody } from "../http-router.js";
import type { ApiContext } from "./index.js";
import type { HttpRouter } from "../http-router.js";

export function registerHeartbeatRoutes(router: HttpRouter, ctx: ApiContext): void {
	const heartbeatPath = resolve(process.cwd(), "data/heartbeat/HEARTBEAT.md");

	router.get("/api/heartbeat", async (_req, res) => {
		sendJson(res, {
			enabled: ctx.config.heartbeat.enabled,
			intervalMs: ctx.config.heartbeat.intervalMs,
			activeHoursStart: ctx.config.heartbeat.activeHoursStart,
			activeHoursEnd: ctx.config.heartbeat.activeHoursEnd,
			defaultDelivery: ctx.config.heartbeat.defaultDelivery,
			heartbeatModel: ctx.getHeartbeatModel(),
		});
	});

	router.get("/api/heartbeat/model", async (_req, res) => {
		sendJson(res, ctx.getHeartbeatModel());
	});

	router.put("/api/heartbeat/model", async (req, res) => {
		const body = await parseBody<{ ref?: string | null; clear?: boolean }>(req);
		const requested = body.clear ? null : (body.ref ?? null);
		if (requested !== null && (typeof requested !== "string" || requested.trim().length === 0)) {
			sendError(res, 400, "Invalid 'ref' (must be non-empty string or null)");
			return;
		}
		const result = ctx.setHeartbeatModel(requested);
		if (!result.ok) {
			sendError(res, 400, result.error || "Failed to update heartbeat model");
			return;
		}
		sendJson(res, { ok: true, ...ctx.getHeartbeatModel() });
	});

	router.get("/api/heartbeat/content", async (_req, res) => {
		if (!existsSync(heartbeatPath)) {
			sendJson(res, { content: "" });
			return;
		}
		sendJson(res, { content: readFileSync(heartbeatPath, "utf-8") });
	});

	router.get("/api/heartbeat/runs", async (_req, res, _params, query) => {
		const runsPath = resolve(process.cwd(), "data/heartbeat/runs.jsonl");
		if (!existsSync(runsPath)) {
			sendJson(res, []);
			return;
		}
		const lines = readFileSync(runsPath, "utf-8").trim().split("\n").filter(Boolean);
		const runs = lines.map((line) => {
			try { return JSON.parse(line); } catch { return null; }
		}).filter(Boolean);
		const limit = parseInt(query.get("limit") || "50", 10);
		sendJson(res, runs.reverse().slice(0, limit));
	});

	router.put("/api/heartbeat/content", async (req, res) => {
		const body = await parseBody<{ content: string }>(req);
		if (body.content === undefined) {
			sendError(res, 400, "Missing 'content' field");
			return;
		}
		mkdirSync(dirname(heartbeatPath), { recursive: true });
		writeFileSync(heartbeatPath, body.content, "utf-8");
		sendJson(res, { ok: true });
	});
}
