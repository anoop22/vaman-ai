/**
 * Alpine.js app — global state, page routing, toast notifications.
 */
document.addEventListener("alpine:init", () => {
	Alpine.store("app", {
		page: "overview",
		wsConnected: false,
		toast: null,
		toastTimer: null,

		navigate(page) {
			this.page = page;
		},

		showToast(message, type = "success") {
			this.toast = { message, type };
			clearTimeout(this.toastTimer);
			this.toastTimer = setTimeout(() => { this.toast = null; }, 3000);
		}
	});

	// WebSocket connection tracking
	WS.on("connection", ({ connected }) => {
		Alpine.store("app").wsConnected = connected;
	});
	WS.connect();
});

/** Format a timestamp as relative time */
function timeAgo(ts) {
	const diff = Date.now() - ts;
	const s = Math.floor(diff / 1000);
	if (s < 60) return `${s}s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	return `${d}d ago`;
}

/** Format seconds as human-readable uptime */
function formatUptime(seconds) {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}
