import { watch } from "chokidar";
import { createLogger } from "@vaman-ai/shared";

const log = createLogger("config-watcher");

export type ConfigChangeHandler = (path: string) => void;

export class ConfigWatcher {
	private watcher: ReturnType<typeof watch> | null = null;
	private handlers: ConfigChangeHandler[] = [];

	constructor(private watchPaths: string[]) {}

	/** Start watching for config changes */
	start(): void {
		this.watcher = watch(this.watchPaths, {
			ignoreInitial: true,
			awaitWriteFinish: { stabilityThreshold: 500 },
		});

		this.watcher.on("change", (path) => {
			log.info(`Config changed: ${path}`);
			for (const handler of this.handlers) {
				try {
					handler(path);
				} catch (err) {
					log.error("Config change handler error:", err);
				}
			}
		});

		log.info(`Watching config paths: ${this.watchPaths.join(", ")}`);
	}

	/** Register a handler for config changes */
	onChange(handler: ConfigChangeHandler): void {
		this.handlers.push(handler);
	}

	/** Stop watching */
	stop(): void {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
			log.info("Config watcher stopped");
		}
	}
}
