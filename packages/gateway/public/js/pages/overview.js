/**
 * Overview page — health cards + recent activity.
 */
function overviewPage() {
	return {
		health: null,
		loading: true,

		async init() {
			await this.refresh();
			WS.on("health", (payload) => {
				this.health = { ...this.health, ...payload };
			});
			this._interval = setInterval(() => this.refresh(), 30000);
		},

		destroy() {
			clearInterval(this._interval);
		},

		async refresh() {
			try {
				this.health = await API.get("/api/health");
			} catch (e) {
				console.error("Health fetch failed:", e);
			}
			this.loading = false;
		}
	};
}
