import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { HttpRouter } from "./http-router.js";
import { parseBody, sendJson, sendError } from "./http-router.js";

/**
 * AgentBridge — routes messages from any chat channel to a local agent process.
 *
 * Self-contained module with zero framework dependencies. Any agentic app can
 * instantiate it, register the REST endpoints on its router, and call
 * routeMessage() when a channel message should be forwarded to the local agent.
 *
 * Protocol:
 *   1. Host app calls bridge.routeMessage(content, sessionKey) → Promise<string>
 *   2. Message enters queue
 *   3. Bridge client (local machine) long-polls GET /api/bridge/messages
 *   4. Client spawns backend command (e.g. Claude Code), collects response
 *   5. Client POST /api/bridge/response { id, response }
 *   6. routeMessage() promise resolves with the response text
 */

export interface AgentBridgeOptions {
	timeoutMs?: number;
	statePath?: string;
	log?: (level: string, msg: string) => void;
}

interface QueuedMessage {
	id: string;
	content: string;
	sessionKey: string;
	timestamp: number;
}

interface PendingRequest {
	resolve: (response: string) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class AgentBridge {
	active = false;
	sessionId: string | null = null;
	bridgeConnected = false;
	bridgeLastSeen = 0;

	private queue: QueuedMessage[] = [];
	private requests = new Map<string, PendingRequest>();
	private pollResolve: ((msg: QueuedMessage | null) => void) | null = null;
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private timeoutMs: number;
	private statePath: string | null;
	private log: (level: string, msg: string) => void;

	constructor(opts?: AgentBridgeOptions) {
		this.timeoutMs = opts?.timeoutMs ?? 600_000;
		this.statePath = opts?.statePath ?? null;
		this.log = opts?.log ?? ((level, msg) => console.log(`[bridge:${level}] ${msg}`));
		this.restoreState();
	}

	/** Persist bridge state to disk */
	private saveState(): void {
		if (!this.statePath) return;
		try {
			mkdirSync(dirname(this.statePath), { recursive: true });
			writeFileSync(this.statePath, JSON.stringify({
				active: this.active,
				sessionId: this.sessionId,
			}), "utf-8");
		} catch (err) {
			this.log("error", `Failed to save bridge state: ${err}`);
		}
	}

	/** Restore bridge state from disk */
	private restoreState(): void {
		if (!this.statePath) return;
		try {
			const data = JSON.parse(readFileSync(this.statePath, "utf-8"));
			if (data.active) {
				this.active = true;
				this.sessionId = data.sessionId || randomUUID();
				this.log("info", `Bridge restored (session: ${this.sessionId})`);
			}
		} catch {
			// No state file or invalid — start fresh
		}
	}

	/** Activate bridge, assign session ID if needed */
	activate(): string {
		this.active = true;
		this.sessionId ??= randomUUID();
		this.log("info", `Bridge activated (session: ${this.sessionId})`);
		this.saveState();
		return this.sessionId;
	}

	/** Deactivate bridge, reject all pending requests */
	deactivate(): void {
		this.active = false;

		// Resolve all pending routeMessage promises
		for (const [id, req] of this.requests) {
			clearTimeout(req.timer);
			req.resolve("Bridge deactivated.");
			this.requests.delete(id);
		}

		// Cancel any pending long-poll
		if (this.pollResolve) {
			this.pollResolve(null);
			this.pollResolve = null;
		}
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}

		this.queue.length = 0;
		this.log("info", "Bridge deactivated");
		this.saveState();
	}

	/** Start a new session (new session ID) */
	newSession(): string {
		this.sessionId = randomUUID();
		this.log("info", `New session: ${this.sessionId}`);
		this.saveState();
		return this.sessionId;
	}

