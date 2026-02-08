import { loadConfig, createLogger } from "@vaman-ai/shared";
import { execSync, spawn } from "child_process";
import { readdirSync, statSync } from "fs";
import { resolve, sep } from "path";
import { homedir } from "os";

const log = createLogger("bridge-client");
const DEBUG = true;

/** Find the most recent Claude Code session ID for the current working directory */
function findLatestClaudeSession(cwd?: string): string | null {
	const dir = cwd || process.cwd();
	// Claude Code stores sessions at ~/.claude/projects/<path-with-dashes>/
	const projectKey = dir.split(sep).join("-");
	const sessionsDir = resolve(homedir(), ".claude", "projects", projectKey);

	try {
		const files = readdirSync(sessionsDir)
			.filter((f) => f.endsWith(".jsonl"))
			.map((f) => ({
				name: f,
				mtime: statSync(resolve(sessionsDir, f)).mtimeMs,
			}))
			.sort((a, b) => b.mtime - a.mtime);

		if (files.length > 0) {
			return files[0].name.replace(".jsonl", "");
		}
	} catch {}
	return null;
}

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
	const backendCommand = config.codingBridge.command;

	console.log("\x1b[1mVaman Coding Bridge\x1b[0m");
	console.log();

	// 1. Check gateway is reachable
	try {
		await fetch(`${baseUrl}/api/bridge/status`, { signal: AbortSignal.timeout(5000) });
	} catch {
		console.error(`\x1b[31mCannot reach gateway at ${baseUrl}\x1b[0m`);
		console.error("Make sure the gateway is running and accessible via SSH tunnel.");
		process.exit(1);
	}

	// Resolve Claude Code session ID: --session flag, env var, or auto-detect
	const claudeSessionId = opts.session
		|| process.env.CODING_BRIDGE_SESSION
		|| findLatestClaudeSession();

	if (!claudeSessionId) {
		console.error("\x1b[31mNo Claude Code session found.\x1b[0m");
		console.error("Specify one: npx vaman coding --session <uuid>");
		process.exit(1);
	}

	console.log(`  Backend:  ${backendCommand.split(" ")[0]}`);
	console.log(`  Session:  \x1b[36m${claudeSessionId}\x1b[0m`);
	console.log(`  Gateway:  ${baseUrl}`);
	console.log();

	// Wait for bridge to be activated via /coding on
	let sessionId: string | null = null;
	while (!sessionId) {
		try {
			const res = await fetch(`${baseUrl}/api/bridge/status`, { signal: AbortSignal.timeout(5000) });
			const status = await res.json() as BridgeStatus;
			if (status.active) {
				sessionId = status.sessionId;
				break;
			}
		} catch {}
		if (!sessionId) {
			console.log("Waiting for /coding on in Discord...");
			await new Promise((r) => setTimeout(r, 5000));
		}
	}

	console.log(`  Session:  \x1b[36m${sessionId}\x1b[0m`);
	console.log();
	console.log("Bridge active! Waiting for messages... (Ctrl+C to stop)");
	console.log();

	// 2. Message loop: poll for messages, spawn backend, send response
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
			const pollData = await pollRes.json() as {
				message: BridgeMessage | null;
				active: boolean;
				sessionId: string;
			};

			// Reset retry delay on successful poll
			retryDelay = 1000;

			if (!pollData.active) {
				console.log("\x1b[33mBridge deactivated (/coding off). Waiting for /coding on...\x1b[0m");
				// Go back to waiting for activation
				while (true) {
					await new Promise((r) => setTimeout(r, 5000));
					try {
						const res = await fetch(`${baseUrl}/api/bridge/status`, { signal: AbortSignal.timeout(5000) });
						const st = await res.json() as BridgeStatus;
						if (st.active) {
							console.log(`\x1b[32mBridge re-activated! Session: ${st.sessionId}\x1b[0m`);
							break;
						}
					} catch {}
				}
				continue;
			}

			if (!pollData.message) {
				// Timeout, re-poll
				continue;
			}

			const msg = pollData.message;
			const preview = msg.content.length > 80 ? msg.content.slice(0, 80) + "..." : msg.content;
			console.log(`\x1b[36m[${new Date().toLocaleTimeString()}]\x1b[0m Message: ${preview}`);

			// Spawn backend command
			const startTime = Date.now();
			let response: string;
			try {
				response = await runBackend(backendCommand, claudeSessionId, msg.content);
			} catch (err) {
				response = `Bridge client error: ${err instanceof Error ? err.message : err}`;
				console.error(`\x1b[31m  Backend error: ${response}\x1b[0m`);
			}

			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
			const responsePreview = response.length > 80 ? response.slice(0, 80) + "..." : response;
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
			console.error(`\x1b[33mConnection lost, retrying in ${retryDelay / 1000}s...\x1b[0m`);
			await new Promise((r) => setTimeout(r, retryDelay));
			retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
		}
	}
}

/**
 * Spawn the backend command with {session} and {message} placeholders replaced.
 * For Claude Code (--output-format json): parses JSON output and extracts .result.
 * For other backends: returns raw stdout.
 */
async function runBackend(template: string, sessionId: string, message: string): Promise<string> {
	// Replace placeholders — {message} needs shell quoting
	const escapedMessage = message.replace(/'/g, "'\\''");
	const cmd = template
		.replace(/\{session\}/g, sessionId)
		.replace(/\{message\}/g, `'${escapedMessage}'`);

	if (DEBUG) log.debug(`Spawning: ${cmd.slice(0, 200)}`);

	return new Promise((resolve, reject) => {
		const proc = spawn("sh", ["-c", cmd], {
			stdio: ["ignore", "pipe", "pipe"],
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

			// Try to parse as Claude Code JSON output
			if (template.includes("--output-format json")) {
				try {
					const parsed = JSON.parse(stdout);
					if (parsed.result) {
						resolve(parsed.result);
						return;
					}
					// Some Claude JSON outputs have a different structure
					if (parsed.content) {
						resolve(typeof parsed.content === "string" ? parsed.content : JSON.stringify(parsed.content));
						return;
					}
				} catch {
					// Not valid JSON, fall through to raw output
				}
			}

			resolve(stdout || "(no output)");
		});

		proc.on("error", (err) => {
			reject(new Error(`Failed to spawn backend: ${err.message}`));
		});
	});
}
