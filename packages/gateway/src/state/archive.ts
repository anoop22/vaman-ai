import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { createLogger } from "@vaman-ai/shared";
import type { BufferedTurn } from "./session-buffer.js";

const log = createLogger("state:archive");

export interface ArchivedTurn {
	id: number;
	sessionKey: string;
	role: string;
	content: string;
	timestamp: number;
	tags: string | null;
}

export interface ArchivedWorldModelItem {
	id: number;
	section: string;
	field: string;
	value: string;
	archivedAt: number;
	reason: string;
}

export class ArchiveManager {
	private db: Database.Database | null = null;
	private dbPath: string;

	constructor(dbPath: string) {
		this.dbPath = dbPath;
	}

	/** Create tables and FTS5 index if needed */
	init(): void {
		mkdirSync(dirname(this.dbPath), { recursive: true });
		this.db = new Database(this.dbPath);
		this.db.pragma("journal_mode = WAL");

		this.db.exec(`
			CREATE TABLE IF NOT EXISTS turns (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				session_key TEXT NOT NULL,
				role TEXT NOT NULL,
				content TEXT NOT NULL,
				timestamp INTEGER NOT NULL,
				tags TEXT
			);

			CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_key, timestamp DESC);
			CREATE INDEX IF NOT EXISTS idx_turns_timestamp ON turns(timestamp DESC);

			CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
				content,
				tags,
				content='turns',
				content_rowid='id'
			);

			-- Triggers to keep FTS in sync
			CREATE TRIGGER IF NOT EXISTS turns_ai AFTER INSERT ON turns BEGIN
				INSERT INTO turns_fts(rowid, content, tags) VALUES (new.id, new.content, new.tags);
			END;

			CREATE TRIGGER IF NOT EXISTS turns_ad AFTER DELETE ON turns BEGIN
				INSERT INTO turns_fts(turns_fts, rowid, content, tags) VALUES ('delete', old.id, old.content, old.tags);
			END;

			CREATE TABLE IF NOT EXISTS world_model_archive (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				section TEXT NOT NULL,
				field TEXT NOT NULL,
				value TEXT NOT NULL,
				archived_at INTEGER NOT NULL,
				reason TEXT
			);
		`);

		log.info(`Archive initialized at ${this.dbPath}`);
	}

	/** Batch insert turns into archive */
	archiveTurns(turns: BufferedTurn[]): void {
		if (!this.db || turns.length === 0) return;

		const stmt = this.db.prepare(
			"INSERT INTO turns (session_key, role, content, timestamp, tags) VALUES (?, ?, ?, ?, ?)",
		);

		const insertMany = this.db.transaction((items: BufferedTurn[]) => {
			for (const t of items) {
				stmt.run(t.sessionKey, t.role, t.content, t.timestamp, null);
			}
		});

		insertMany(turns);
		log.info(`Archived ${turns.length} turns`);
	}

	/** Update tags on recently archived turns */
	updateTags(turnIds: number[], tags: string[]): void {
		if (!this.db || turnIds.length === 0) return;
		const tagStr = tags.join(",");
		const stmt = this.db.prepare("UPDATE turns SET tags = ? WHERE id = ?");
		for (const id of turnIds) {
			stmt.run(tagStr, id);
		}
	}

	/** Archive a world model item that was removed */
	archiveWorldModelItem(section: string, field: string, value: string, reason: string): void {
		if (!this.db) return;
		this.db.prepare(
			"INSERT INTO world_model_archive (section, field, value, archived_at, reason) VALUES (?, ?, ?, ?, ?)",
		).run(section, field, value, Date.now(), reason);
	}

	/** Grep search: LIKE-based exact match */
	searchGrep(query: string, limit: number = 10): ArchivedTurn[] {
		if (!this.db) return [];
		return this.db.prepare(
			"SELECT id, session_key as sessionKey, role, content, timestamp, tags FROM turns WHERE content LIKE ? ORDER BY timestamp DESC LIMIT ?",
		).all(`%${query}%`, limit) as ArchivedTurn[];
	}

	/** BM25 search: FTS5 MATCH query */
	searchBM25(query: string, limit: number = 10): ArchivedTurn[] {
		if (!this.db) return [];
		try {
			return this.db.prepare(
				`SELECT t.id, t.session_key as sessionKey, t.role, t.content, t.timestamp, t.tags
				 FROM turns_fts fts
				 JOIN turns t ON t.id = fts.rowid
				 WHERE turns_fts MATCH ?
				 ORDER BY rank
				 LIMIT ?`,
			).all(query, limit) as ArchivedTurn[];
		} catch (err) {
			log.debug(`BM25 search failed for "${query}": ${err}`);
			return [];
		}
	}

	/** Get recent turns for a session (for restart recovery) */
	getRecentTurns(sessionKey: string, limit: number = 10): ArchivedTurn[] {
		if (!this.db) return [];
		return this.db.prepare(
			"SELECT id, session_key as sessionKey, role, content, timestamp, tags FROM turns WHERE session_key = ? ORDER BY timestamp DESC LIMIT ?",
		).all(sessionKey, limit) as ArchivedTurn[];
	}

	/** Read a single archived turn by ID */
	read(id: number): ArchivedTurn | null {
		if (!this.db) return null;
		return (this.db.prepare(
			"SELECT id, session_key as sessionKey, role, content, timestamp, tags FROM turns WHERE id = ?",
		).get(id) as ArchivedTurn) ?? null;
	}

	/** Close the database connection */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
			log.info("Archive closed");
		}
	}
}
