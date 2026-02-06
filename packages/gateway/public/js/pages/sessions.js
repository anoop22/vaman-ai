/**
 * Sessions page — list sessions + conversation viewer.
 */
function sessionsPage() {
	return {
		sessions: [],
		selected: null,
		conversation: [],
		loading: true,
		loadingChat: false,

		async init() {
			try {
				this.sessions = await API.get("/api/sessions");
				this.sessions.sort((a, b) => b.lastActivity - a.lastActivity);
			} catch (e) {
				console.error("Failed to load sessions:", e);
			}
			this.loading = false;
		},

		async selectSession(session) {
			this.selected = session.key;
			this.loadingChat = true;
			try {
				this.conversation = await API.get(`/api/sessions/${encodeURIComponent(session.key)}`);
			} catch (e) {
				console.error("Failed to load conversation:", e);
				this.conversation = [];
			}
			this.loadingChat = false;
			this.$nextTick(() => {
				const view = document.querySelector(".chat-view");
				if (view) view.scrollTop = view.scrollHeight;
			});
		},

		formatSessionName(key) {
			const parts = key.split(":");
			if (parts.length >= 3) {
				const channel = parts[1];
				const target = parts.slice(2).join(":");
				if (target.startsWith("dm:")) return `DM ${target.slice(3)}`;
				if (target.startsWith("channel:")) return `#${target.slice(8)}`;
				return `${channel}:${target}`;
			}
			return key;
		}
	};
}
