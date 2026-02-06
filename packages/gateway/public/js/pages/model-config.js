/**
 * Model & Config page — switch model, manage aliases/fallbacks, view config.
 */
function modelConfigPage() {
	return {
		model: null,
		config: null,
		aliases: {},
		fallbacks: [],
		loading: true,
		newModelRef: "",
		newAliasName: "",
		newAliasTarget: "",
		newFallback: "",

		async init() {
			await Promise.all([this.loadModel(), this.loadConfig()]);
			this.loading = false;
		},

		async loadModel() {
			try {
				this.model = await API.get("/api/model");
				this.aliases = this.model.aliases || {};
				this.fallbacks = this.model.fallbacks || [];
			} catch (e) {
				console.error("Failed to load model info:", e);
			}
		},

		async loadConfig() {
			try {
				this.config = await API.get("/api/config");
			} catch (e) {
				console.error("Failed to load config:", e);
			}
		},

		async switchModel() {
			if (!this.newModelRef) return;
			try {
				await API.put("/api/model", { ref: this.newModelRef });
				Alpine.store("app").showToast(`Switched to ${this.newModelRef}`);
				this.newModelRef = "";
				await this.loadModel();
			} catch (e) {
				Alpine.store("app").showToast("Failed: " + e.message, "error");
			}
		},

		async addAlias() {
			if (!this.newAliasName || !this.newAliasTarget) return;
			this.aliases[this.newAliasName.toLowerCase()] = this.newAliasTarget;
			try {
				await API.put("/api/model/aliases", this.aliases);
				Alpine.store("app").showToast(`Alias added: ${this.newAliasName}`);
				this.newAliasName = "";
				this.newAliasTarget = "";
			} catch (e) {
				Alpine.store("app").showToast("Failed: " + e.message, "error");
			}
		},

		async removeAlias(name) {
			delete this.aliases[name];
			try {
				await API.put("/api/model/aliases", { ...this.aliases });
				Alpine.store("app").showToast(`Alias removed: ${name}`);
			} catch (e) {
				Alpine.store("app").showToast("Failed: " + e.message, "error");
			}
		},

		async addFallback() {
			if (!this.newFallback) return;
			this.fallbacks.push(this.newFallback);
			try {
				await API.put("/api/model/fallbacks", this.fallbacks);
				Alpine.store("app").showToast("Fallback added");
				this.newFallback = "";
			} catch (e) {
				Alpine.store("app").showToast("Failed: " + e.message, "error");
			}
		},

		async removeFallback(index) {
			this.fallbacks.splice(index, 1);
			try {
				await API.put("/api/model/fallbacks", [...this.fallbacks]);
				Alpine.store("app").showToast("Fallback removed");
			} catch (e) {
				Alpine.store("app").showToast("Failed: " + e.message, "error");
			}
		}
	};
}
