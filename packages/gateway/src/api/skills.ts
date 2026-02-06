import { writeFileSync, unlinkSync, existsSync, mkdirSync, statSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { sendJson, sendError, parseBody } from "../http-router.js";
import { loadSkills } from "@vaman-ai/skills";
import type { Skill } from "@vaman-ai/skills";
import type { ApiContext } from "./index.js";
import type { HttpRouter } from "../http-router.js";

function sanitizeName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function getSkillType(skill: Skill, builtInDir: string): "built-in" | "user" {
	return skill.filePath.startsWith(builtInDir) ? "built-in" : "user";
}

function freshSkills(ctx: ApiContext): Skill[] {
	return loadSkills(ctx.dataDir, ctx.builtInDir);
}

export function registerSkillsRoutes(router: HttpRouter, ctx: ApiContext): void {
	// GET /api/skills — list all skills
	router.get("/api/skills", async (_req, res) => {
		const skills = freshSkills(ctx);
		const list = skills.map((s) => ({
			name: s.name,
			description: s.description,
			type: getSkillType(s, ctx.builtInDir),
		}));
		sendJson(res, list);
	});

	// GET /api/skills/:name — read single skill
	router.get("/api/skills/:name", async (_req, res, params) => {
		const name = decodeURIComponent(params.name);
		const skills = freshSkills(ctx);
		const skill = skills.find((s) => s.name === name);
		if (!skill) {
			sendError(res, 404, `Skill not found: ${name}`);
			return;
		}
		sendJson(res, {
			name: skill.name,
			description: skill.description,
			content: skill.content,
			type: getSkillType(skill, ctx.builtInDir),
		});
	});

	// POST /api/skills — create user skill
	router.post("/api/skills", async (req, res) => {
		const body = await parseBody(req);
		if (!body.name) {
			sendError(res, 400, "Missing required field: name");
			return;
		}

		// Check for duplicate
		const existing = freshSkills(ctx);
		if (existing.find((s) => s.name === body.name)) {
			sendError(res, 409, `Skill already exists: ${body.name}`);
			return;
		}

		const safeName = sanitizeName(body.name);
		if (!safeName) {
			sendError(res, 400, "Invalid skill name");
			return;
		}

		const userSkillsDir = resolve(ctx.dataDir, "skills");
		mkdirSync(userSkillsDir, { recursive: true });
		const filePath = resolve(userSkillsDir, `${safeName}.md`);

		const md = `---\nname: ${body.name}\ndescription: ${body.description || ""}\n---\n${body.content || ""}`;
		writeFileSync(filePath, md, "utf-8");

		sendJson(res, {
			name: body.name,
			description: body.description || "",
			content: body.content || "",
			type: "user",
		}, 201);
	});

	// PUT /api/skills/:name — update user skill
	router.put("/api/skills/:name", async (req, res, params) => {
		const name = decodeURIComponent(params.name);
		const skills = freshSkills(ctx);
		const skill = skills.find((s) => s.name === name);
		if (!skill) {
			sendError(res, 404, `Skill not found: ${name}`);
			return;
		}
		if (getSkillType(skill, ctx.builtInDir) === "built-in") {
			sendError(res, 403, "Cannot edit built-in skills");
			return;
		}

		const body = await parseBody(req);
		const newName = body.name ?? skill.name;
		const newDesc = body.description ?? skill.description;
		const newContent = body.content ?? skill.content;

		const md = `---\nname: ${newName}\ndescription: ${newDesc}\n---\n${newContent}`;
		writeFileSync(skill.filePath, md, "utf-8");

		sendJson(res, {
			name: newName,
			description: newDesc,
			content: newContent,
			type: "user",
		});
	});

	// DELETE /api/skills/:name — delete user skill
	router.delete("/api/skills/:name", async (_req, res, params) => {
		const name = decodeURIComponent(params.name);
		const skills = freshSkills(ctx);
		const skill = skills.find((s) => s.name === name);
		if (!skill) {
			sendError(res, 404, `Skill not found: ${name}`);
			return;
		}
		if (getSkillType(skill, ctx.builtInDir) === "built-in") {
			sendError(res, 403, "Cannot delete built-in skills");
			return;
		}

		// Check if it's a directory-based skill (SKILL.md inside subdir) or a direct .md file
		const parentDir = dirname(skill.filePath);
		const isSubdir = skill.filePath.endsWith("/SKILL.md") || skill.filePath.endsWith("\\SKILL.md");
		if (isSubdir && existsSync(parentDir)) {
			rmSync(parentDir, { recursive: true });
		} else {
			unlinkSync(skill.filePath);
		}

		sendJson(res, { ok: true });
	});
}
