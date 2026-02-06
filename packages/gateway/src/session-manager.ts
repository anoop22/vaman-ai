import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "fs";
import { join, resolve } from "path";
import { createLogger } from "@vaman-ai/shared";
import type { SessionKey } from "@vaman-ai/shared";

const log = createLogger("sessions");

export interface SessionEntry {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
}

export interface SessionInfo {
	key: string;
	parsed: SessionKey;
	messageCount: number;
	lastActivity: number;
	filePath: string;
}

export class SessionManager {
	private sessionsDir: string;

	constructor(dataDir: string) {
		this.sessionsDir = resolve(dataDir, "sessions");
		if (!existsSync(this.sessionsDir)) {
			mkdirSync(this.sessionsDir, { recursive: true });
		}
	}

	/** Build a hierarchical session key string */
	static buildKey(key: SessionKey): string {
		return `${key.agent}:${key.channel}:${key.target}`;
	}

	/** Parse a session key string back to components */
	static parseKey(keyStr: string): SessionKey {
		const parts = keyStr.split(":");
		if (parts.length < 3) {
			throw new Error(`Invalid session key: ${keyStr}`);
		}
		return {
			agent: parts[0],
			channel: parts[1],
			target: parts.slice(2).join(":"),
		};
	}

	/** Get file path for a session key (hex-encoded for reversibility) */
	private filePath(key: string): string {
		const hexKey = Buffer.from(key, "utf-8").toString("hex");
		return join(this.sessionsDir, `${hexKey}.jsonl`);
	}

	/** Decode a hex filename back to the original session key */
	private static decodeFilename(filename: string): string | null {
		const hex = filename.replace(".jsonl", "");
		try {
			return Buffer.from(hex, "hex").toString("utf-8");
		} catch {
			return null;
		}
	}

	/** Legacy file path (for migration from old _ sanitized names) */
	private legacyFilePath(key: string): string {
		const safeKey = key.replace(/[^a-zA-Z0-9:_-]/g, "_");
		return join(this.sessionsDir, `${safeKey}.jsonl`);
	}

	/** Resolve the actual file path, migrating legacy files if needed */
	private resolveFilePath(key: string): string {
		const newPath = this.filePath(key);
		if (existsSync(newPath)) return newPath;
		// Check for legacy file and migrate
		const legacyPath = this.legacyFilePath(key);
		if (existsSync(legacyPath)) {
			renameSync(legacyPath, newPath);
			log.info(`Migrated session file: ${key}`);
		}
		return newPath;
	}

	/** Append a message to a session */
	append(key: string, entry: SessionEntry): void {
		const path = this.resolveFilePath(key);
		const line = JSON.stringify(entry) + "\n";
		appendFileSync(path, line, "utf-8");
		log.debug(`Appended to session ${key}`);
	}

	/** Read all messages from a session */
	read(key: string): SessionEntry[] {
		const path = this.resolveFilePath(key);
		if (!existsSync(path)) {
			return [];
		}
		const content = readFileSync(path, "utf-8").trim();
		if (!content) return [];
		return content.split("\n").map((line) => JSON.parse(line));
	}

	/** List all sessions */
	list(): SessionInfo[] {
		if (!existsSync(this.sessionsDir)) return [];
		const files = readdirSync(this.sessionsDir).filter((f) => f.endsWith(".jsonl"));
		return files
			.map((file) => {
				const key = SessionManager.decodeFilename(file);
				if (!key) return null;
				const filePath = join(this.sessionsDir, file);
				const entries = this.read(key);
				const lastEntry = entries[entries.length - 1];
				let parsed: SessionKey;
				try {
					parsed = SessionManager.parseKey(key);
				} catch {
					parsed = { agent: "unknown", channel: "unknown", target: key };
				}
				return {
					key,
					parsed,
					messageCount: entries.length,
					lastActivity: lastEntry?.timestamp || 0,
					filePath,
				};
			})
			.filter((info): info is SessionInfo => info !== null);
	}

	/** Check if a session exists */
	exists(key: string): boolean {
		const path = this.resolveFilePath(key);
		return existsSync(path);
	}

	/** Clear a session */
	clear(key: string): void {
		const path = this.resolveFilePath(key);
		if (existsSync(path)) {
			writeFileSync(path, "", "utf-8");
		}
	}
}
