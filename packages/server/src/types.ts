import type {
  IncomingHttpHeaders, IncomingMessage, ServerResponse,
} from 'http'
import type { URLSearchParams } from 'url'
import type { Awareness } from 'y-protocols/awareness'
import type Connection from './Connection.ts'
import type Document from './Document.ts'
import type { Hocuspocus } from './Hocuspocus.ts'

export enum MessageType {
  Unknown = -1,
  Sync = 0,
  Awareness = 1,
  Auth = 2,
  QueryAwareness = 3,
  SyncReply = 4, // 与 Sync 相同，但不会触发另一个 'SyncStep1'
  Stateless = 5,
  BroadcastStateless = 6,
  CLOSE = 7,
  SyncStatus = 8,
}

export interface AwarenessUpdate {
  added: Array<any>,
  updated: Array<any>,
  removed: Array<any>,
}

export interface ConnectionConfiguration {
  readOnly: boolean
  isAuthenticated: boolean
}

export interface Extension {
  priority?: number;
  extensionName?: string;
  onConfigure?(data: onConfigurePayload): Promise<any>;
  onListen?(data: onListenPayload): Promise<any>;
  onUpgrade?(data: onUpgradePayload): Promise<any>;
  onConnect?(data: onConnectPayload): Promise<any>;
  connected?(data: connectedPayload): Promise<any>;
  onAuthenticate?(data: onAuthenticatePayload): Promise<any>;
  onCreateDocument?(data: onCreateDocumentPayload): Promise<any>;
  onLoadDocument?(data: onLoadDocumentPayload): Promise<any>;
  afterLoadDocument?(data: afterLoadDocumentPayload): Promise<any>;
  beforeHandleMessage?(data: beforeHandleMessagePayload): Promise<any>;
  beforeSync?(data: beforeSyncPayload): Promise<any>;
  beforeBroadcastStateless?(data: beforeBroadcastStatelessPayload): Promise<any>;
  onStateless?(payload: onStatelessPayload): Promise<any>;
  onChange?(data: onChangePayload): Promise<any>;
  onStoreDocument?(data: onStoreDocumentPayload): Promise<any>;
  afterStoreDocument?(data: afterStoreDocumentPayload): Promise<any>;
  onAwarenessUpdate?(data: onAwarenessUpdatePayload): Promise<any>;
  onRequest?(data: onRequestPayload): Promise<any>;
  onDisconnect?(data: onDisconnectPayload): Promise<any>;
  beforeUnloadDocument?(data: beforeUnloadDocumentPayload): Promise<any>;
  afterUnloadDocument?(data: afterUnloadDocumentPayload): Promise<any>;
  onDestroy?(data: onDestroyPayload): Promise<any>;
}

export type HookName =
  'onConfigure' |
  'onListen' |
  'onUpgrade' |
  'onConnect' |
  'connected' |
  'onAuthenticate' |
  'onCreateDocument' |
  'onLoadDocument' |
  'afterLoadDocument' |
  'beforeHandleMessage' |
  'beforeBroadcastStateless' |
  'beforeSync' |
  'onStateless' |
  'onChange' |
  'onStoreDocument' |
  'afterStoreDocument' |
  'onAwarenessUpdate' |
  'onRequest' |
  'onDisconnect' |
  'beforeUnloadDocument' |
  'afterUnloadDocument' |
  'onDestroy'

export type HookPayloadByName = {
  onConfigure: onConfigurePayload,
  onListen: onListenPayload,
  onUpgrade: onUpgradePayload,
  onConnect: onConnectPayload,
  connected: connectedPayload,
  onAuthenticate: onAuthenticatePayload,
  onCreateDocument: onCreateDocumentPayload
  onLoadDocument: onLoadDocumentPayload,
  afterLoadDocument: afterLoadDocumentPayload,
  beforeHandleMessage: beforeHandleMessagePayload,
  beforeBroadcastStateless: beforeBroadcastStatelessPayload,
  beforeSync: beforeSyncPayload,
  onStateless: onStatelessPayload,
  onChange: onChangePayload,
  onStoreDocument: onStoreDocumentPayload,
  afterStoreDocument: afterStoreDocumentPayload,
  onAwarenessUpdate: onAwarenessUpdatePayload,
  onRequest: onRequestPayload,
  onDisconnect: onDisconnectPayload,
  afterUnloadDocument: afterUnloadDocumentPayload,
  beforeUnloadDocument: beforeUnloadDocumentPayload,
  onDestroy: onDestroyPayload,
}

export interface Configuration extends Extension {
  /**
   * 实例的名称，用于日志记录。
   */
  name: string | null,
  /**
   * 一个 hocuspocus 扩展列表。
   */
  extensions: Array<Extension>,
  /**
   * 定义服务器在哪个时间间隔发送一个 ping，并在没有 pong 返回时关闭连接。
   */
  timeout: number,
  /**
   * 对 `onStoreDocument` 钩子进行防抖处理，给定的时间间隔为 ms。
   * 否则每次更新都会被持久化。
   */
  debounce: number,
  /**
   * 确保至少在给定的时间间隔内调用 `onStoreDocument` (ms)。
   */
  maxDebounce: number
  /**
   * 默认情况下，服务器会显示一个启动屏幕。如果传递 false，服务器将静默启动。
   */
  quiet: boolean,
  /**
   * 如果设置为 false，在卸载文档之前会尊重 `onStoreDocument` 的防抖时间。
   * 否则，文档将立即卸载。
   *
   * 这可以防止客户端通过反复连接和断开连接来对服务器进行 DOS 攻击，当你的 `onStoreDocument` 被速率限制时。
   */
  unloadImmediately: boolean,

