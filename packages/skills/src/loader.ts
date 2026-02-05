import { readFileSync, readdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { createLogger } from "@vaman-ai/shared";

const log = createLogger("skills");

export interface Skill {
	name: string;
	description: string;
	content: string;
	filePath: string;
}

/** Parse YAML frontmatter from a markdown file */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) {
		return { frontmatter: {}, body: content };
	}

	const frontmatter: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx > 0) {
			const key = line.slice(0, colonIdx).trim();
			const value = line.slice(colonIdx + 1).trim();
			frontmatter[key] = value;
		}
	}

	return { frontmatter, body: match[2] };
}

/** Scan a directory recursively for .md skill files */
function scanDir(dir: string): Skill[] {
	if (!existsSync(dir)) return [];

	const skills: Skill[] = [];
	const entries = readdirSync(dir, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			// Look for SKILL.md in subdirectories
			const skillFile = join(fullPath, "SKILL.md");
			if (existsSync(skillFile)) {
				const content = readFileSync(skillFile, "utf-8");
				const { frontmatter, body } = parseFrontmatter(content);
				skills.push({
					name: frontmatter.name || entry.name,
					description: frontmatter.description || "",
					content: body.trim(),
					filePath: skillFile,
				});
			}
		} else if (entry.name.endsWith(".md")) {
			const content = readFileSync(fullPath, "utf-8");
			const { frontmatter, body } = parseFrontmatter(content);
			skills.push({
				name: frontmatter.name || entry.name.replace(".md", ""),
				description: frontmatter.description || "",
				content: body.trim(),
				filePath: fullPath,
			});
		}
	}

	return skills;
}

/** Load all skills from built-in and user directories */
export function loadSkills(dataDir: string, builtInDir?: string): Skill[] {
	const userDir = resolve(dataDir, "skills");
	const builtIn = builtInDir || resolve(import.meta.dirname, "../built-in");

	const builtInSkills = scanDir(builtIn);
	const userSkills = scanDir(userDir);

	const all = [...builtInSkills, ...userSkills];
	log.info(`Loaded ${all.length} skills (${builtInSkills.length} built-in, ${userSkills.length} user)`);

	return all;
}

/** Convert skills to XML blocks for system prompt injection */
export function skillsToSystemPrompt(skills: Skill[]): string {
	if (skills.length === 0) return "";

	const blocks = skills.map(
		(s) =>
			`<skill name="${s.name}" description="${s.description}">\n${s.content}\n</skill>`,
	);

	return `\n\n## Available Skills\n\n${blocks.join("\n\n")}`;
}

export { parseFrontmatter, scanDir };
