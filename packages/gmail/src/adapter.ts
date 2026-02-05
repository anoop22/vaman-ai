import { google, type gmail_v1 } from "googleapis";
import { createLogger, type ChannelAdapter, type ChannelHealth, type OutboundMessage } from "@vaman-ai/shared";
import { getGmailAuth } from "./auth.js";

const log = createLogger("gmail");

export interface GmailAdapterOptions {
	credentialsPath: string;
	address: string;
	pollIntervalMs: number;
	onMessage: (sessionKey: string, content: string, threadId: string) => Promise<void>;
}

export class GmailAdapter implements ChannelAdapter {
	readonly name = "gmail";
	private gmail: gmail_v1.Gmail | null = null;
	private pollInterval: ReturnType<typeof setInterval> | null = null;
	private connected = false;
	private lastActivity?: Date;
	private error?: string;
	private lastHistoryId?: string;

	constructor(private options: GmailAdapterOptions) {}

	async start(): Promise<void> {
		try {
			const auth = await getGmailAuth(this.options.credentialsPath);
			this.gmail = google.gmail({ version: "v1", auth });
			this.connected = true;

			// Get initial history ID
			const profile = await this.gmail.users.getProfile({ userId: "me" });
			this.lastHistoryId = profile.data.historyId || undefined;

			// Start polling
			this.pollInterval = setInterval(() => this.poll(), this.options.pollIntervalMs);
			log.info(`Gmail adapter started (polling every ${this.options.pollIntervalMs}ms)`);
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
			log.error("Gmail start failed:", this.error);
			throw err;
		}
	}

	async stop(): Promise<void> {
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
		this.connected = false;
		log.info("Gmail adapter stopped");
	}

	async send(target: string, message: OutboundMessage): Promise<void> {
		if (!this.gmail) throw new Error("Gmail not connected");

		// target is the sender's email address
		const to = target;
		const subject = "Re: Vaman AI";

		const email = [
			`To: ${to}`,
			`Subject: ${subject}`,
			`Content-Type: text/plain; charset=utf-8`,
			"",
			message.text || "",
		].join("\r\n");

		const encodedEmail = Buffer.from(email).toString("base64url");

		await this.gmail.users.messages.send({
			userId: "me",
			requestBody: {
				raw: encodedEmail,
				threadId: message.replyTo,
			},
		});

		this.lastActivity = new Date();
		log.debug(`Sent reply to ${to}`);
	}

	health(): ChannelHealth {
		return {
			name: this.name,
			connected: this.connected,
			lastActivity: this.lastActivity,
			error: this.error,
		};
	}

	private async poll(): Promise<void> {
		if (!this.gmail) return;

		try {
			// Query for unread messages addressed to our email
			const res = await this.gmail.users.messages.list({
				userId: "me",
				q: `to:${this.options.address} is:unread`,
				maxResults: 10,
			});

			const messages = res.data.messages || [];
			if (messages.length === 0) return;

			for (const msgRef of messages) {
				if (!msgRef.id) continue;

				const msg = await this.gmail.users.messages.get({
					userId: "me",
					id: msgRef.id,
					format: "full",
				});

				const headers = msg.data.payload?.headers || [];
				const from = headers.find((h) => h.name === "From")?.value || "unknown";
				const to = headers.find((h) => h.name === "To")?.value || "";

				// Only process if addressed to our email
				if (!to.toLowerCase().includes(this.options.address.toLowerCase())) continue;

				// Extract sender email
				const senderMatch = from.match(/<([^>]+)>/);
				const sender = senderMatch ? senderMatch[1] : from;

				// Extract body
				const body = extractBody(msg.data.payload);
				const threadId = msg.data.threadId || msgRef.id;
				const sessionKey = `main:gmail:${sender}`;

				log.debug(`New email from ${sender} (thread: ${threadId})`);
				this.lastActivity = new Date();

				await this.options.onMessage(sessionKey, body, threadId);

				// Mark as read
				await this.gmail.users.messages.modify({
					userId: "me",
					id: msgRef.id,
					requestBody: {
						removeLabelIds: ["UNREAD"],
					},
				});
			}
		} catch (err) {
			log.error("Gmail poll error:", err);
			this.error = err instanceof Error ? err.message : String(err);
		}
	}
}

function extractBody(payload: any): string {
	if (!payload) return "";

	// Simple text/plain
	if (payload.mimeType === "text/plain" && payload.body?.data) {
		return Buffer.from(payload.body.data, "base64").toString("utf-8");
	}

	// Multipart - find text/plain part
	if (payload.parts) {
		for (const part of payload.parts) {
			const body = extractBody(part);
			if (body) return body;
		}
	}

	return "";
}
