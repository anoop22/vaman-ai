const DEBUG = process.env.VAMAN_DEBUG === "true";

export function createLogger(prefix: string) {
	return {
		info: (msg: string, ...args: unknown[]) => {
			console.log(`[${prefix}] ${msg}`, ...args);
		},
		error: (msg: string, ...args: unknown[]) => {
			console.error(`[${prefix}] ERROR: ${msg}`, ...args);
		},
		debug: (msg: string, ...args: unknown[]) => {
			if (DEBUG) {
				console.log(`[${prefix}] DEBUG: ${msg}`, ...args);
			}
		},
		warn: (msg: string, ...args: unknown[]) => {
			console.warn(`[${prefix}] WARN: ${msg}`, ...args);
		},
	};
}

export type Logger = ReturnType<typeof createLogger>;
