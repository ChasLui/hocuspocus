import { WsReadyStates } from "@hocuspocus/common";
import { retry } from "@lifeomic/attempt";
import * as time from "lib0/time";
import type { Event, MessageEvent } from "ws";
import EventEmitter from "./EventEmitter.ts";
import type { HocuspocusProvider } from "./HocuspocusProvider.ts";
import { IncomingMessage } from "./IncomingMessage.ts";
import { CloseMessage } from "./OutgoingMessages/CloseMessage.ts";
import type {
	onAwarenessChangeParameters,
	onAwarenessUpdateParameters,
	onCloseParameters,
	onDisconnectParameters,
	onMessageParameters,
	onOpenParameters,
	onOutgoingMessageParameters,
	onStatusParameters,
} from "./types.ts";
import { WebSocketStatus } from "./types.ts";

export type HocusPocusWebSocket = WebSocket & { identifier: string };

export type HocuspocusProviderWebsocketConfiguration = Required<
	Pick<CompleteHocuspocusProviderWebsocketConfiguration, "url">
> &
	Partial<CompleteHocuspocusProviderWebsocketConfiguration>;

export interface CompleteHocuspocusProviderWebsocketConfiguration {
	/**
	 * 你的 @hocuspocus/server 实例的 URL
	 */
	url: string;

	/**
	 * 一个可选的 WebSocket 填充，例如用于 Node.js
	 */
	WebSocketPolyfill: any;

	/**
	 * 当在定义的毫秒数内没有收到消息时断开连接。
	 */
	messageReconnectTimeout: number;
	/**
	 * 每次尝试之间的延迟（毫秒）。你可以提供一个因子来使延迟指数增长。
	 */
	delay: number;
	/**
	 * initialDelay 是等待第一次尝试之前的时间（毫秒）。这个选项通常应该是 0，因为你通常希望第一次尝试立即发生。
	 */
	initialDelay: number;
	/**
	 * factor 选项用于指数增长延迟。
	 */
	factor: number;
	/**
	 * 最大尝试次数或 0（如果尝试次数没有限制）。
	 */
	maxAttempts: number;
	/**
	 * minDelay 用于设置抖动启用时的延迟下限。如果抖动禁用，此属性没有效果。
	 */
	minDelay: number;
	/**
	 * maxDelay 选项用于设置抖动启用时的延迟上限。如果抖动禁用，此属性没有效果。
	 */
	maxDelay: number;
	/**
	 * 如果抖动为 true，则计算的延迟将是一个介于 minDelay 和当前迭代计算的延迟之间的随机整数值。
	 */
	jitter: boolean;
	/**
	 * 一个超时时间（毫秒）。如果超时不为零，则使用 setTimeout 设置一个计时器。如果超时触发，则未来的尝试将被中止。
	 */
	timeout: number;
	onOpen: (data: onOpenParameters) => void;
	onConnect: () => void;
	onMessage: (data: onMessageParameters) => void;
	onOutgoingMessage: (data: onOutgoingMessageParameters) => void;
	onStatus: (data: onStatusParameters) => void;
	onDisconnect: (data: onDisconnectParameters) => void;
	onClose: (data: onCloseParameters) => void;
	onDestroy: () => void;
	onAwarenessUpdate: (data: onAwarenessUpdateParameters) => void;
	onAwarenessChange: (data: onAwarenessChangeParameters) => void;

	/**
	 * 按 documentName 键入的附加提供程序的映射。
	 */
	providerMap: Map<string, HocuspocusProvider>;
}

export class HocuspocusProviderWebsocket extends EventEmitter {
	private messageQueue: any[] = [];

	public configuration: CompleteHocuspocusProviderWebsocketConfiguration = {
		url: "",
		// @ts-ignore
		document: undefined,
		WebSocketPolyfill: undefined,
		// TODO：这应该取决于 awareness.outdatedTime
		messageReconnectTimeout: 30000,
		// 1 秒
		delay: 1000,
		// 瞬间
		initialDelay: 0,
		// 每次延迟加倍
		factor: 2,
		// 无限重试
		maxAttempts: 0,
		// 至少等待 1 秒
		minDelay: 1000,
		// 至少每 30 秒
		maxDelay: 30000,
		// 随机化
		jitter: true,
		// 无限重试
		timeout: 0,
		onOpen: () => null,
		onConnect: () => null,
		onMessage: () => null,
		onOutgoingMessage: () => null,
		onStatus: () => null,
		onDisconnect: () => null,
		onClose: () => null,
		onDestroy: () => null,
		onAwarenessUpdate: () => null,
		onAwarenessChange: () => null,
		providerMap: new Map(),
	};

	webSocket: HocusPocusWebSocket | null = null;

	webSocketHandlers: { [key: string]: any } = {};

	shouldConnect = true;

	status = WebSocketStatus.Disconnected;

