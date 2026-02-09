import { loadConfig, createLogger } from "@vaman-ai/shared";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

const log = createLogger("bridge-client");
const DEBUG = true;

interface BridgeMessage {
	id: string;
	content: string;
	sessionKey: string;
	timestamp: number;
}

interface BridgeStatus {
	active: boolean;
	sessionId: string | null;
	bridgeConnected: boolean;
	pendingMessages: number;
	pendingRequests: number;
}

export async function codingCommand(opts: { session?: string; newSession?: boolean }) {
	const config = loadConfig();
	const { port, host } = config.gateway;
	const baseUrl = `http://${host}:${port}`;
	const bridgeConfig = config.codingBridge;

	// Determine mode: --session flag forces "continue", --new-session forces "new"
	let mode: "new" | "continue" = bridgeConfig.mode;
	let sessionId: string | null = null;

	if (opts.session) {
		mode = "continue";
		sessionId = opts.session;
	} else if (opts.newSession) {
		mode = "new";
	} else if (mode === "continue") {
		sessionId = bridgeConfig.session || null;
	}

	if (mode === "continue" && !sessionId) {
		console.error("\x1b[31mContinue mode requires a session ID.\x1b[0m");
		console.error("Set CODING_BRIDGE_SESSION in .env or use --session <uuid>");
		process.exit(1);
	}

	// For "new" mode, generate a UUID for the new session
	if (mode === "new") {
		sessionId = randomUUID();
	}

	const cwd = bridgeConfig.dir;

	console.log("\x1b[1mVaman Coding Bridge\x1b[0m");
	console.log();
	console.log(`  Mode:     \x1b[33m${mode}\x1b[0m`);
	console.log(`  Session:  \x1b[36m${sessionId}\x1b[0m`);
	console.log(`  Dir:      ${cwd}`);
	console.log(`  Gateway:  ${baseUrl}`);
	console.log();

	// 1. Check gateway is reachable
	try {
		await fetch(`${baseUrl}/api/bridge/status`, { signal: AbortSignal.timeout(5000) });
	} catch {
		console.error(`\x1b[31mCannot reach gateway at ${baseUrl}\x1b[0m`);
		console.error("Make sure the gateway is running and accessible via SSH tunnel.");
		process.exit(1);
	}

	// Wait for bridge to be activated via /coding on
	let bridgeSessionId: string | null = null;
	while (!bridgeSessionId) {
		try {
			const res = await fetch(`${baseUrl}/api/bridge/status`, {
				signal: AbortSignal.timeout(5000),
			});
			const status = (await res.json()) as BridgeStatus;
			if (status.active) {
				bridgeSessionId = status.sessionId;
				break;
			}
		} catch {}
		if (!bridgeSessionId) {
			console.log("Waiting for /coding on in Discord...");
			await new Promise((r) => setTimeout(r, 5000));
		}
	}

	console.log("Bridge active! Waiting for messages... (Ctrl+C to stop)");
	console.log();

	// 2. Message loop
	let isFirstMessage = true;
	let retryDelay = 1000;
	const maxRetryDelay = 30000;

	while (true) {
		try {
			// Heartbeat
			await fetch(`${baseUrl}/api/bridge/heartbeat`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{}",
				signal: AbortSignal.timeout(5000),
			}).catch(() => {});

			// Long-poll for next message (server blocks up to 25s)
			const pollRes = await fetch(`${baseUrl}/api/bridge/messages`, {
				signal: AbortSignal.timeout(30000),
			});
			const pollData = (await pollRes.json()) as {
				message: BridgeMessage | null;
				active: boolean;
				sessionId: string;
			};

			retryDelay = 1000;

			if (!pollData.active) {
				console.log(
					"\x1b[33mBridge deactivated (/coding off). Waiting for /coding on...\x1b[0m",
				);
				while (true) {
					await new Promise((r) => setTimeout(r, 5000));
					try {
						const res = await fetch(`${baseUrl}/api/bridge/status`, {
							signal: AbortSignal.timeout(5000),
						});
						const st = (await res.json()) as BridgeStatus;
						if (st.active) {
							console.log(
								`\x1b[32mBridge re-activated! Session: ${st.sessionId}\x1b[0m`,
							);
							break;
						}
					} catch {}
				}
				continue;
			}

			if (!pollData.message) continue;

			const msg = pollData.message;
			const preview = msg.content.length > 80 ? msg.content.slice(0, 80) + "..." : msg.content;
			console.log(`\x1b[36m[${new Date().toLocaleTimeString()}]\x1b[0m Message: ${preview}`);

			// Build the command with proper session flags
			const cmd = buildCommand(bridgeConfig.command, sessionId!, mode, isFirstMessage);
			const startTime = Date.now();
			let response: string;

			try {
				response = await runBackend(cmd, msg.content, cwd);
				// After first successful message in "new" mode, switch to resume
				if (isFirstMessage) {
					isFirstMessage = false;
					console.log(`\x1b[32m  Session created: ${sessionId}\x1b[0m`);
				}
			} catch (err) {
				response = `Bridge client error: ${err instanceof Error ? err.message : err}`;
				console.error(`\x1b[31m  Backend error: ${response}\x1b[0m`);
			}

			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			const responsePreview =
				response.length > 80 ? response.slice(0, 80) + "..." : response;
			console.log(`\x1b[32m  Response (${elapsed}s): ${responsePreview}\x1b[0m`);

			// Submit response
			await fetch(`${baseUrl}/api/bridge/response`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: msg.id, response }),
				signal: AbortSignal.timeout(5000),
			});
		} catch (err) {
			if (DEBUG) log.debug(`Poll error: ${err}`);
			console.error(
				`\x1b[33mConnection lost, retrying in ${retryDelay / 1000}s...\x1b[0m`,
			);
			await new Promise((r) => setTimeout(r, retryDelay));
			retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
		}
	}
}

