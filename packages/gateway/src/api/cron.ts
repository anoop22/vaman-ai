import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { sendJson, sendError, parseBody } from "../http-router.js";
import type { ApiContext } from "./index.js";
import type { HttpRouter } from "../http-router.js";

export function registerCronRoutes(router: HttpRouter, ctx: ApiContext): void {
	router.get("/api/cron/jobs", async (_req, res) => {
		sendJson(res, ctx.cron.listJobs());
	});

	router.post("/api/cron/jobs", async (req, res) => {
		const body = await parseBody(req);
		if (!body.name || !body.scheduleType || !body.schedule || !body.prompt) {
			sendError(res, 400, "Missing required fields: name, scheduleType, schedule, prompt");
			return;
		}
		const job = ctx.cron.addJob({
			name: body.name,
			scheduleType: body.scheduleType,
			schedule: body.schedule,
			prompt: body.prompt,
			delivery: body.delivery || "discord:dm",
			enabled: body.enabled !== false,
		});
		sendJson(res, job, 201);
	});

	router.post("/api/cron/jobs/:id/trigger", async (_req, res, params) => {
		try {
			const result = await ctx.cron.triggerJob(params.id);
			sendJson(res, { ok: true, message: result });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			sendError(res, 404, msg);
		}
	});

	router.delete("/api/cron/jobs/:id", async (_req, res, params) => {
		const removed = ctx.cron.removeJob(params.id);
		if (removed) {
			sendJson(res, { ok: true });
		} else {
			sendError(res, 404, `Job ${params.id} not found`);
		}
	});

	router.get("/api/cron/runs/:jobId", async (_req, res, params) => {
		const runsPath = resolve(process.cwd(), "data/cron/runs", `${params.jobId}.jsonl`);
		if (!existsSync(runsPath)) {
			sendJson(res, []);
			return;
		}
		const lines = readFileSync(runsPath, "utf-8").trim().split("\n").filter(Boolean);
		const runs = lines.map((line) => JSON.parse(line));
		sendJson(res, runs);
	});
}
