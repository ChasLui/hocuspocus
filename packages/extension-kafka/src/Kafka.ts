import type {
  Document,
  Extension,
  Hocuspocus,
  afterLoadDocumentPayload,
  beforeBroadcastStatelessPayload,
  onAwarenessUpdatePayload,
  onChangePayload,
  onConfigurePayload,
  onDisconnectPayload,
  onStoreDocumentPayload,
  afterStoreDocumentPayload,
} from "@hocuspocus/server";
import { IncomingMessage, MessageReceiver, OutgoingMessage } from "@hocuspocus/server";
import { Kafka as KafkaJS, type Consumer, type Producer, type KafkaConfig, logLevel } from "kafkajs";
import { v4 as uuid } from "uuid";

export interface KafkaConfiguration {
  kafka: KafkaConfig & { brokers: string[] };
  identifier?: string;
  prefix?: string;
  groupIdBase?: string;
  disconnectDelay?: number;
  lockTimeout?: number;
}

export class Kafka implements Extension {
  priority = 1000;

  private configuration: Required<Omit<KafkaConfiguration, "kafka">> & { identifier: string };
  private instance!: Hocuspocus;

  private kafka: KafkaJS;
  private producer!: Producer;
  private consumer!: Consumer;

  private kafkaTransactionOrigin = "__hocuspocus__kafka__origin__";

  private pendingDisconnects = new Map<string, NodeJS.Timeout>();
  private pendingAfterStoreDocumentResolves = new Map<string, { timeout: NodeJS.Timeout; resolve: () => void }>();

  private locksTopic!: string;
  private currentLockByDocument = new Map<string, { owner: string; expiresAt: number }>();

  constructor(config: KafkaConfiguration) {
    const identifier = config.identifier ?? `host-${uuid()}`;
    const prefix = config.prefix ?? "hocuspocus";
    const groupIdBase = config.groupIdBase ?? "hocuspocus";
    const disconnectDelay = config.disconnectDelay ?? 1000;
    const lockTimeout = config.lockTimeout ?? 1000;
    this.configuration = {
      identifier,
      prefix,
      groupIdBase,
      disconnectDelay,
      lockTimeout,
    } as Required<Omit<KafkaConfiguration, "kafka">> & { identifier: string };

    this.kafka = new KafkaJS({
      clientId: identifier,
      logLevel: logLevel.NOTHING,
      ...config.kafka,
    });
  }

  async onConfigure({ instance }: onConfigurePayload) {
    this.instance = instance;

    this.producer = this.kafka.producer({ allowAutoTopicCreation: true });
    this.consumer = this.kafka.consumer({
      groupId: `${this.configuration.groupIdBase}-${this.configuration.identifier}`,
      allowAutoTopicCreation: true,
    });

    await this.producer.connect();
    await this.consumer.connect();

    const topicRegex = new RegExp(`^${this.escapeRegex(this.configuration.prefix)}\\.`);
    await this.consumer.subscribe({ topic: topicRegex, fromBeginning: false });

    this.locksTopic = `${this.configuration.prefix}.__locks`;
    await this.consumer.subscribe({ topic: this.locksTopic, fromBeginning: false });

    await this.consumer.run({
      autoCommit: true,
      eachMessage: async ({ topic, message }) => {
        if (!message.value) return;
        if (topic === this.locksTopic) {
          this.handleLockMessage(message);
          return;
        }

        const [identifier, payload] = this.decodeMessage(message.value);
        if (identifier === this.configuration.identifier) return;

        const documentName = topic.substring(this.configuration.prefix.length + 1);
        const incoming = new IncomingMessage(payload);
        try {
          // Advance decoder past the document name if present
          incoming.readVarString();
        } catch {}
        // Always set the correct document name for replies
        incoming.writeVarString(documentName);

        const document = this.instance.documents.get(documentName);
        if (!document) return;

        new MessageReceiver(incoming, this.kafkaTransactionOrigin).apply(
          document,
          undefined,
          (reply) => this.publishRaw(documentName, reply),
        );
      },
    });
  }

