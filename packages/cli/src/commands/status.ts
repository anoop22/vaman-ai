import { loadConfig, createLogger } from "@vaman-ai/shared";

const log = createLogger("cli");

function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d}d ${h}h ${m}m`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

function formatAge(ms: number): string {
	const mins = Math.floor(ms / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

export async function statusCommand() {
	const config = loadConfig();
	const { port, host } = config.gateway;
	const url = `http://${host}:${port}/api/status`;

	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
		if (!res.ok) {
			console.log(`Gateway: ERROR (HTTP ${res.status})`);
			return;
		}

		const s = await res.json() as any;
		const uptimeStr = formatUptime(s.uptime);
		const fallbackStr = s.model.fallbacks.length > 0
			? s.model.fallbacks.join(", ")
			: "none";
		const aliasEntries = Object.entries(s.model.aliases as Record<string, string>);
		const aliasStr = aliasEntries.length > 0
			? aliasEntries.map(([k, v]) => `${k} -> ${v}`).join(", ")
			: "none";
		const hbStatus = !s.heartbeat.enabled
			? "disabled"
			: s.heartbeat.currentlyActive
				? `active (every ${Math.round(s.heartbeat.intervalMs / 60000)}m)`
				: "outside active hours";
		const lastRunStr = s.heartbeat.lastRun
			? `${s.heartbeat.lastRun.success ? "\u2713" : "\u2717"} ${formatAge(Date.now() - s.heartbeat.lastRun.completedAt)}`
			: "never";
		const cronStr = s.cron.jobCount > 0
			? s.cron.jobs.map((j: any) => j.name).join(", ")
			: "none";

		console.log(`\x1b[1mNova Status\x1b[0m`);
		console.log();
		console.log(`\x1b[1mSystem\x1b[0m`);
		console.log(`  Version:   ${s.version} \u00b7 Node ${s.node} \u00b7 ${s.platform}`);
		console.log(`  Uptime:    ${uptimeStr}`);
		console.log(`  Gateway:   ws://${s.gateway.host}:${s.gateway.port} (${s.gateway.clients} clients)`);
		console.log();
		console.log(`\x1b[1mModel\x1b[0m`);
		console.log(`  Current:   ${s.model.current}`);
		console.log(`  Thinking:  ${s.model.thinkingLevel}`);
		console.log(`  Fallbacks: ${fallbackStr}`);
		console.log(`  Aliases:   ${aliasStr}`);
		console.log();
		console.log(`\x1b[1mChannels\x1b[0m`);
		console.log(`  Discord:   ${s.channels.discord.connected ? "\x1b[32m\u2713 connected\x1b[0m" : "\x1b[31m\u2717 disconnected\x1b[0m"}`);
		console.log(`  Gmail:     ${s.channels.gmail.enabled ? "\x1b[32m\u2713 enabled\x1b[0m" : "\x1b[33m\u2717 disabled\x1b[0m"}`);
		console.log();
		console.log(`\x1b[1mHeartbeat\x1b[0m`);
		console.log(`  Status:    ${hbStatus}`);
		console.log(`  Hours:     ${s.heartbeat.activeHours}`);
		console.log(`  Last run:  ${lastRunStr}`);
		console.log(`  Content:   ${s.heartbeat.hasContent ? "configured" : "empty"}`);
		console.log();
		console.log(`\x1b[1mCron\x1b[0m: ${s.cron.jobCount} jobs (${cronStr})`);
		console.log(`\x1b[1mSessions\x1b[0m: ${s.sessions.count}`);
		console.log(`\x1b[1mWorld Model\x1b[0m: ${(s.state.worldModelChars / 1000).toFixed(1)}k chars`);
		console.log(`\x1b[1mSkills\x1b[0m: ${s.skills.count} (${s.skills.names.join(", ")})`);
	} catch {
		console.log(`Gateway: \x1b[31mNOT RUNNING\x1b[0m (ws://${host}:${port})`);
	}
}
