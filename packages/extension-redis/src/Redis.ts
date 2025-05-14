import type {
	Document,
	Extension,
	Hocuspocus,
	afterLoadDocumentPayload,
	afterStoreDocumentPayload,
	beforeBroadcastStatelessPayload,
	onAwarenessUpdatePayload,
	onChangePayload,
	onConfigurePayload,
	onDisconnectPayload,
	onStoreDocumentPayload,
} from "@hocuspocus/server";
import {
	IncomingMessage,
	MessageReceiver,
	OutgoingMessage,
} from "@hocuspocus/server";
import type { ClusterNode, ClusterOptions, RedisOptions } from "ioredis";
import RedisClient from "ioredis";
import Redlock from "redlock";
import { v4 as uuid } from "uuid";

export type RedisInstance = RedisClient.Cluster | RedisClient.Redis;

export interface Configuration {
	/**
	 * Redis 端口
	 */
	port: number;
	/**
	 * Redis 主机
	 */
	host: string;
	/**
	 * Redis 集群
	 */
	nodes?: ClusterNode[];
	/**
	 * 从现有的 Redis 实例复制
	 */
	redis?: RedisInstance;
	/**
	 * Redis 实例创建者
	 */
	createClient?: () => RedisInstance;
	/**
	 * 直接传递给 Redis 构造函数的选项
	 *
	 * https://github.com/luin/ioredis/blob/master/API.md#new-redisport-host-options
	 */
	options?: ClusterOptions | RedisOptions;
	/**
	 * 一个唯一的实例名称，用于在 Redis 中过滤消息。
	 * 如果未提供，则生成一个唯一的 ID。
	 */
	identifier: string;
	/**
	 * Redis 键的命名空间，如果未提供，则使用 'hocuspocus'
	 */
	prefix: string;
	/**
	 * Redis 锁的最大时间（在无法释放的情况下）
	 */
	lockTimeout: number;
	/**
	 * 在 onDisconnect 执行之前延迟的时间。
	 * 这允许在订阅关闭之前接收最后时刻的更新同步消息。
	 */
	disconnectDelay: number;
}

export class Redis implements Extension {
	/**
	 * 确保给该扩展一个更高的优先级，以便
	 * `onStoreDocument` 钩子能够拦截链，
	 * 在文档存储到数据库之前。
	 */
	priority = 1000;

	configuration: Configuration = {
		port: 6379,
		host: "127.0.0.1",
		prefix: "hocuspocus",
		identifier: `host-${uuid()}`,
		lockTimeout: 1000,
		disconnectDelay: 1000,
	};

	redisTransactionOrigin = "__hocuspocus__redis__origin__";

	pub: RedisInstance;

	sub: RedisInstance;

	instance!: Hocuspocus;

	redlock: Redlock;

	locks = new Map<string, Redlock.Lock>();

	messagePrefix: Buffer;

	/**
	 * 当我们对文档进行高频率的更新时，我们不需要堆积大量的 setTimeouts，因此我们会跟踪它们以保持每个文档的更新。
	 */
	private pendingDisconnects = new Map<string, NodeJS.Timeout>();

	private pendingAfterStoreDocumentResolves = new Map<
		string,
		{ timeout: NodeJS.Timeout; resolve: () => void }
	>();

	public constructor(configuration: Partial<Configuration>) {
		this.configuration = {
			...this.configuration,
			...configuration,
		};

		// 创建 Redis 实例
		const { port, host, options, nodes, redis, createClient } =
			this.configuration;

		if (typeof createClient === "function") {
			this.pub = createClient();
			this.sub = createClient();
		} else if (redis) {
			this.pub = redis.duplicate();
			this.sub = redis.duplicate();
		} else if (nodes && nodes.length > 0) {
			this.pub = new RedisClient.Cluster(nodes, options);
			this.sub = new RedisClient.Cluster(nodes, options);
		} else {
			this.pub = new RedisClient(port, host, options ?? {});
			this.sub = new RedisClient(port, host, options ?? {});
		}
		this.sub.on("messageBuffer", this.handleIncomingMessage);

		this.redlock = new Redlock([this.pub], {
			retryCount: 0,
		});

		const identifierBuffer = Buffer.from(
			this.configuration.identifier,
			"utf-8",
		);
		this.messagePrefix = Buffer.concat([
			Buffer.from([identifierBuffer.length]),
			identifierBuffer,
		]);
	}

