/**
 * REST API client — thin wrapper around fetch with JSON handling.
 */
const API = {
	async get(path) {
		const res = await fetch(path);
		if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
		return res.json();
	},

	async put(path, body) {
		const res = await fetch(path, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
		return res.json();
	},

	async post(path, body) {
		const res = await fetch(path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
		return res.json();
	},

	async del(path) {
		const res = await fetch(path, { method: "DELETE" });
		if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
		return res.json();
	}
};
