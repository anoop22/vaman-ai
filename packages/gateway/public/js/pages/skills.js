/**
 * Skills page — view, create, edit, delete skills.
 */
function skillsPage() {
	return {
		skills: [],
		loading: true,
		selected: null,
		loadingSkill: false,
		editing: false,
		showAddForm: false,
		newSkill: { name: "", description: "", content: "" },
		editBuffer: { name: "", description: "", content: "" },
		saving: false,

		async init() {
			await this.loadSkills();
			this.loading = false;
		},

		async loadSkills() {
			try {
				this.skills = await API.get("/api/skills");
			} catch (e) {
				console.error("Failed to load skills:", e);
			}
		},

		async selectSkill(skill) {
			this.loadingSkill = true;
			this.editing = false;
			try {
				this.selected = await API.get("/api/skills/" + encodeURIComponent(skill.name));
			} catch (e) {
				Alpine.store("app").showToast("Failed to load skill: " + e.message, "error");
			}
			this.loadingSkill = false;
		},

		startEdit() {
			this.editBuffer = {
				name: this.selected.name,
				description: this.selected.description,
				content: this.selected.content,
			};
			this.editing = true;
		},

		cancelEdit() {
			this.editing = false;
		},

		async saveEdit() {
			this.saving = true;
			try {
				await API.put("/api/skills/" + encodeURIComponent(this.selected.name), this.editBuffer);
				Alpine.store("app").showToast("Skill updated (restart required to take effect)");
				this.editing = false;
				await this.loadSkills();
				this.selected = await API.get("/api/skills/" + encodeURIComponent(this.editBuffer.name));
			} catch (e) {
				Alpine.store("app").showToast("Failed: " + e.message, "error");
			}
			this.saving = false;
		},

		async addSkill() {
			if (!this.newSkill.name) return;
			this.saving = true;
			try {
				await API.post("/api/skills", this.newSkill);
				Alpine.store("app").showToast("Skill created (restart required to take effect)");
				this.newSkill = { name: "", description: "", content: "" };
				this.showAddForm = false;
				await this.loadSkills();
			} catch (e) {
				Alpine.store("app").showToast("Failed: " + e.message, "error");
			}
			this.saving = false;
		},

		async deleteSkill(name) {
			if (!confirm('Delete skill "' + name + '"? This cannot be undone.')) return;
			try {
				await API.del("/api/skills/" + encodeURIComponent(name));
				Alpine.store("app").showToast("Skill deleted (restart required to take effect)");
				if (this.selected && this.selected.name === name) {
					this.selected = null;
				}
				await this.loadSkills();
			} catch (e) {
				Alpine.store("app").showToast("Failed: " + e.message, "error");
			}
		}
	};
}