	async onConfigure({ instance }: onConfigurePayload) {
		this.instance = instance;
	}

	private getKey(documentName: string) {
		return `${this.configuration.prefix}:${documentName}`;
	}

	private pubKey(documentName: string) {
		return this.getKey(documentName);
	}

	private subKey(documentName: string) {
		return this.getKey(documentName);
	}

	private lockKey(documentName: string) {
		return `${this.getKey(documentName)}:lock`;
	}

	private encodeMessage(message: Uint8Array) {
		return Buffer.concat([this.messagePrefix, Buffer.from(message)]);
	}

	private decodeMessage(buffer: Buffer) {
		const identifierLength = buffer[0];
		const identifier = buffer.toString("utf-8", 1, identifierLength + 1);

		return [identifier, buffer.slice(identifierLength + 1)];
	}

	/**
	 * 一旦文档加载，在 Redis 中订阅通道。
	 */
	public async afterLoadDocument({
		documentName,
		document,
	}: afterLoadDocumentPayload) {
		return new Promise((resolve, reject) => {
			// 在文档创建时，节点将连接到文档的 pub 和 sub 通道。
			this.sub.subscribe(this.subKey(documentName), async (error: any) => {
				if (error) {
					reject(error);
					return;
				}

				this.publishFirstSyncStep(documentName, document);
				this.requestAwarenessFromOtherInstances(documentName);

				resolve(undefined);
			});
		});
	}

	/**
	 * 通过 Redis 发布第一步同步。
	 */
	private async publishFirstSyncStep(documentName: string, document: Document) {
		const syncMessage = new OutgoingMessage(documentName)
			.createSyncMessage()
			.writeFirstSyncStepFor(document);

		return this.pub.publishBuffer(
			this.pubKey(documentName),
			this.encodeMessage(syncMessage.toUint8Array()),
		);
	}

	/**
	 * 让 Redis 询问谁已经连接。
	 */
	private async requestAwarenessFromOtherInstances(documentName: string) {
		const awarenessMessage = new OutgoingMessage(
			documentName,
		).writeQueryAwareness();

		return this.pub.publishBuffer(
			this.pubKey(documentName),
			this.encodeMessage(awarenessMessage.toUint8Array()),
		);
	}

	/**
	 * 在文档存储之前，确保在 Redis 中设置一个锁。
	 * 这是为了避免与其他实例尝试存储文档时发生冲突。
	 */
	async onStoreDocument({ documentName }: onStoreDocumentPayload) {
		// 尝试获取一个锁并从 Redis 读取 lastReceivedTimestamp，
		// 避免与其他实例存储相同文档时发生冲突。

		return new Promise((resolve, reject) => {
			this.redlock.lock(
				this.lockKey(documentName),
				this.configuration.lockTimeout,
				async (error, lock) => {
					if (error || !lock) {
						// 预期行为：无法获取锁，另一个实例已经锁定它。
						// 不会执行进一步的 `onStoreDocument` 钩子。
						console.log("unable to acquire lock");
						reject();
						return;
					}

					this.locks.set(this.lockKey(documentName), lock);

					resolve(undefined);
				},
			);
		});
	}

