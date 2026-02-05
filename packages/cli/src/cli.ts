#!/usr/bin/env node
import { Command } from "commander";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env from monorepo root
config({ path: resolve(import.meta.dirname, "../../../.env") });

import { chatCommand } from "./commands/chat.js";

const program = new Command();

program.name("vaman").description("Vaman AI - Personal AI Assistant").version("0.1.0");

program.command("chat").description("Start interactive chat session").action(chatCommand);

// Default to chat if no command given
program.action(chatCommand);

program.parse();
