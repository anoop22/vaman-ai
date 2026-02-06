/**
 * World Model page — view and edit world model markdown.
 */
function worldModelPage() {
	return {
		content: "",
		saving: false,
		loading: true,

		async init() {
			try {
				const data = await API.get("/api/world-model");
				this.content = data.content || "";
			} catch (e) {
				console.error("Failed to load world model:", e);
			}
			this.loading = false;
		},

		async save() {
			this.saving = true;
			try {
				await API.put("/api/world-model", { content: this.content });
				Alpine.store("app").showToast("World model saved");
			} catch (e) {
				Alpine.store("app").showToast("Failed to save: " + e.message, "error");
			}
			this.saving = false;
		}
	};
}
