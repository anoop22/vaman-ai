import type { IncomingMessage, ServerResponse } from "node:http";
import { createLogger } from "@vaman-ai/shared";

const log = createLogger("http-router");

export type RouteHandler = (
	req: IncomingMessage,
	res: ServerResponse,
	params: Record<string, string>,
	query: URLSearchParams,
) => Promise<void>;

interface Route {
	method: string;
	pattern: RegExp;
	paramNames: string[];
	handler: RouteHandler;
}

/** Zero-dependency HTTP router with path params and JSON helpers */
export class HttpRouter {
	private routes: Route[] = [];

	get(path: string, handler: RouteHandler): void {
		this.addRoute("GET", path, handler);
	}

	post(path: string, handler: RouteHandler): void {
		this.addRoute("POST", path, handler);
	}

	put(path: string, handler: RouteHandler): void {
		this.addRoute("PUT", path, handler);
	}

	patch(path: string, handler: RouteHandler): void {
		this.addRoute("PATCH", path, handler);
	}

	delete(path: string, handler: RouteHandler): void {
		this.addRoute("DELETE", path, handler);
	}

	private addRoute(method: string, path: string, handler: RouteHandler): void {
		const paramNames: string[] = [];
		const patternStr = path.replace(/:(\w+)/g, (_, name) => {
			paramNames.push(name);
			return "([^/]+)";
		});
		const pattern = new RegExp(`^${patternStr}$`);
		this.routes.push({ method, pattern, paramNames, handler });
	}

	/** Try to handle a request. Returns true if a route matched. */
	async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
		const url = new URL(req.url!, `http://${req.headers.host || "localhost"}`);
		const method = req.method?.toUpperCase() || "GET";
		const pathname = url.pathname;

		for (const route of this.routes) {
			if (route.method !== method) continue;
			const match = pathname.match(route.pattern);
			if (!match) continue;

			const params: Record<string, string> = {};
			route.paramNames.forEach((name, i) => {
				params[name] = decodeURIComponent(match[i + 1]);
			});

			try {
				await route.handler(req, res, params, url.searchParams);
			} catch (err) {
				log.error(`Route error ${method} ${pathname}: ${err}`);
				sendError(res, 500, err instanceof Error ? err.message : "Internal server error");
			}
			return true;
		}

		return false;
	}
}

/** Parse JSON request body (with size limit to prevent DoS) */
export async function parseBody<T = any>(req: IncomingMessage, maxBytes = 1_048_576): Promise<T> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let totalBytes = 0;
		req.on("data", (chunk: Buffer) => {
			totalBytes += chunk.length;
			if (totalBytes > maxBytes) {
				req.destroy();
				reject(new Error(`Request body too large (max ${maxBytes} bytes)`));
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString()));
			} catch {
				reject(new Error("Invalid JSON body"));
			}
		});
		req.on("error", reject);
	});
}

/** Send JSON response */
export function sendJson(res: ServerResponse, data: unknown, status = 200): void {
	const body = JSON.stringify(data);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(body),
	});
	res.end(body);
}

/** Send error response */
export function sendError(res: ServerResponse, status: number, message: string): void {
	sendJson(res, { error: message }, status);
}
