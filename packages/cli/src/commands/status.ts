import WebSocket from "ws";
import { loadConfig, createLogger } from "@vaman-ai/shared";
import type { GatewayResponse } from "@vaman-ai/shared";

const log = createLogger("cli");

export async function statusCommand() {
	const config = loadConfig();
	const { port, host } = config.gateway;
	const url = `ws://${host}:${port}`;

	try {
		const ws = await new Promise<WebSocket>((resolve, reject) => {
			const ws = new WebSocket(url);
			const timeout = setTimeout(() => {
				ws.close();
				reject(new Error("Connection timeout"));
			}, 3000);
			ws.on("open", () => {
				clearTimeout(timeout);
				resolve(ws);
			});
			ws.on("error", (err) => {
				clearTimeout(timeout);
				reject(err);
			});
		});

		const res = await new Promise<GatewayResponse>((resolve) => {
			ws.on("message", (data) => {
				resolve(JSON.parse(data.toString()));
			});
			ws.send(JSON.stringify({ type: "req", id: "status", method: "health" }));
		});

		ws.close();

		if (res.ok) {
			const health = res.payload as any;
			console.log(`Gateway: RUNNING`);
			console.log(`  Address:  ws://${host}:${port}`);
			console.log(`  Uptime:   ${Math.round(health.uptime)}s`);
			console.log(`  Clients:  ${health.clients}`);
			console.log(`  Sessions: ${health.sessions}`);
		} else {
			console.log(`Gateway: ERROR - ${res.error}`);
		}
	} catch {
		console.log(`Gateway: NOT RUNNING (ws://${host}:${port})`);
	}
}
