export interface VamanConfig {
	gateway: {
		port: number;
		host: string;
	};
	agent: {
		defaultModel: string;
		defaultProvider: string;
	};
	discord: {
		token: string;
		enabled: boolean;
	};
	gmail: {
		credentialsPath: string;
		address: string;
		enabled: boolean;
		pollIntervalMs: number;
	};
	heartbeat: {
		enabled: boolean;
		intervalMs: number;
		activeHoursStart: string;
		activeHoursEnd: string;
		defaultDelivery: string;
	};
	state: {
		conversationHistory: number;
		worldModelPath: string;
		archivePath: string;
		extractionEnabled: boolean;
		extractionTimeoutMs: number;
		worldModelMaxTokens: number;
		userTimezone: string;
	};
}

export interface SessionKey {
	agent: string;
	channel: string;
	target: string;
}

export interface OutboundMessage {
	text?: string;
	files?: Array<{ name: string; data: Buffer; mimeType: string }>;
	replyTo?: string;
}

export interface ChannelHealth {
	name: string;
	connected: boolean;
	lastActivity?: Date;
	error?: string;
}

export interface ChannelAdapter {
	name: string;
	start(): Promise<void>;
	stop(): Promise<void>;
	send(target: string, message: OutboundMessage): Promise<void>;
	health(): ChannelHealth;
}

// Gateway wire protocol
export type GatewayRequest = {
	type: "req";
	id: string;
	method: string;
	params?: Record<string, unknown>;
};

export type GatewayResponse = {
	type: "res";
	id: string;
	ok: boolean;
	payload?: unknown;
	error?: string;
};

export type GatewayEvent = {
	type: "event";
	event: string;
	payload?: unknown;
};

export type GatewayMessage = GatewayRequest | GatewayResponse | GatewayEvent;
