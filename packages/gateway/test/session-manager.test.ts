import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SessionManager } from "../src/session-manager.js";

describe("SessionManager", () => {
	let tmpDir: string;
	let manager: SessionManager;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "vaman-test-"));
		manager = new SessionManager(tmpDir);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("builds and parses session keys", () => {
		const key = SessionManager.buildKey({
			agent: "main",
			channel: "discord",
			target: "dm",
		});
		expect(key).toBe("main:discord:dm");

		const parsed = SessionManager.parseKey(key);
		expect(parsed.agent).toBe("main");
		expect(parsed.channel).toBe("discord");
		expect(parsed.target).toBe("dm");
	});

	it("appends and reads session messages", () => {
		const key = "main:cli:interactive";
		manager.append(key, { role: "user", content: "hello", timestamp: 1000 });
		manager.append(key, { role: "assistant", content: "hi there", timestamp: 1001 });

		const entries = manager.read(key);
		expect(entries).toHaveLength(2);
		expect(entries[0].content).toBe("hello");
		expect(entries[1].content).toBe("hi there");
	});

	it("returns empty array for non-existent session", () => {
		expect(manager.read("nonexistent")).toEqual([]);
	});

	it("lists all sessions", () => {
		manager.append("main:cli:a", { role: "user", content: "a", timestamp: 100 });
		manager.append("main:discord:b", { role: "user", content: "b", timestamp: 200 });

		const sessions = manager.list();
		expect(sessions).toHaveLength(2);
	});

	it("checks session existence", () => {
		expect(manager.exists("missing")).toBe(false);
		manager.append("test:key:here", { role: "user", content: "x", timestamp: 1 });
		expect(manager.exists("test:key:here")).toBe(true);
	});

	it("clears a session", () => {
		const key = "main:cli:clear";
		manager.append(key, { role: "user", content: "data", timestamp: 1 });
		expect(manager.read(key)).toHaveLength(1);

		manager.clear(key);
		expect(manager.read(key)).toEqual([]);
	});
});