/**
 * Build the full command with session flags injected.
 *
 * Mode "new":
 *   - First message:  claude -p --session-id <uuid> ... {message}
 *   - Subsequent:     claude -p --resume <uuid> ... {message}
 *
 * Mode "continue":
 *   - All messages:   claude -p --resume <uuid> ... {message}
 */
function buildCommand(
	template: string,
	sessionId: string,
	mode: "new" | "continue",
	isFirstMessage: boolean,
): string {
	let sessionFlag: string;

	if (mode === "new" && isFirstMessage) {
		sessionFlag = `--session-id ${sessionId}`;
	} else {
		sessionFlag = `--resume ${sessionId}`;
	}

	// Insert session flag after "claude -p"
	return template.replace("claude -p", `claude -p ${sessionFlag}`);
}

/**
 * Spawn the backend command with {message} replaced.
 * Parses Claude Code JSON output to extract .result or .content.
 */
async function runBackend(template: string, message: string, cwd: string): Promise<string> {
	const escapedMessage = message.replace(/'/g, "'\\''");
	const cmd = template.replace(/\{message\}/g, `'${escapedMessage}'`);

	if (DEBUG) log.debug(`Spawning: ${cmd.slice(0, 200)}`);
	if (DEBUG) log.debug(`CWD: ${cwd}`);

	return new Promise((resolve, reject) => {
		const proc = spawn("sh", ["-c", cmd], {
			stdio: ["ignore", "pipe", "pipe"],
			cwd,
			env: { ...process.env },
		});

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
		proc.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
			if (DEBUG) process.stderr.write(chunk);
		});

		proc.on("close", (code) => {
			const stdout = Buffer.concat(stdoutChunks).toString().trim();
			const stderr = Buffer.concat(stderrChunks).toString().trim();

			if (code !== 0) {
				reject(new Error(`Backend exited with code ${code}: ${stderr || stdout}`));
				return;
			}

			// Parse Claude Code JSON output
			if (template.includes("--output-format json")) {
				try {
					const parsed = JSON.parse(stdout);
					if (parsed.result) {
						resolve(parsed.result);
						return;
					}
					if (parsed.content) {
						resolve(
							typeof parsed.content === "string"
								? parsed.content
								: JSON.stringify(parsed.content),
						);
						return;
					}
				} catch {
					// Not valid JSON, fall through
				}
			}

			resolve(stdout || "(no output)");
		});

		proc.on("error", (err) => {
			reject(new Error(`Failed to spawn backend: ${err.message}`));
		});
	});
}
