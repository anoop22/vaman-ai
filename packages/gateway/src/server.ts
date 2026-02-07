import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import { createLogger, type VamanConfig, type GatewayMessage, type GatewayRequest, type GatewayResponse, type GatewayEvent } from "@vaman-ai/shared";
import { SessionManager } from "./session-manager.js";
import { RestartManager } from "./restart-sentinel.js";
import { ConfigWatcher } from "./config-watcher.js";
import { HttpRouter } from "./http-router.js";

const log = createLogger("gateway");

const MIME_TYPES: Record<string, string> = {
	".html": "text/html",
	".css": "text/css",
	".js": "application/javascript",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

export interface GatewayOptions {
	config: VamanConfig;
	dataDir: string;
	watchPaths?: string[];
	publicDir?: string;
}

export class GatewayServer {
	private httpServer: HttpServer | null = null;
	private wss: WebSocketServer | null = null;
	private clients = new Set<WebSocket>();
	private healthInterval: ReturnType<typeof setInterval> | null = null;
	private publicDir: string;

	readonly router: HttpRouter;
	readonly sessions: SessionManager;
	readonly restart: RestartManager;
	readonly configWatcher: ConfigWatcher;
	private config: VamanConfig;

	constructor(private options: GatewayOptions) {
		this.config = options.config;
		this.sessions = new SessionManager(options.dataDir);
		this.restart = new RestartManager(options.dataDir);
		this.configWatcher = new ConfigWatcher(options.watchPaths ?? [".env", "data/heartbeat/HEARTBEAT.md"]);
		this.router = new HttpRouter();
		this.publicDir = options.publicDir ?? resolve(process.cwd(), "packages/gateway/public");
	}

	/** Start the gateway server (HTTP + WebSocket on same port) */
	async start(): Promise<void> {
		const { port, host } = this.config.gateway;

		// Create HTTP server that handles REST API + static files
		this.httpServer = createServer((req, res) => {
			this.handleHttp(req, res);
		});

		// Attach WebSocket server to the HTTP server
		this.wss = new WebSocketServer({ server: this.httpServer });

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

		// Listen on HTTP server (serves both HTTP and WS)
		await new Promise<void>((resolve) => {
			this.httpServer!.listen(port, host, () => resolve());
		});

		log.info(`Gateway started on ws://${host}:${port}`);
	}

	/** Stop the gateway server */
	async stop(): Promise<void> {
		if (this.healthInterval) {
			clearInterval(this.healthInterval);
			this.healthInterval = null;
		}

		await this.configWatcher.stop();

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

		if (this.httpServer) {
			await new Promise<void>((resolve) => {
				this.httpServer!.close(() => resolve());
			});
			this.httpServer = null;
		}

		log.info("Gateway stopped");
	}

	/** Handle HTTP requests: /api/* -> router, else -> static files */
	private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url!, `http://${req.headers.host || "localhost"}`);

		// API routes
		if (url.pathname.startsWith("/api/")) {
			const handled = await this.router.handle(req, res);
			if (!handled) {
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Not found" }));
			}
			return;
		}

		// Static file serving from public/
		this.serveStatic(url.pathname, res);
	}

	/** Serve static files with SPA fallback */
	private serveStatic(pathname: string, res: ServerResponse): void {
		// Reject path traversal attempts before resolving
		const decoded = decodeURIComponent(pathname);
		if (decoded.includes("..") || decoded.includes("\0")) {
			res.writeHead(403, { "Content-Type": "text/plain" });
			res.end("Forbidden");
			return;
		}

		const requestedPath = decoded === "/" ? "index.html" : decoded.slice(1);
		const filePath = resolve(this.publicDir, requestedPath);

		// Normalized path must still be under publicDir
		if (!filePath.startsWith(this.publicDir + "/") && filePath !== this.publicDir) {
			res.writeHead(403, { "Content-Type": "text/plain" });
			res.end("Forbidden");
			return;
		}

		// Serve file if it exists
		if (existsSync(filePath) && statSync(filePath).isFile()) {
			const ext = extname(filePath);
			const contentType = MIME_TYPES[ext] || "application/octet-stream";
			const content = readFileSync(filePath);
			res.writeHead(200, {
				"Content-Type": contentType,
				"Content-Length": content.length,
			});
			res.end(content);
			return;
		}

		// SPA fallback: serve index.html for any unmatched path
		const indexPath = resolve(this.publicDir, "index.html");
		if (existsSync(indexPath)) {
			const content = readFileSync(indexPath);
			res.writeHead(200, { "Content-Type": "text/html", "Content-Length": content.length });
			res.end(content);
		} else {
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Dashboard not found. Place files in packages/gateway/public/");
		}
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

			case "restart": {
				const result = this.restart.triggerRestart({
					reason: "Restart requested via WS API",
					timestamp: Date.now(),
				});
				this.sendResponse(ws, {
					type: "res",
					id: req.id,
					ok: result.ok,
					payload: result.ok ? "Restarting via systemctl..." : `Restart failed: ${result.detail}`,
				});
				break;
			}

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
