import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadSkills, skillsToSystemPrompt, parseFrontmatter } from "../src/loader.js";

describe("parseFrontmatter", () => {
	it("parses YAML frontmatter", () => {
		const content = `---\nname: test\ndescription: A test skill\n---\nHello world`;
		const result = parseFrontmatter(content);
		expect(result.frontmatter.name).toBe("test");
		expect(result.frontmatter.description).toBe("A test skill");
		expect(result.body).toBe("Hello world");
	});

	it("handles content without frontmatter", () => {
		const result = parseFrontmatter("Just content");
		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe("Just content");
	});
});

describe("loadSkills", () => {
	let tmpDir: string;
	let builtInDir: string;
	let userDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "vaman-skills-test-"));
		builtInDir = join(tmpDir, "built-in");
		userDir = join(tmpDir, "data");
		mkdirSync(join(userDir, "skills"), { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("loads built-in skills from directories", () => {
		mkdirSync(join(builtInDir, "test-skill"), { recursive: true });
		writeFileSync(
			join(builtInDir, "test-skill", "SKILL.md"),
			"---\nname: test\ndescription: Test skill\n---\nDo test things",
		);

		const skills = loadSkills(userDir, builtInDir);
		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe("test");
		expect(skills[0].content).toBe("Do test things");
	});

	it("loads user skills from .md files", () => {
		writeFileSync(
			join(userDir, "skills", "custom.md"),
			"---\nname: custom\ndescription: Custom skill\n---\nCustom instructions",
		);

		const skills = loadSkills(userDir, builtInDir);
		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe("custom");
	});

	it("returns empty array when no skills exist", () => {
		const skills = loadSkills(userDir, builtInDir);
		expect(skills).toEqual([]);
	});
});

describe("skillsToSystemPrompt", () => {
	it("generates XML blocks for skills", () => {
		const skills = [
			{ name: "research", description: "Deep research", content: "Do research", filePath: "test" },
		];
		const prompt = skillsToSystemPrompt(skills);
		expect(prompt).toContain("<skill name=\"research\"");
		expect(prompt).toContain("Do research");
	});

	it("returns empty string for no skills", () => {
		expect(skillsToSystemPrompt([])).toBe("");
	});
});
