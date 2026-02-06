/**
 * WebSocket client for real-time events from the gateway.
 * Auto-reconnects with exponential backoff.
 */
const WS = {
	ws: null,
	listeners: {},
	connected: false,
	reconnectDelay: 1000,
	maxReconnectDelay: 30000,

	connect() {
		const proto = location.protocol === "https:" ? "wss:" : "ws:";
		const url = `${proto}//${location.host}`;

		this.ws = new WebSocket(url);

		this.ws.onopen = () => {
			this.connected = true;
			this.reconnectDelay = 1000;
			this._emit("connection", { connected: true });
		};

		this.ws.onclose = () => {
			this.connected = false;
			this._emit("connection", { connected: false });
			setTimeout(() => this.connect(), this.reconnectDelay);
			this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
		};

		this.ws.onerror = () => {};

		this.ws.onmessage = (e) => {
			try {
				const msg = JSON.parse(e.data);
				if (msg.type === "event") {
					this._emit(msg.event, msg.payload);
				}
			} catch {}
		};
	},

	on(event, fn) {
		if (!this.listeners[event]) this.listeners[event] = [];
		this.listeners[event].push(fn);
	},

	off(event, fn) {
		if (!this.listeners[event]) return;
		this.listeners[event] = this.listeners[event].filter(f => f !== fn);
	},

	_emit(event, data) {
		(this.listeners[event] || []).forEach(fn => fn(data));
	},

	send(method, params = {}) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
		this.ws.send(JSON.stringify({
			type: "req",
			id: Date.now().toString(36),
			method,
			params,
		}));
	}
};
