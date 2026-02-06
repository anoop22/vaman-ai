import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { dirname, resolve } from "path";
import { createLogger } from "@vaman-ai/shared";

const log = createLogger("state:world-model");

export interface WorldModelUpdate {
	action: "replace" | "add" | "remove";
	section: string;
	field: string;
	value?: string;
}

export class WorldModelManager {
	private filePath: string;
	private cached: string | null = null;

	constructor(filePath: string) {
		this.filePath = resolve(filePath);
	}

	/** Load world model from disk, return template if missing */
	load(): string {
		if (this.cached) return this.cached;

		if (existsSync(this.filePath)) {
			this.cached = readFileSync(this.filePath, "utf-8");
			log.info(`Loaded world model (${this.cached.length} chars)`);
		} else {
			log.info("No world model found, using template");
			this.cached = this.getTemplate();
			this.save(this.cached);
		}
		return this.cached;
	}

	/** Atomic write: tmp file + rename */
	save(content: string): void {
		const dir = dirname(this.filePath);
		mkdirSync(dir, { recursive: true });

		const tmpPath = this.filePath + ".tmp";
		writeFileSync(tmpPath, content, "utf-8");
		renameSync(tmpPath, this.filePath);
		this.cached = content;
		log.debug(`World model saved (${content.length} chars)`);
	}

	/** Apply structured updates to the world model */
	applyUpdates(updates: WorldModelUpdate[]): void {
		let content = this.load();
		const sections = this.parseSections(content);

		for (const update of updates) {
			const sectionKey = update.section;
			if (!sections.has(sectionKey)) {
				log.warn(`Unknown section: ${sectionKey}, skipping`);
				continue;
			}

			const lines = sections.get(sectionKey)!;

			if (update.action === "replace") {
				// Find existing field and replace its value
				const fieldIdx = lines.findIndex((l) =>
					l.trimStart().startsWith(`- ${update.field}:`),
				);
				if (fieldIdx !== -1) {
					const indent = lines[fieldIdx].match(/^(\s*)/)?.[1] ?? "";
					lines[fieldIdx] = `${indent}- ${update.field}: ${update.value}`;
				} else {
					// Field doesn't exist, add it
					lines.push(`- ${update.field}: ${update.value}`);
				}
			} else if (update.action === "add") {
				lines.push(`- ${update.field}: ${update.value}`);
			} else if (update.action === "remove") {
				const fieldIdx = lines.findIndex((l) =>
					l.trimStart().startsWith(`- ${update.field}:`),
				);
				if (fieldIdx !== -1) {
					lines.splice(fieldIdx, 1);
				}
			}

			sections.set(sectionKey, lines);
		}

		// Rebuild markdown from sections
		content = this.rebuildFromSections(sections);

		// Update timestamp
		const now = new Date().toISOString();
		content = content.replace(/Last updated:.*/, `Last updated: ${now}`);

		this.save(content);
		log.info(`Applied ${updates.length} world model updates`);
	}

	/** Replace entire content (used by extractor when it rewrites a section) */
	replaceContent(content: string): void {
		this.save(content);
	}

	/** Parse markdown into section name -> lines[] */
	private parseSections(content: string): Map<string, string[]> {
		const sections = new Map<string, string[]>();
		let currentSection = "_header";
		sections.set(currentSection, []);

		for (const line of content.split("\n")) {
			const sectionMatch = line.match(/^## (.+)$/);
			if (sectionMatch) {
				currentSection = sectionMatch[1].trim();
				if (!sections.has(currentSection)) {
					sections.set(currentSection, []);
				}
			} else {
				sections.get(currentSection)!.push(line);
			}
		}

		return sections;
	}

	/** Rebuild markdown from parsed sections */
	private rebuildFromSections(sections: Map<string, string[]>): string {
		const parts: string[] = [];

		// Header first
		const header = sections.get("_header");
		if (header) {
			parts.push(header.join("\n"));
			sections.delete("_header");
		}

		for (const [name, lines] of sections) {
			parts.push(`## ${name}`);
			parts.push(lines.join("\n"));
		}

		return parts.join("\n");
	}

	getTemplate(): string {
		return `# Vaman World Model
Last updated: ${new Date().toISOString()}

## Identity
- User: Anoop
- Timezone: US Eastern

## Current Task
- Working on: (none)
- Status: Idle

## Active Projects
- Vaman AI assistant (main)

## Key Technical Decisions
- Gateway restart: systemctl + sentinel pattern
- State architecture: World model + archive (continuous state)

## Preferences & Patterns
- Values thorough documentation and testing
`;
	}
}
