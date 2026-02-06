import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { CronService } from "../cron-service.js";

/**
 * AgentTool that lets Nova manage cron jobs — list, add, remove scheduled tasks.
 */
export function createCronManageTool(cronService: CronService): AgentTool<any> {
	const schema = Type.Object({
		action: Type.Union([Type.Literal("list"), Type.Literal("add"), Type.Literal("remove")], {
			description: "Action: list (all jobs), add (new job), remove (delete job by id)",
		}),
		name: Type.Optional(Type.String({ description: "Job name (required for add)" })),
		scheduleType: Type.Optional(
			Type.Union([Type.Literal("cron"), Type.Literal("every"), Type.Literal("at")], {
				description:
					"Schedule type: cron (expression like '0 9 * * *'), every (interval like '30m' or '2h'), at (one-shot ISO date)",
			}),
		),
		schedule: Type.Optional(
			Type.String({ description: "Schedule value: cron expression, duration string, or ISO date" }),
		),
		prompt: Type.Optional(
			Type.String({ description: "The prompt to run through the agent when job fires" }),
		),
		delivery: Type.Optional(
			Type.String({ description: "Delivery channel, e.g. 'discord:dm' (default: discord:dm)" }),
		),
		enabled: Type.Optional(Type.Boolean({ description: "Whether job starts enabled (default: true)" })),
		id: Type.Optional(Type.String({ description: "Job ID (required for remove)" })),
	});

	return {
		name: "cron_manage",
		label: "cron_manage",
		description:
			"Manage scheduled cron jobs. Actions:\n" +
			"- list: Show all configured jobs\n" +
			"- add: Create a scheduled job (requires name, scheduleType, schedule, prompt)\n" +
			"- remove: Delete a job by id\n\n" +
			"Schedule types: 'cron' for cron expressions (e.g. '0 9 * * *' = daily 9am), " +
			"'every' for intervals (e.g. '30m', '2h', '1d'), " +
			"'at' for one-shot ISO dates.",
		parameters: schema,
		execute: async (_toolCallId, params) => {
			switch (params.action) {
				case "list": {
					const jobs = cronService.listJobs();
					if (jobs.length === 0) {
						return {
							content: [{ type: "text", text: "No cron jobs configured." }],
							details: undefined,
						};
					}
					const lines = jobs.map((j) => {
						const status = j.enabled ? "enabled" : "disabled";
						const preview = j.prompt.length > 100 ? j.prompt.slice(0, 100) + "..." : j.prompt;
						return (
							`**${j.name}** (\`${j.id}\`)\n` +
							`  Schedule: ${j.scheduleType} \`${j.schedule}\`\n` +
							`  Prompt: ${preview}\n` +
							`  Delivery: ${j.delivery} | Status: ${status}`
						);
					});
					return {
						content: [{ type: "text", text: `${jobs.length} job(s):\n\n${lines.join("\n\n")}` }],
						details: undefined,
					};
				}

				case "add": {
					if (!params.name || !params.scheduleType || !params.schedule || !params.prompt) {
						return {
							content: [
								{
									type: "text",
									text: "Missing required params: name, scheduleType, schedule, prompt",
								},
							],
							details: undefined,
						};
					}
					const job = cronService.addJob({
						name: params.name,
						scheduleType: params.scheduleType!,
						schedule: params.schedule,
						prompt: params.prompt,
						delivery: params.delivery || "discord:dm",
						enabled: params.enabled !== false,
					});
					return {
						content: [
							{
								type: "text",
								text:
									`Job created: **${job.name}** (\`${job.id}\`)\n` +
									`Schedule: ${job.scheduleType} \`${job.schedule}\`\n` +
									`Delivery: ${job.delivery}\n` +
									`Enabled: ${job.enabled}`,
							},
						],
						details: undefined,
					};
				}

				case "remove": {
					if (!params.id) {
						return {
							content: [{ type: "text", text: "Missing required param: id" }],
							details: undefined,
						};
					}
					const removed = cronService.removeJob(params.id);
					return {
						content: [
							{
								type: "text",
								text: removed ? `Job \`${params.id}\` removed.` : `Job \`${params.id}\` not found.`,
							},
						],
						details: undefined,
					};
				}

				default:
					return {
						content: [{ type: "text", text: `Unknown action: ${params.action}` }],
						details: undefined,
					};
			}
		},
	};
}