	/**
	 * 释放 Redis 锁，以便其他实例可以存储文档。
	 */
	async afterStoreDocument({
		documentName,
		socketId,
	}: afterStoreDocumentPayload) {
		this.locks
			.get(this.lockKey(documentName))
			?.unlock()
			.catch(() => {
				// 无法解锁 Redis。锁将在 ${lockTimeout} ms 后过期。
				// console.error(`无法解锁 Redis。锁将在 ${this.configuration.lockTimeout}ms.`)
			})
			.finally(() => {
				this.locks.delete(this.lockKey(documentName));
			});

		// 如果更改是由 directConnection 发起的，我们需要延迟此钩子，以确保同步可以首先完成。
		// 对于 provider 连接，这通常在 onDisconnect 钩子中发生
		if (socketId === "server") {
			const pending = this.pendingAfterStoreDocumentResolves.get(documentName);

			if (pending) {
				clearTimeout(pending.timeout);
				pending.resolve();
				this.pendingAfterStoreDocumentResolves.delete(documentName);
			}

			let resolveFunction: () => void = () => {};
			const delayedPromise = new Promise<void>((resolve) => {
				resolveFunction = resolve;
			});

			const timeout = setTimeout(() => {
				this.pendingAfterStoreDocumentResolves.delete(documentName);
				resolveFunction();
			}, this.configuration.disconnectDelay);

			this.pendingAfterStoreDocumentResolves.set(documentName, {
				timeout,
				resolve: resolveFunction,
			});

			await delayedPromise;
		}
	}

	/**
	 * 处理由该 Hocuspocus 实例直接接收的意识更新消息。
	 */
	async onAwarenessUpdate({
		documentName,
		awareness,
		added,
		updated,
		removed,
	}: onAwarenessUpdatePayload) {
		const changedClients = added.concat(updated, removed);
		const message = new OutgoingMessage(
			documentName,
		).createAwarenessUpdateMessage(awareness, changedClients);

		return this.pub.publishBuffer(
			this.pubKey(documentName),
			this.encodeMessage(message.toUint8Array()),
		);
	}

	/**
	 * 处理在订阅的文档通道上发布的传入消息。
	 * 请注意，这也会包括来自我们自己的消息，因为不可能在 Redis 中过滤这些消息。
	 */
	private handleIncomingMessage = async (channel: Buffer, data: Buffer) => {
		const [identifier, messageBuffer] = this.decodeMessage(data);

		if (identifier === this.configuration.identifier) {
			return;
		}

		const message = new IncomingMessage(messageBuffer);
		const documentName = message.readVarString();
		message.writeVarString(documentName);

		const document = this.instance.documents.get(documentName);

		if (!document) {
			return;
		}

		new MessageReceiver(message, this.redisTransactionOrigin).apply(
			document,
			undefined,
			(reply) => {
				return this.pub.publishBuffer(
					this.pubKey(document.name),
					this.encodeMessage(reply),
				);
			},
		);
	};

	/**
	 * 如果 ydoc 更改，我们需要通知其他 Hocuspocus 服务器。
	 */
	public async onChange(data: onChangePayload): Promise<any> {
		if (data.transactionOrigin !== this.redisTransactionOrigin) {
			return this.publishFirstSyncStep(data.documentName, data.document);
		}
	}

	/**
	 * 确保在没有人连接时不再监听进一步的更改。
	 */
	public onDisconnect = async ({ documentName }: onDisconnectPayload) => {
		const pending = this.pendingDisconnects.get(documentName);

		if (pending) {
			clearTimeout(pending);
			this.pendingDisconnects.delete(documentName);
		}

		const disconnect = () => {
			const document = this.instance.documents.get(documentName);

			this.pendingDisconnects.delete(documentName);

			// 当其他用户仍连接到文档时，什么都不做。
			if (!document || document.getConnectionsCount() > 0) {
				return;
			}

			// 是时候结束文档通道上的订阅了。
			this.sub.unsubscribe(this.subKey(documentName), (error: any) => {
				if (error) {
					console.error(error);
				}
			});

			this.instance.unloadDocument(document);
		};
		// 延迟断开连接过程，以允许最后时刻的同步发生
		const timeout = setTimeout(disconnect, this.configuration.disconnectDelay);
		this.pendingDisconnects.set(documentName, timeout);
	};

	async beforeBroadcastStateless(data: beforeBroadcastStatelessPayload) {
		const message = new OutgoingMessage(
			data.documentName,
		).writeBroadcastStateless(data.payload);

		return this.pub.publishBuffer(
			this.pubKey(data.documentName),
			this.encodeMessage(message.toUint8Array()),
		);
	}

	/**
	 * 立即杀死 Redlock 连接。
	 */
	async onDestroy() {
		await this.redlock.quit();
		this.pub.disconnect(false);
		this.sub.disconnect(false);
	}
}
