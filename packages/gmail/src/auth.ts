import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { google } from "googleapis";
import { createLogger } from "@vaman-ai/shared";

const log = createLogger("gmail-auth");

const SCOPES = [
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/gmail.send",
	"https://www.googleapis.com/auth/gmail.modify",
];

const TOKEN_PATH = "config/credentials/gmail-token.json";

export async function getGmailAuth(credentialsPath: string) {
	const credentials = JSON.parse(readFileSync(credentialsPath, "utf-8"));
	const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

	const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0] || "urn:ietf:wg:oauth:2.0:oob");

	// Check for saved token
	const tokenPath = resolve(credentialsPath, "..", "gmail-token.json");
	if (existsSync(tokenPath)) {
		const token = JSON.parse(readFileSync(tokenPath, "utf-8"));
		auth.setCredentials(token);
		log.info("Gmail auth loaded from saved token");

		// Set up auto-refresh
		auth.on("tokens", (tokens) => {
			if (tokens.refresh_token) {
				const existing = JSON.parse(readFileSync(tokenPath, "utf-8"));
				existing.refresh_token = tokens.refresh_token;
				writeFileSync(tokenPath, JSON.stringify(existing, null, "\t"), "utf-8");
			}
		});

		return auth;
	}

	// First-time auth - generate URL for user
	const authUrl = auth.generateAuthUrl({
		access_type: "offline",
		scope: SCOPES,
		prompt: "consent",
	});

	log.info("Gmail OAuth required. Visit this URL to authorize:");
	console.log(`\n${authUrl}\n`);
	console.log("Then run: vaman gmail-auth <code>");

	throw new Error("Gmail OAuth not yet authorized. Run the auth flow first.");
}

export async function exchangeGmailCode(credentialsPath: string, code: string) {
	const credentials = JSON.parse(readFileSync(credentialsPath, "utf-8"));
	const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

	const auth = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0] || "urn:ietf:wg:oauth:2.0:oob");

	const { tokens } = await auth.getToken(code);
	auth.setCredentials(tokens);

	const tokenPath = resolve(credentialsPath, "..", "gmail-token.json");
	writeFileSync(tokenPath, JSON.stringify(tokens, null, "\t"), "utf-8");
	log.info("Gmail token saved");

	return auth;
}
