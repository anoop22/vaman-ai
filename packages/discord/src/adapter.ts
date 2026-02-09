import {
	Client, GatewayIntentBits, Events, Partials, REST, Routes, SlashCommandBuilder,
	type Message as DiscordMessage, type ChatInputCommandInteraction,
} from "discord.js";
import { createLogger, type ChannelAdapter, type ChannelHealth, type OutboundMessage } from "@vaman-ai/shared";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const log = createLogger("discord");

const MAX_MESSAGE_LENGTH = 2000;

export interface SlashCommandDef {
	name: string;
	description: string;
	options?: { name: string; description: string; required?: boolean }[];
}

export interface DiscordAdapterOptions {
	token: string;
	onMessage: (sessionKey: string, content: string, replyTo: string) => Promise<void>;
	onSlashCommand?: (commandName: string, args: Record<string, string>, sessionKey: string) => Promise<string>;
	slashCommands?: SlashCommandDef[];
	allowedUsers?: string[];
	uploadDir?: string;
}

async function downloadAttachment(url: string, name: string, uploadDir: string): Promise<string> {
	await mkdir(uploadDir, { recursive: true });
	const timestamp = Date.now();
	const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
	const filename = `${timestamp}-${safeName}`;
	const filepath = resolve(uploadDir, filename);

	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to download ${name}: HTTP ${response.status}`);
	const buffer = Buffer.from(await response.arrayBuffer());
	await writeFile(filepath, buffer);

	return filepath;
}

export class DiscordAdapter implements ChannelAdapter {
	readonly name = "discord";
	private client: Client;
	private connected = false;
	private lastActivity?: Date;
	private error?: string;

	constructor(private options: DiscordAdapterOptions) {
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.DirectMessages,
				GatewayIntentBits.MessageContent,
			],
			partials: [Partials.Channel],
			rest: { timeout: 120_000 },
		});
	}

	async start(): Promise<void> {
		this.client.on(Events.ClientReady, async () => {
			log.info(`Discord connected as ${this.client.user?.tag}`);
			this.connected = true;
			this.lastActivity = new Date();

			// Register slash commands if provided
			log.info(`Slash commands to register: ${this.options.slashCommands?.length ?? 0}, user: ${this.client.user?.id}`);
			if (this.options.slashCommands?.length && this.client.user) {
				try {
					const rest = new REST({ version: "10" }).setToken(this.options.token);
					const commands = this.options.slashCommands.map((cmd) => {
						const builder = new SlashCommandBuilder()
							.setName(cmd.name)
							.setDescription(cmd.description);
						for (const opt of cmd.options ?? []) {
							builder.addStringOption((o) =>
								o.setName(opt.name).setDescription(opt.description).setRequired(opt.required ?? false),
							);
						}
						return builder.toJSON();
					});
					await rest.put(Routes.applicationCommands(this.client.user.id), { body: commands });
					log.info(`Registered ${commands.length} slash commands`);
				} catch (err) {
					log.error(`Failed to register slash commands: ${err}`);
				}
			}
		});

		// Handle slash command interactions
		this.client.on(Events.InteractionCreate, async (interaction) => {
			if (!interaction.isChatInputCommand()) return;
			if (!this.options.onSlashCommand) {
				await interaction.reply({ content: "Commands not configured.", ephemeral: true });
				return;
			}

			const cmd = interaction as ChatInputCommandInteraction;
			const args: Record<string, string> = {};
			for (const opt of cmd.options.data) {
				if (typeof opt.value === "string") args[opt.name] = opt.value;
			}

			const isDM = !cmd.guild;
			const sessionKey = isDM
				? `main:discord:dm:${cmd.user.id}`
				: `main:discord:channel:${cmd.channelId}`;

			log.info(`Slash command /${cmd.commandName} from ${cmd.user.tag} in ${sessionKey}`);

			try {
				await cmd.deferReply();
				const response = await this.options.onSlashCommand(cmd.commandName, args, sessionKey);
				// Chunk if needed (Discord followUp limit is 2000)
				const chunks = chunkMessage(response, MAX_MESSAGE_LENGTH);
				await cmd.editReply(chunks[0]);
				for (const chunk of chunks.slice(1)) {
					await cmd.followUp(chunk);
				}
			} catch (err) {
				log.error(`Slash command error: ${err}`);
				const errMsg = `Error: ${err instanceof Error ? err.message : err}`;
				if (cmd.deferred) {
					await cmd.editReply(errMsg).catch(() => {});
				} else {
					await cmd.reply({ content: errMsg, ephemeral: true }).catch(() => {});
				}
			}
		});

		this.client.on(Events.MessageCreate, async (message: DiscordMessage) => {
			// Ignore bot messages
			if (message.author.bot) return;

			// Check allowlist
			if (this.options.allowedUsers?.length) {
				if (!this.options.allowedUsers.includes(message.author.id)) return;
			}

			this.lastActivity = new Date();

			// Build session key (include user ID for DMs so we can reply)
			const isDM = !message.guild;
			const sessionKey = isDM
				? `main:discord:dm:${message.author.id}`
				: `main:discord:channel:${message.channelId}`;

			log.info(`Message from ${message.author.tag} in ${sessionKey}`);

			// Show typing indicator while processing
			const ch = message.channel.partial
				? await message.channel.fetch()
				: message.channel;
			const sendTyping = () => {
				(ch as any).sendTyping?.().catch((err: any) => {
					log.warn(`sendTyping failed: ${err.message}`);
				});
			};
			sendTyping();
			const typingInterval = setInterval(sendTyping, 8000);

			try {
				// Download attachments and append file paths to content
				let fullContent = message.content;

				if (message.attachments.size > 0 && this.options.uploadDir) {
					for (const [, att] of message.attachments) {
						try {
							const filepath = await downloadAttachment(
								att.url, att.name, this.options.uploadDir,
							);
							const sizeKB = (att.size / 1024).toFixed(1);
							fullContent += `\n[Attached file: ${filepath} (name: ${att.name}, type: ${att.contentType || "unknown"}, size: ${sizeKB}KB)]`;
							log.info(`Downloaded attachment: ${att.name} (${sizeKB}KB) → ${filepath}`);
						} catch (err) {
							log.error(`Failed to download attachment ${att.name}: ${err}`);
							fullContent += `\n[Attachment failed: ${att.name} — download error]`;
						}
					}
				}

				await this.options.onMessage(sessionKey, fullContent, message.id);
			} catch (err) {
				log.error("Message handler error:", err);
			} finally {
				clearInterval(typingInterval);
			}
		});

		this.client.on(Events.Error, (err) => {
			log.error("Discord client error:", err);
			this.error = err.message;
		});

		await this.client.login(this.options.token);
	}

	async stop(): Promise<void> {
		this.client.destroy();
		this.connected = false;
		log.info("Discord disconnected");
	}

	async send(target: string, message: OutboundMessage): Promise<void> {
		if (!this.connected) {
			throw new Error("Discord not connected");
		}

		// Parse target: "dm:<userId>" or "channel:<id>"
		let channel;
		if (target.startsWith("dm:")) {
			const userId = target.slice(3);
			const user = await this.client.users.fetch(userId);
			channel = await user.createDM();
		} else if (target.startsWith("channel:")) {
			const channelId = target.slice(8);
			channel = await this.client.channels.fetch(channelId);
		}

		if (!channel || !("send" in channel)) {
			log.error(`Cannot send to target: ${target}`);
			return;
		}

		const files = message.files?.map((f) => ({
			attachment: f.data,
			name: f.name,
		})) ?? [];
		const text = message.text ?? "";

		if (files.length > 0) {
			// Try sending text+files together as a single message
			if (text.trim().length > 0 && text.length <= MAX_MESSAGE_LENGTH) {
				try {
					await (channel as any).send({ content: text, files });
				} catch (err) {
					log.error(`File send failed (content+files) to ${target}: ${err}`);
					// Fall back: send text-only, skip files
					try {
						await (channel as any).send(text + "\n\n*(file attachment failed)*");
					} catch {}
				}
			} else {
				// Long text: chunk text first, then send files separately
				if (text.trim().length > 0) {
					const chunks = chunkMessage(text, MAX_MESSAGE_LENGTH);
					for (const chunk of chunks) {
						await (channel as any).send(chunk);
					}
				}
				try {
					await (channel as any).send({ files });
				} catch (err) {
					log.error(`File send failed (files-only) to ${target}: ${err}`);
				}
			}
		} else if (text.trim().length > 0) {
			const chunks = chunkMessage(text, MAX_MESSAGE_LENGTH);
			for (const chunk of chunks) {
				await (channel as any).send(chunk);
			}
		}

		this.lastActivity = new Date();
	}

	health(): ChannelHealth {
		return {
			name: this.name,
			connected: this.connected,
			lastActivity: this.lastActivity,
			error: this.error,
		};
	}
}

/** Split a message into chunks respecting Discord's 2000 char limit */
function chunkMessage(text: string, maxLength: number): string[] {
	if (text.length <= maxLength) return [text];

	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > 0) {
		if (remaining.length <= maxLength) {
			chunks.push(remaining);
			break;
		}

		// Try to split at a newline
		let splitAt = remaining.lastIndexOf("\n", maxLength);
		if (splitAt === -1 || splitAt < maxLength / 2) {
			// Split at space
			splitAt = remaining.lastIndexOf(" ", maxLength);
		}
		if (splitAt === -1 || splitAt < maxLength / 2) {
			// Hard split
			splitAt = maxLength;
		}

		chunks.push(remaining.slice(0, splitAt));
		remaining = remaining.slice(splitAt).trimStart();
	}

	return chunks;
}

export { chunkMessage };