  private escapeRegex(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private topic(documentName: string) {
    return `${this.configuration.prefix}.${documentName}`;
  }

  private encodeMessage(message: Uint8Array) {
    const identifierBuffer = Buffer.from(this.configuration.identifier, "utf-8");
    const prefix = Buffer.from([identifierBuffer.length]);
    return Buffer.concat([prefix, identifierBuffer, Buffer.from(message)]);
  }

  private decodeMessage(buffer: Buffer) {
    const identifierLength = buffer[0];
    const identifier = buffer.toString("utf-8", 1, identifierLength + 1);
    return [identifier, buffer.slice(identifierLength + 1)] as const;
  }

  private async publishRaw(documentName: string, reply: Uint8Array) {
    const value = this.encodeMessage(reply);
    await this.producer.send({
      topic: this.topic(documentName),
      messages: [{ key: documentName, value }],
    });
  }

  private async publishFirstSyncStep(documentName: string, document: Document) {
    const syncMessage = new OutgoingMessage(documentName)
      .createSyncMessage()
      .writeFirstSyncStepFor(document);
    await this.publishRaw(documentName, syncMessage.toUint8Array());
  }

  private async requestAwarenessFromOtherInstances(documentName: string) {
    const awarenessMessage = new OutgoingMessage(documentName).writeQueryAwareness();
    await this.publishRaw(documentName, awarenessMessage.toUint8Array());
  }

  async afterLoadDocument({ documentName, document }: afterLoadDocumentPayload) {
    await this.publishFirstSyncStep(documentName, document);
    await this.requestAwarenessFromOtherInstances(documentName);
  }

  async onStoreDocument({ documentName }: onStoreDocumentPayload) {
    await this.acquireLock(documentName);
  }

  async afterStoreDocument({ documentName, socketId }: afterStoreDocumentPayload) {
    await this.releaseLock(documentName);
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
      this.pendingAfterStoreDocumentResolves.set(documentName, { timeout, resolve: resolveFunction });
      await delayedPromise;
    }
  }

  async onAwarenessUpdate({ documentName, awareness, added, updated, removed }: onAwarenessUpdatePayload) {
    const changedClients = added.concat(updated, removed);
    const message = new OutgoingMessage(documentName).createAwarenessUpdateMessage(awareness, changedClients);
    await this.publishRaw(documentName, message.toUint8Array());
  }

  async onChange(data: onChangePayload) {
    if (data.transactionOrigin !== this.kafkaTransactionOrigin) {
      await this.publishFirstSyncStep(data.documentName, data.document);
    }
  }

  async onDisconnect({ documentName }: onDisconnectPayload) {
    const pending = this.pendingDisconnects.get(documentName);
    if (pending) {
      clearTimeout(pending);
      this.pendingDisconnects.delete(documentName);
    }
    const disconnect = () => {
      const document = this.instance.documents.get(documentName);
      this.pendingDisconnects.delete(documentName);
      if (document && document.getConnectionsCount() > 0) return;
      if (document) this.instance.unloadDocument(document);
    };
    const timeout = setTimeout(disconnect, this.configuration.disconnectDelay);
    this.pendingDisconnects.set(documentName, timeout);
  }

  async beforeBroadcastStateless(data: beforeBroadcastStatelessPayload) {
    const message = new OutgoingMessage(data.documentName).writeBroadcastStateless(data.payload);
    await this.publishRaw(data.documentName, message.toUint8Array());
  }

  async onDestroy() {
    try { await this.consumer.disconnect(); } catch {}
    try { await this.producer.disconnect(); } catch {}
  }

  private lockKey(documentName: string) {
    return `${this.configuration.prefix}:${documentName}`;
  }

  private async acquireLock(documentName: string) {
    const key = this.lockKey(documentName);
    const owner = this.configuration.identifier;
    const requestId = uuid();
    const now = Date.now();
    const expiresAt = now + this.configuration.lockTimeout;
    await this.producer.send({
      topic: this.getLocksTopic(documentName),
      messages: [{ key, value: Buffer.from(JSON.stringify({ type: "LOCK_REQUEST", key, owner, requestId, ts: now, ttl: this.configuration.lockTimeout })) }],
    });
    const timeoutAt = now + this.configuration.lockTimeout;
    while (Date.now() < timeoutAt) {
      const lock = this.currentLockByDocument.get(key);
      const now2 = Date.now();
      if (!lock || lock.expiresAt <= now2) {
        this.currentLockByDocument.set(key, { owner, expiresAt });
        return;
      }
      if (lock.owner === owner) {
        lock.expiresAt = expiresAt;
        return;
      }
      await this.sleep(20);
    }
  }

  private async releaseLock(documentName: string) {
    const key = this.lockKey(documentName);
    const owner = this.configuration.identifier;
    await this.producer.send({
      topic: this.getLocksTopic(documentName),
      messages: [{ key, value: Buffer.from(JSON.stringify({ type: "LOCK_RELEASE", key, owner, ts: Date.now() })) }],
    });
    const lock = this.currentLockByDocument.get(key);
    if (lock && lock.owner === owner) {
      this.currentLockByDocument.delete(key);
    }
  }

  private handleLockMessage(message: { key: Buffer | null; value: Buffer | null }) {
    if (!message.value || !message.key) return;
    try {
      const key = message.key.toString();
      const content = JSON.parse(message.value.toString());
      const now = Date.now();
      if (content.type === "LOCK_REQUEST") {
        const existing = this.currentLockByDocument.get(key);
        if (!existing || existing.expiresAt <= now) {
          this.currentLockByDocument.set(key, { owner: content.owner, expiresAt: now + (content.ttl ?? this.configuration.lockTimeout) });
        }
      } else if (content.type === "LOCK_RELEASE") {
        const existing = this.currentLockByDocument.get(key);
        if (existing && existing.owner === content.owner) {
          this.currentLockByDocument.delete(key);
        }
      }
    } catch {}
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  private getLocksTopic(_documentName: string) {
    return this.locksTopic;
  }
}


