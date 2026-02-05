import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import { createLogger, type VamanConfig, type GatewayMessage, type GatewayRequest, type GatewayResponse, type GatewayEvent } from "@vaman-ai/shared";
import { SessionManager } from "./session-manager.js";
import { RestartManager } from "./restart-sentinel.js";
import { ConfigWatcher } from "./config-watcher.js";

const log = createLogger("gateway");

export interface GatewayOptions {
	config: VamanConfig;
	dataDir: string;
}

export class GatewayServer {
	private wss: WebSocketServer | null = null;
	private clients = new Set<WebSocket>();
	private healthInterval: ReturnType<typeof setInterval> | null = null;

	readonly sessions: SessionManager;
	readonly restart: RestartManager;
	readonly configWatcher: ConfigWatcher;
	private config: VamanConfig;

	constructor(private options: GatewayOptions) {
		this.config = options.config;
		this.sessions = new SessionManager(options.dataDir);
		this.restart = new RestartManager(options.dataDir);
		this.configWatcher = new ConfigWatcher([".env", "data/heartbeat/HEARTBEAT.md"]);
	}

	/** Start the gateway server */
	async start(): Promise<void> {
		const { port, host } = this.config.gateway;

		// Check for restart sentinel
		const sentinel = this.restart.consume();
		if (sentinel) {
			log.info(`Resuming after restart: ${sentinel.reason}`);
			if (sentinel.activeSession && sentinel.pendingMessage) {
				log.info(`Pending message for session ${sentinel.activeSession}`);
			}
		}

		// Start WebSocket server
		this.wss = new WebSocketServer({ port, host });

		this.wss.on("connection", (ws) => {
			this.clients.add(ws);
			log.info(`Client connected (${this.clients.size} total)`);

			ws.on("message", (data) => {
				try {
					const msg: GatewayMessage = JSON.parse(data.toString());
					this.handleMessage(ws, msg);
				} catch (err) {
					log.error("Invalid message:", err);
					this.sendResponse(ws, { type: "res", id: "error", ok: false, error: "Invalid JSON" });
				}
			});

			ws.on("close", () => {
				this.clients.delete(ws);
				log.debug(`Client disconnected (${this.clients.size} remaining)`);
			});

			ws.on("error", (err) => {
				log.error("WebSocket error:", err);
				this.clients.delete(ws);
			});
		});

		// Start health tick
		this.healthInterval = setInterval(() => {
			this.broadcast({ type: "event", event: "health", payload: this.getHealth() });
		}, 30000);

		// Start config watcher
		this.configWatcher.start();
		this.configWatcher.onChange((path) => {
			log.info(`Config changed: ${path}, reloading...`);
		});

		log.info(`Gateway started on ws://${host}:${port}`);
	}

	/** Stop the gateway server */
	async stop(reason?: string): Promise<void> {
		if (reason) {
			this.restart.write({ reason, timestamp: Date.now() });
		}

		if (this.healthInterval) {
			clearInterval(this.healthInterval);
			this.healthInterval = null;
		}

		this.configWatcher.stop();

		for (const client of this.clients) {
			client.close(1000, "Server shutting down");
		}
		this.clients.clear();

		if (this.wss) {
			await new Promise<void>((resolve) => {
				this.wss!.close(() => resolve());
			});
			this.wss = null;
		}

		log.info("Gateway stopped");
	}

	/** Handle incoming WebSocket messages */
	private handleMessage(ws: WebSocket, msg: GatewayMessage): void {
		if (msg.type !== "req") return;

		const req = msg as GatewayRequest;
		log.debug(`Request: ${req.method} (${req.id})`);

		switch (req.method) {
			case "health":
				this.sendResponse(ws, { type: "res", id: req.id, ok: true, payload: this.getHealth() });
				break;

			case "sessions.list":
				this.sendResponse(ws, {
					type: "res",
					id: req.id,
					ok: true,
					payload: this.sessions.list(),
				});
				break;

			case "sessions.read": {
				const key = req.params?.key as string;
				if (!key) {
					this.sendResponse(ws, { type: "res", id: req.id, ok: false, error: "Missing key param" });
					break;
				}
				this.sendResponse(ws, {
					type: "res",
					id: req.id,
					ok: true,
					payload: this.sessions.read(key),
				});
				break;
			}

			case "restart":
				this.sendResponse(ws, { type: "res", id: req.id, ok: true, payload: "Restarting..." });
				this.stop("Restart requested via API").then(() => {
					process.kill(process.pid, "SIGUSR1");
				});
				break;

			default:
				this.sendResponse(ws, {
					type: "res",
					id: req.id,
					ok: false,
					error: `Unknown method: ${req.method}`,
				});
		}
	}

	/** Send a response to a specific client */
	private sendResponse(ws: WebSocket, response: GatewayResponse): void {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(response));
		}
	}

	/** Broadcast an event to all connected clients */
	broadcast(event: GatewayEvent): void {
		const data = JSON.stringify(event);
		for (const client of this.clients) {
			if (client.readyState === WebSocket.OPEN) {
				client.send(data);
			}
		}
	}

	/** Get health status */
	getHealth() {
		return {
			status: "ok",
			uptime: process.uptime(),
			clients: this.clients.size,
			sessions: this.sessions.list().length,
			timestamp: Date.now(),
		};
	}

	/** Get current config */
	getConfig(): VamanConfig {
		return this.config;
	}

	/** Update config at runtime */
	updateConfig(partial: Partial<VamanConfig>): void {
		this.config = { ...this.config, ...partial };
		this.broadcast({ type: "event", event: "config_updated", payload: partial });
	}
}