	lastMessageReceived = 0;

	identifier = 0;

	intervals: any = {
		connectionChecker: null,
	};

	connectionAttempt: {
		resolve: (value?: any) => void;
		reject: (reason?: any) => void;
	} | null = null;

	constructor(configuration: HocuspocusProviderWebsocketConfiguration) {
		super();
		this.setConfiguration(configuration);

		this.configuration.WebSocketPolyfill = configuration.WebSocketPolyfill
			? configuration.WebSocketPolyfill
			: WebSocket;

		this.on("open", this.configuration.onOpen);
		this.on("open", this.onOpen.bind(this));
		this.on("connect", this.configuration.onConnect);
		this.on("message", this.configuration.onMessage);
		this.on("outgoingMessage", this.configuration.onOutgoingMessage);
		this.on("status", this.configuration.onStatus);
		this.on("disconnect", this.configuration.onDisconnect);
		this.on("close", this.configuration.onClose);
		this.on("destroy", this.configuration.onDestroy);
		this.on("awarenessUpdate", this.configuration.onAwarenessUpdate);
		this.on("awarenessChange", this.configuration.onAwarenessChange);

		this.on("close", this.onClose.bind(this));
		this.on("message", this.onMessage.bind(this));

		this.intervals.connectionChecker = setInterval(
			this.checkConnection.bind(this),
			this.configuration.messageReconnectTimeout / 10,
		);

		if (!this.shouldConnect) {
			return;
		}

		this.connect();
	}

	receivedOnOpenPayload?: Event | undefined = undefined;

	async onOpen(event: Event) {
		this.cancelWebsocketRetry = undefined;
		this.receivedOnOpenPayload = event;
	}

	attach(provider: HocuspocusProvider) {
		this.configuration.providerMap.set(provider.configuration.name, provider);

		if (this.status === WebSocketStatus.Disconnected && this.shouldConnect) {
			this.connect();
		}

		if (
			this.receivedOnOpenPayload &&
			this.status === WebSocketStatus.Connected
		) {
			provider.onOpen(this.receivedOnOpenPayload);
		}
	}

	detach(provider: HocuspocusProvider) {
		if (this.configuration.providerMap.has(provider.configuration.name)) {
			provider.send(CloseMessage, {
				documentName: provider.configuration.name,
			});
			this.configuration.providerMap.delete(provider.configuration.name);
		}
	}

	public setConfiguration(
		configuration: Partial<HocuspocusProviderWebsocketConfiguration> = {},
	): void {
		this.configuration = { ...this.configuration, ...configuration };
	}

	cancelWebsocketRetry?: () => void;

	async connect() {
		if (this.status === WebSocketStatus.Connected) {
			return;
		}

		// 总是取消任何先前启动的连接重试器实例
		if (this.cancelWebsocketRetry) {
			this.cancelWebsocketRetry();
			this.cancelWebsocketRetry = undefined;
		}

		this.receivedOnOpenPayload = undefined;
		this.shouldConnect = true;

		const abortableRetry = () => {
			let cancelAttempt = false;

			const retryPromise = retry(this.createWebSocketConnection.bind(this), {
				delay: this.configuration.delay,
				initialDelay: this.configuration.initialDelay,
				factor: this.configuration.factor,
				maxAttempts: this.configuration.maxAttempts,
				minDelay: this.configuration.minDelay,
				maxDelay: this.configuration.maxDelay,
				jitter: this.configuration.jitter,
				timeout: this.configuration.timeout,
				beforeAttempt: (context) => {
					if (!this.shouldConnect || cancelAttempt) {
						context.abort();
					}
				},
			}).catch((error: any) => {
				// 如果我们中止了连接尝试，则不要抛出错误
				// ref: https://github.com/lifeomic/attempt/blob/master/src/index.ts#L136
				if (error && error.code !== "ATTEMPT_ABORTED") {
					throw error;
				}
			});

			return {
				retryPromise,
				cancelFunc: () => {
					cancelAttempt = true;
				},
			};
		};

		const { retryPromise, cancelFunc } = abortableRetry();
		this.cancelWebsocketRetry = cancelFunc;

		return retryPromise;
	}

	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	attachWebSocketListeners(ws: HocusPocusWebSocket, reject: Function) {
		const { identifier } = ws;
		const onMessageHandler = (payload: any) => this.emit("message", payload);
		const onCloseHandler = (payload: any) =>
			this.emit("close", { event: payload });
		const onOpenHandler = (payload: any) => this.emit("open", payload);
		const onErrorHandler = (err: any) => {
			reject(err);
		};

		this.webSocketHandlers[identifier] = {
			message: onMessageHandler,
			close: onCloseHandler,
			open: onOpenHandler,
			error: onErrorHandler,
		};

		const handlers = this.webSocketHandlers[ws.identifier];

		Object.keys(handlers).forEach((name) => {
			ws.addEventListener(name, handlers[name]);
		});
	}

