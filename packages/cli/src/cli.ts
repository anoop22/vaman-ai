#!/usr/bin/env node
import { Command } from "commander";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env from monorepo root
config({ path: resolve(import.meta.dirname, "../../../.env") });

import { chatCommand } from "./commands/chat.js";
import { startCommand } from "./commands/start.js";
import { stopCommand, restartCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { sessionsCommand, resumeCommand } from "./commands/sessions.js";
import { talkCommand } from "./commands/talk.js";
import { onboardCommand } from "./commands/onboard.js";
import { codingCommand } from "./commands/coding.js";

const program = new Command();

program.name("vaman").description("Vaman AI - Personal AI Assistant").version("0.1.0");

program.command("chat").description("Start interactive chat session").action(chatCommand);

program
	.command("start")
	.description("Start the gateway daemon")
	.option("-f, --foreground", "Run in foreground instead of as daemon")
	.action(startCommand);

program.command("stop").description("Stop the gateway daemon").action(stopCommand);

program.command("restart").description("Restart the gateway daemon").action(restartCommand);

program.command("status").description("Show gateway health status").action(statusCommand);

program.command("sessions").description("List all sessions across channels").action(sessionsCommand);

program
	.command("resume <session-key>")
	.description("Resume a session from the terminal")
	.action(resumeCommand);

program
	.command("talk")
	.description("Start voice conversation mode (Parakeet STT + Kokoro TTS)")
	.action(talkCommand);

program
	.command("onboard")
	.description("Interactive setup wizard for first-time configuration")
	.action(onboardCommand);

program
	.command("coding")
	.description("Start bridge client (route channel messages to local agent)")
	.option("--session <id>", "Continue a specific Claude Code session by ID")
	.option("--new-session", "Start a fresh Claude Code session (default)")
	.action(codingCommand);

// Default to chat if no command given
program.action(chatCommand);

program.parse();