	/** Route a message to the bridge. Returns response when the bridge client delivers it. */
	routeMessage(content: string, sessionKey: string): Promise<string> {
		return new Promise((resolve) => {
			const id = randomUUID();

			const timer = setTimeout(() => {
				this.requests.delete(id);
				resolve("Bridge timed out. Is the bridge client running? Start it with `npx vaman coding`.");
			}, this.timeoutMs);

			this.requests.set(id, { resolve, timer });

			const msg: QueuedMessage = { id, content, sessionKey, timestamp: Date.now() };

			// If bridge client is already waiting, deliver immediately
			if (this.pollResolve) {
				this.pollResolve(msg);
				this.pollResolve = null;
				if (this.pollTimer) {
					clearTimeout(this.pollTimer);
					this.pollTimer = null;
				}
			} else {
				this.queue.push(msg);
			}

			this.log("debug", `Queued message ${id} (pending: ${this.requests.size})`);
		});
	}

	/** Long-poll: blocks up to 25s waiting for a message. Returns null on timeout. */
	waitForMessage(): Promise<QueuedMessage | null> {
		// If there's already a message in the queue, return it immediately
		if (this.queue.length > 0) {
			return Promise.resolve(this.queue.shift()!);
		}

		// If bridge is not active, return null
		if (!this.active) {
			return Promise.resolve(null);
		}

		// Block until a message arrives or 25s timeout
		return new Promise((resolve) => {
			this.pollTimer = setTimeout(() => {
				this.pollResolve = null;
				this.pollTimer = null;
				resolve(null);
			}, 25_000);

			this.pollResolve = (msg) => {
				if (this.pollTimer) {
					clearTimeout(this.pollTimer);
					this.pollTimer = null;
				}
				resolve(msg);
			};
		});
	}

	/** Bridge client submits a response for a pending message */
	submitResponse(id: string, response: string): boolean {
		const req = this.requests.get(id);
		if (!req) return false;

		clearTimeout(req.timer);
		req.resolve(response);
		this.requests.delete(id);
		this.log("debug", `Response received for ${id} (pending: ${this.requests.size})`);
		return true;
	}

	/** Bridge client heartbeat — marks it as connected */
	heartbeat(): void {
		this.bridgeConnected = true;
		this.bridgeLastSeen = Date.now();
	}

	/** Status snapshot */
	status() {
		return {
			active: this.active,
			sessionId: this.sessionId,
			bridgeConnected: this.bridgeConnected && (Date.now() - this.bridgeLastSeen < 60_000),
			pendingMessages: this.queue.length,
			pendingRequests: this.requests.size,
		};
	}

	/** Register REST endpoints on any compatible HttpRouter */
	registerRoutes(router: HttpRouter): void {
		// GET /api/bridge/status — current bridge state
		router.get("/api/bridge/status", async (_req, res) => {
			sendJson(res, this.status());
		});

		// GET /api/bridge/messages — long-poll for next message (bridge client calls this)
		router.get("/api/bridge/messages", async (_req, res) => {
			this.heartbeat();

			if (!this.active) {
				sendJson(res, { message: null, active: false });
				return;
			}

			const msg = await this.waitForMessage();
			sendJson(res, {
				message: msg,
				active: this.active,
				sessionId: this.sessionId,
			});
		});

		// POST /api/bridge/response — bridge client submits response
		router.post("/api/bridge/response", async (req, res) => {
			this.heartbeat();

			const body = await parseBody<{ id: string; response: string }>(req);
			if (!body.id || typeof body.response !== "string") {
				sendError(res, 400, "Missing id or response");
				return;
			}

			const ok = this.submitResponse(body.id, body.response);
			sendJson(res, { ok });
		});

		// POST /api/bridge/heartbeat — bridge client keepalive
		router.post("/api/bridge/heartbeat", async (_req, res) => {
			this.heartbeat();
			sendJson(res, { ok: true, status: this.status() });
		});

		// POST /api/bridge/activate — bridge client activates on connect
		router.post("/api/bridge/activate", async (_req, res) => {
			const sessionId = this.activate();
			this.heartbeat();
			sendJson(res, { ok: true, sessionId, status: this.status() });
		});

		// POST /api/bridge/deactivate — bridge client deactivates on disconnect
		router.post("/api/bridge/deactivate", async (_req, res) => {
			this.deactivate();
			sendJson(res, { ok: true, status: this.status() });
		});
	}
}
