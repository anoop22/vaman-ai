#!/usr/bin/env node
/**
 * OAuth login for AI providers (OpenAI Codex, Anthropic, etc.)
 *
 * Usage: npx tsx packages/gateway/src/oauth-login.ts openai-codex
 */
import { config } from "dotenv";
import { resolve } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { createInterface } from "readline";

config({ path: resolve(process.cwd(), ".env") });

// Pre-import node:crypto and node:http before pi-ai tries its dynamic imports
import "node:crypto";
import "node:http";
import { loginOpenAICodex, loginAnthropic, loginGeminiCli } from "@mariozechner/pi-ai";
import type { OAuthCredentials } from "@mariozechner/pi-ai";

const CREDS_DIR = resolve(process.cwd(), "data/oauth");
const CREDS_FILE = resolve(CREDS_DIR, "credentials.json");

function loadCredentials(): Record<string, OAuthCredentials> {
	if (existsSync(CREDS_FILE)) {
		return JSON.parse(readFileSync(CREDS_FILE, "utf-8"));
	}
	return {};
}

function saveCredentials(creds: Record<string, OAuthCredentials>): void {
	mkdirSync(CREDS_DIR, { recursive: true });
	writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2), "utf-8");
	console.log(`Credentials saved to ${CREDS_FILE}`);
}

function prompt(question: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
	});
}

async function loginProvider(providerId: string): Promise<OAuthCredentials> {
	const callbacks = {
		onAuth: (info: { url: string; instructions?: string }) => {
			console.log("\n=== Open this URL in your browser ===");
			console.log(info.url);
			if (info.instructions) console.log(info.instructions);
			console.log("=====================================\n");
		},
		onPrompt: async (p: { message: string }) => {
			return prompt(p.message + " ");
		},
		onProgress: (message: string) => {
			console.log(`[progress] ${message}`);
		},
		onManualCodeInput: async () => {
			return prompt("Paste the authorization code here: ");
		},
	};

	switch (providerId) {
		case "openai-codex":
			return loginOpenAICodex(callbacks);
		case "anthropic":
			return loginAnthropic(callbacks);
		case "gemini-cli":
			return loginGeminiCli(callbacks);
		default:
			throw new Error(`Unknown provider: ${providerId}. Available: openai-codex, anthropic, gemini-cli`);
	}
}

async function main() {
	const providerId = process.argv[2];
	if (!providerId) {
		console.log("Usage: npx tsx packages/gateway/src/oauth-login.ts <provider>");
		console.log("Providers: openai-codex, anthropic, gemini-cli");
		process.exit(1);
	}

	console.log(`Starting OAuth login for: ${providerId}`);
	// Wait for pi-ai's dynamic imports (node:crypto, node:http) to resolve
	await new Promise((r) => setTimeout(r, 500));
	const credentials = await loginProvider(providerId);

	const allCreds = loadCredentials();
	allCreds[providerId] = credentials;
	saveCredentials(allCreds);

	console.log(`\nSuccessfully authenticated with ${providerId}!`);
	console.log(`Token expires: ${new Date(credentials.expires).toISOString()}`);
}

main().catch((err) => {
	console.error(`Login failed: ${err}`);
	process.exit(1);
});