  /**
   * 传递给 ydoc 文档的选项。
   */
  yDocOptions: {
    gc: boolean, // 启用或禁用垃圾回收（请参阅 https://github.com/yjs/yjs/blob/main/INTERNALS.md#deletions）
    gcFilter: () => boolean, // 在垃圾回收之前会被调用；返回 false 以保留它
  },

}

export interface onStatelessPayload {
  connection: Connection,
  documentName: string,
  document: Document,
  payload: string,
}


export interface onAuthenticatePayload {
  context: any,
  documentName: string,
  instance: Hocuspocus,
  requestHeaders: IncomingHttpHeaders,
  requestParameters: URLSearchParams,
  request: IncomingMessage,
  socketId: string,
  token: string,
  connectionConfig: ConnectionConfiguration
}

export interface onCreateDocumentPayload {
  context: any
  documentName: string
  instance: Hocuspocus
  requestHeaders: IncomingHttpHeaders
  requestParameters: URLSearchParams
  socketId: string
  connectionConfig: ConnectionConfiguration
}

export interface onConnectPayload {
  context: any,
  documentName: string,
  instance: Hocuspocus,
  request: IncomingMessage,
  requestHeaders: IncomingHttpHeaders,
  requestParameters: URLSearchParams,
  socketId: string,
  connectionConfig: ConnectionConfiguration
}

export interface connectedPayload {
  context: any,
  documentName: string,
  instance: Hocuspocus,
  request: IncomingMessage,
  requestHeaders: IncomingHttpHeaders,
  requestParameters: URLSearchParams,
  socketId: string,
  connectionConfig: ConnectionConfiguration,
  connection: Connection
}

export interface onLoadDocumentPayload {
  context: any,
  document: Document,
  documentName: string,
  instance: Hocuspocus,
  requestHeaders: IncomingHttpHeaders,
  requestParameters: URLSearchParams,
  socketId: string,
  connectionConfig: ConnectionConfiguration
}

export interface afterLoadDocumentPayload {
  context: any,
  document: Document,
  documentName: string,
  instance: Hocuspocus,
  requestHeaders: IncomingHttpHeaders,
  requestParameters: URLSearchParams,
  socketId: string,
  connectionConfig: ConnectionConfiguration
}

export interface onChangePayload {
  clientsCount: number,
  context: any,
  document: Document,
  documentName: string,
  instance: Hocuspocus,
  requestHeaders: IncomingHttpHeaders,
  requestParameters: URLSearchParams,
  update: Uint8Array,
  socketId: string,
  transactionOrigin: any,
}

export interface beforeHandleMessagePayload {
  clientsCount: number,
  context: any,
  document: Document,
  documentName: string,
  instance: Hocuspocus,
  requestHeaders: IncomingHttpHeaders,
  requestParameters: URLSearchParams,
  update: Uint8Array,
  socketId: string,
  connection: Connection
}

export interface beforeSyncPayload {
  clientsCount: number,
  context: any,
  document: Document,
  documentName: string,
  connection: Connection,
  /**
   * y-protocols/sync 消息类型
   * @example
   * 0: SyncStep1
   * 1: SyncStep2
   * 2: YjsUpdate
   *
   * @see https://github.com/yjs/y-protocols/blob/master/sync.js#L13-L40
   */
  type: number,
  /**
   * y-sync 消息的 payload。
   */
  payload: Uint8Array,
}

export interface beforeBroadcastStatelessPayload {
  document: Document,
  documentName: string,
  payload: string,
}

export interface onStoreDocumentPayload {
  clientsCount: number,
  context: any,
  document: Document,
  documentName: string,
  instance: Hocuspocus,
  requestHeaders: IncomingHttpHeaders,
  requestParameters: URLSearchParams,
  socketId: string,
  transactionOrigin?: any,
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type
export interface afterStoreDocumentPayload extends onStoreDocumentPayload {}

export interface onAwarenessUpdatePayload {
  context: any,
  document: Document,
  documentName: string,
  instance: Hocuspocus,
  requestHeaders: IncomingHttpHeaders,
  requestParameters: URLSearchParams,
  socketId: string,
  added: number[],
  updated: number[],
  removed: number[],
  awareness: Awareness,
  states: StatesArray,
}

export type StatesArray = { clientId: number, [key: string | number]: any }[]

export interface fetchPayload {
  context: any,
  document: Document,
  documentName: string,
  instance: Hocuspocus,
  requestHeaders: IncomingHttpHeaders,
  requestParameters: URLSearchParams,
  socketId: string,
  connectionConfig: ConnectionConfiguration
}

export interface storePayload extends onStoreDocumentPayload {
  state: Buffer,
}

export interface onDisconnectPayload {
  clientsCount: number,
  context: any,
  document: Document,
  documentName: string,
  instance: Hocuspocus,
  requestHeaders: IncomingHttpHeaders,
  requestParameters: URLSearchParams,
  socketId: string,
}

export interface onRequestPayload {
  request: IncomingMessage,
  response: ServerResponse,
  instance: Hocuspocus,
}

export interface onUpgradePayload {
  request: IncomingMessage,
  socket: any,
  head: any,
  instance: Hocuspocus,
}

export interface onListenPayload {
  instance: Hocuspocus,
  configuration: Configuration,
  port: number,
}

export interface onDestroyPayload {
  instance: Hocuspocus,
}

export interface onConfigurePayload {
  instance: Hocuspocus,
  configuration: Configuration,
  version: string,
}

export interface afterUnloadDocumentPayload {
  instance: Hocuspocus;
  documentName: string;
}

export interface beforeUnloadDocumentPayload {
  instance: Hocuspocus;
  documentName: string;
}

export interface DirectConnection {
  transact(transaction: (document: Document) => void): Promise<void>,
  disconnect(): void
}
