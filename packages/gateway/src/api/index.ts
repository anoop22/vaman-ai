import type { VamanConfig } from "@vaman-ai/shared";
import type { Skill } from "@vaman-ai/skills";
import type { HttpRouter } from "../http-router.js";
import type { WorldModelManager } from "../state/world-model.js";
import type { SessionManager } from "../session-manager.js";
import type { ArchiveManager } from "../state/archive.js";
import type { CronService } from "../cron-service.js";

import { registerHealthRoutes } from "./health.js";
import { registerWorldModelRoutes } from "./world-model.js";
import { registerHeartbeatRoutes } from "./heartbeat.js";
import { registerCronRoutes } from "./cron.js";
import { registerSessionRoutes } from "./sessions.js";
import { registerArchiveRoutes } from "./archive.js";
import { registerModelRoutes } from "./model.js";
import { registerConfigRoutes } from "./config.js";
import { registerSkillsRoutes } from "./skills.js";

export interface ApiContext {
	config: VamanConfig;
	worldModel: WorldModelManager;
	sessions: SessionManager;
	archive: ArchiveManager;
	cron: CronService;
	switchModel: (ref: string) => boolean;
	loadAliases: () => Record<string, string>;
	saveAliases: (a: Record<string, string>) => void;
	loadFallbacks: () => string[];
	saveFallbacks: (l: string[]) => void;
	getHealth: () => object;
	getStatus: () => object;
	getHeartbeatModel: () => { override: string | null; current: string; inherited: boolean };
	setHeartbeatModel: (ref: string | null) => { ok: boolean; error?: string };
	skills: Skill[];
	dataDir: string;
	builtInDir: string;
}

export function registerApiRoutes(router: HttpRouter, ctx: ApiContext): void {
	registerHealthRoutes(router, ctx);
	registerWorldModelRoutes(router, ctx);
	registerHeartbeatRoutes(router, ctx);
	registerCronRoutes(router, ctx);
	registerSessionRoutes(router, ctx);
	registerArchiveRoutes(router, ctx);
	registerModelRoutes(router, ctx);
	registerConfigRoutes(router, ctx);
	registerSkillsRoutes(router, ctx);
}
