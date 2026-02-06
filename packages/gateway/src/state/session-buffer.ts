import { createLogger } from "@vaman-ai/shared";

const log = createLogger("state:session-buffer");

export interface BufferedTurn {
	role: "user" | "assistant";
	content: string;
	timestamp: number;
	sessionKey: string;
}

export class SessionBufferManager {
	private buffers = new Map<string, BufferedTurn[]>();
	private maxTurns: number;

	constructor(maxTurns: number = 10) {
		this.maxTurns = maxTurns;
		log.info(`Session buffer initialized (max ${maxTurns} turns per session)`);
	}

	/** Append a turn. Returns evicted turns that should be archived. */
	append(sessionKey: string, turn: BufferedTurn): BufferedTurn[] {
		if (!this.buffers.has(sessionKey)) {
			this.buffers.set(sessionKey, []);
		}

		const buffer = this.buffers.get(sessionKey)!;
		buffer.push(turn);

		// Evict oldest turns beyond window
		const evicted: BufferedTurn[] = [];
		while (buffer.length > this.maxTurns) {
			evicted.push(buffer.shift()!);
		}

		if (evicted.length > 0) {
			log.debug(`Evicted ${evicted.length} turns from ${sessionKey} (buffer: ${buffer.length})`);
		}

		return evicted;
	}

	/** Get buffered turns for a session */
	getTurns(sessionKey: string): BufferedTurn[] {
		return this.buffers.get(sessionKey) ?? [];
	}

	/** Check if a session has any buffered turns */
	isEmpty(sessionKey: string): boolean {
		const buffer = this.buffers.get(sessionKey);
		return !buffer || buffer.length === 0;
	}

	/** Flush a specific session, returning all its turns */
	flush(sessionKey: string): BufferedTurn[] {
		const turns = this.buffers.get(sessionKey) ?? [];
		this.buffers.delete(sessionKey);
		if (turns.length > 0) {
			log.info(`Flushed ${turns.length} turns from ${sessionKey}`);
		}
		return turns;
	}

	/** Flush all sessions (for shutdown). Returns map of sessionKey -> turns */
	flushAll(): Map<string, BufferedTurn[]> {
		const all = new Map<string, BufferedTurn[]>();
		for (const [key, turns] of this.buffers) {
			if (turns.length > 0) {
				all.set(key, turns);
			}
		}
		this.buffers.clear();
		log.info(`Flushed all sessions (${all.size} sessions)`);
		return all;
	}

	/** Restore turns into buffer (for restart recovery) */
	restore(sessionKey: string, turns: BufferedTurn[]): void {
		this.buffers.set(sessionKey, turns.slice(-this.maxTurns));
		log.info(`Restored ${turns.length} turns for ${sessionKey}`);
	}
}
