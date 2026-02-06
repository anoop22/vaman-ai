import { createLogger } from "@vaman-ai/shared";
import type { GatewayServer } from "../server.js";
import type { CronService, CronJob } from "../cron-service.js";

const log = createLogger("gateway-tool");

export interface GatewayToolAction {
	action: string;
	params?: Record<string, unknown>;
}

export interface GatewayToolResult {
	success: boolean;
	data?: unknown;
	error?: string;
}

/**
 * Gateway tool allows the agent to manage the gateway itself.
 * Actions: restart, config.get, config.patch, cron.add, cron.remove, cron.list, health
 */
export class GatewayTool {
	constructor(
		private server: GatewayServer,
		private cron: CronService,
	) {}

	async execute(action: GatewayToolAction): Promise<GatewayToolResult> {
		log.debug(`Executing action: ${action.action}`);

		switch (action.action) {
			case "health":
				return { success: true, data: this.server.getHealth() };

			case "config.get":
				return { success: true, data: this.server.getConfig() };

			case "config.patch": {
				if (!action.params) {
					return { success: false, error: "Missing params for config.patch" };
				}
				this.server.updateConfig(action.params as any);
				return { success: true, data: "Config updated" };
			}

			case "restart": {
				const reason = (action.params?.reason as string) || "Agent-requested restart";
				log.info(`Restart requested: ${reason}`);
				const result = this.server.restart.triggerRestart({
					reason,
					timestamp: Date.now(),
					sessionKey: action.params?.session as string,
					discordTarget: action.params?.discordTarget as string,
				});
				if (result.ok) {
					return { success: true, data: "Gateway restart triggered via systemctl. New process will start shortly." };
				}
				return { success: false, error: `Restart failed: ${result.detail}` };
			}

			case "cron.list":
				return { success: true, data: this.cron.listJobs() };

			case "cron.add": {
				const p = action.params;
				if (!p?.name || !p?.scheduleType || !p?.schedule || !p?.prompt) {
					return {
						success: false,
						error: "Missing required params: name, scheduleType, schedule, prompt",
					};
				}
				const job = this.cron.addJob({
					name: p.name as string,
					scheduleType: p.scheduleType as CronJob["scheduleType"],
					schedule: p.schedule as string,
					prompt: p.prompt as string,
					delivery: (p.delivery as string) || "discord:dm",
					enabled: p.enabled !== false,
				});
				return { success: true, data: job };
			}

			case "cron.remove": {
				const id = action.params?.id as string;
				if (!id) {
					return { success: false, error: "Missing job id" };
				}
				const removed = this.cron.removeJob(id);
				return {
					success: removed,
					data: removed ? "Job removed" : "Job not found",
				};
			}

			default:
				return { success: false, error: `Unknown action: ${action.action}` };
		}
	}
}
