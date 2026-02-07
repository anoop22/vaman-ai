import { spawnSync } from "child_process";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createLogger } from "@vaman-ai/shared";
import type { RestartManager } from "../restart-sentinel.js";

const log = createLogger("gateway-tool");

export interface GatewayRestartToolOpts {
	restartManager: RestartManager;
	getCurrentSessionKey: () => string;
	getDiscordTarget: () => string;
}

/**
 * AgentTool that lets Nova restart the gateway process.
 * Writes a restart sentinel (so the new process confirms back in chat),
 * then schedules a systemctl restart after a configurable delay.
 */
export function createGatewayRestartTool(opts: GatewayRestartToolOpts): AgentTool<any> {
	const schema = Type.Object({
		reason: Type.String({
			description: "Why the restart is needed (e.g. 'applied code changes to heartbeat.ts')",
		}),
		delayMs: Type.Optional(Type.Number({
			description: "Delay before restart in ms (default: 2000). Allows current response to finish sending.",
		})),
	});

	return {
		name: "gateway_restart",
		label: "gateway_restart",
		description:
			"Restart the gateway process. Use this after making code changes, " +
			"adding/editing skills, or when you need to reload configuration. " +
			"The gateway will restart via systemctl and you will automatically " +
			"confirm back in the chat once online.\n\n" +
			"IMPORTANT: Call this LAST in your response — the process will " +
			"terminate shortly after. Any tool calls after this will be lost.",
		parameters: schema,
		execute: async (_toolCallId, params) => {
			const sessionKey = opts.getCurrentSessionKey();
			const discordTarget = opts.getDiscordTarget();
			const reason = params.reason || "Agent-requested restart";
			const delayMs = typeof params.delayMs === "number" ? params.delayMs : 2000;

			// Write sentinel so the new process knows to wake in this session
			opts.restartManager.write({
				reason,
				timestamp: Date.now(),
				sessionKey,
				discordTarget,
			});

			log.info(`Restart scheduled in ${delayMs}ms. Reason: ${reason}`);

			// Schedule restart after delay so the agent's response can be sent first
			setTimeout(() => {
				log.info("Executing systemctl restart...");
				try {
					spawnSync("systemctl", ["--user", "restart", "vaman-gateway.service"], {
						encoding: "utf-8",
						timeout: 5000,
					});
				} catch (err) {
					// If we get here, systemd likely killed us — that's expected
					log.error(`Restart spawn error (may be expected): ${err}`);
				}
			}, delayMs);

			return {
				content: [{
					type: "text",
					text: `Gateway restart scheduled in ${delayMs}ms. Reason: ${reason}. ` +
						`I will confirm back in this chat once I'm online again.`,
				}],
				details: undefined,
			};
		},
	};
}
