/**
 * Cron & Heartbeat page — manage cron jobs + heartbeat content editor + heartbeat run history.
 */
function cronPage() {
	return {
		jobs: [],
		heartbeatConfig: null,
		heartbeatContent: "",
		savingHeartbeat: false,
		heartbeatRuns: [],
		loadingRuns: false,
		expandedRun: null,
		loading: true,
		showAddForm: false,
		newJob: { name: "", scheduleType: "every", schedule: "", prompt: "", delivery: "discord:dm" },

		async init() {
			await Promise.all([this.loadJobs(), this.loadHeartbeat(), this.loadHeartbeatRuns()]);
			this.loading = false;
		},

		async loadJobs() {
			try {
				this.jobs = await API.get("/api/cron/jobs");
			} catch (e) {
				console.error("Failed to load cron jobs:", e);
			}
		},

		async loadHeartbeat() {
			try {
				const [config, content] = await Promise.all([
					API.get("/api/heartbeat"),
					API.get("/api/heartbeat/content"),
				]);
				this.heartbeatConfig = config;
				this.heartbeatContent = content.content || "";
			} catch (e) {
				console.error("Failed to load heartbeat:", e);
			}
		},

		async addJob() {
			try {
				await API.post("/api/cron/jobs", this.newJob);
				this.newJob = { name: "", scheduleType: "every", schedule: "", prompt: "", delivery: "discord:dm" };
				this.showAddForm = false;
				await this.loadJobs();
				Alpine.store("app").showToast("Cron job added");
			} catch (e) {
				Alpine.store("app").showToast("Failed: " + e.message, "error");
			}
		},

		async removeJob(id) {
			try {
				await API.del(`/api/cron/jobs/${id}`);
				await this.loadJobs();
				Alpine.store("app").showToast("Job removed");
			} catch (e) {
				Alpine.store("app").showToast("Failed: " + e.message, "error");
			}
		},

		async saveHeartbeat() {
			this.savingHeartbeat = true;
			try {
				await API.put("/api/heartbeat/content", { content: this.heartbeatContent });
				Alpine.store("app").showToast("Heartbeat content saved");
			} catch (e) {
				Alpine.store("app").showToast("Failed: " + e.message, "error");
			}
			this.savingHeartbeat = false;
		},

		async loadHeartbeatRuns() {
			this.loadingRuns = true;
			try {
				this.heartbeatRuns = await API.get("/api/heartbeat/runs?limit=50");
			} catch (e) {
				console.error("Failed to load heartbeat runs:", e);
			}
			this.loadingRuns = false;
		},

		timeAgo(ts) {
			const diff = Date.now() - ts;
			const mins = Math.floor(diff / 60000);
			if (mins < 1) return "just now";
			if (mins < 60) return mins + "m ago";
			const hours = Math.floor(mins / 60);
			if (hours < 24) return hours + "h ago";
			const days = Math.floor(hours / 24);
			return days + "d ago";
		},

		truncate(str, len) {
			if (!str) return "";
			return str.length > len ? str.slice(0, len) + "..." : str;
		},

		toggleRun(idx) {
			this.expandedRun = this.expandedRun === idx ? null : idx;
		}
	};
}