	cleanupWebSocket() {
		if (!this.webSocket) {
			return;
		}
		const { identifier } = this.webSocket;
		const handlers = this.webSocketHandlers[identifier];

		Object.keys(handlers).forEach((name) => {
			this.webSocket?.removeEventListener(name, handlers[name]);
			delete this.webSocketHandlers[identifier];
		});
		this.webSocket.close();
		this.webSocket = null;
	}

	createWebSocketConnection() {
		return new Promise((resolve, reject) => {
			if (this.webSocket) {
				this.messageQueue = [];
				this.cleanupWebSocket();
			}
			this.lastMessageReceived = 0;
			this.identifier += 1;

			// Init the WebSocket connection
			const ws = new this.configuration.WebSocketPolyfill(this.url);
			ws.binaryType = "arraybuffer";
			ws.identifier = this.identifier;

			this.attachWebSocketListeners(ws, reject);

			this.webSocket = ws;

			// 重置状态
			this.status = WebSocketStatus.Connecting;
			this.emit("status", { status: WebSocketStatus.Connecting });

			// 存储 resolve/reject 以供将来使用
			this.connectionAttempt = {
				resolve,
				reject,
			};
		});
	}

	onMessage(event: MessageEvent) {
		this.resolveConnectionAttempt();

		this.lastMessageReceived = time.getUnixTime();

		const message = new IncomingMessage(event.data);
		const documentName = message.peekVarString();

		this.configuration.providerMap.get(documentName)?.onMessage(event);
	}

	resolveConnectionAttempt() {
		if (this.connectionAttempt) {
			this.connectionAttempt.resolve();
			this.connectionAttempt = null;

			this.status = WebSocketStatus.Connected;
			this.emit("status", { status: WebSocketStatus.Connected });
			this.emit("connect");
			this.messageQueue.forEach((message) => this.send(message));
			this.messageQueue = [];
		}
	}

	stopConnectionAttempt() {
		this.connectionAttempt = null;
	}

	rejectConnectionAttempt() {
		this.connectionAttempt?.reject();
		this.connectionAttempt = null;
	}

	closeTries = 0;

	checkConnection() {
		// 不要在连接未建立时检查连接
		if (this.status !== WebSocketStatus.Connected) {
			return;
		}

		// 不要在等待第一个消息时关闭连接
		if (!this.lastMessageReceived) {
			return;
		}

		// 不要在收到消息后立即关闭连接
		if (
			this.configuration.messageReconnectTimeout >=
			time.getUnixTime() - this.lastMessageReceived
		) {
			return;
		}

		// 长时间没有收到消息，甚至你的 own
		// 意识更新，如果启用了意识。
		this.closeTries += 1;
		// https://bugs.webkit.org/show_bug.cgi?id=247943
		if (this.closeTries > 2) {
			this.onClose({
				event: {
					code: 4408,
					reason: "forced",
				},
			});
			this.closeTries = 0;
		} else {
			this.webSocket?.close();
			this.messageQueue = [];
		}
	}

	// 确保 URL 永远不会以 / 结尾
	get serverUrl() {
		while (this.configuration.url[this.configuration.url.length - 1] === "/") {
			return this.configuration.url.slice(0, this.configuration.url.length - 1);
		}

		return this.configuration.url;
	}

	get url() {
		return this.serverUrl;
	}

	disconnect() {
		this.shouldConnect = false;

		if (this.webSocket === null) {
			return;
		}

		try {
			this.webSocket.close();
			this.messageQueue = [];
		} catch (e) {
			console.error(e);
		}
	}

	send(message: any) {
		if (this.webSocket?.readyState === WsReadyStates.Open) {
			this.webSocket.send(message);
		} else {
			this.messageQueue.push(message);
		}
	}

	onClose({ event }: onCloseParameters) {
		this.closeTries = 0;
		this.cleanupWebSocket();

		if (this.connectionAttempt) {
			// That connection attempt failed.
			this.rejectConnectionAttempt();
		}

		// 让我们更新连接状态。
		this.status = WebSocketStatus.Disconnected;
		this.emit("status", { status: WebSocketStatus.Disconnected });
		this.emit("disconnect", { event });

		// 如果没有任何重试在运行并且我们想要一个连接，则触发连接
		if (!this.cancelWebsocketRetry && this.shouldConnect) {
			setTimeout(() => {
				this.connect();
			}, this.configuration.delay);
		}
	}

	destroy() {
		this.emit("destroy");

		clearInterval(this.intervals.connectionChecker);

		// 如果仍有连接尝试未完成，则应在调用 disconnect 之前停止
		// 否则它将在 onClose 处理程序中被拒绝并触发重试
		this.stopConnectionAttempt();

		this.disconnect();

		this.removeAllListeners();

		this.cleanupWebSocket();
	}
}
