import type { IncomingMessage } from 'http'
import {
  ResetConnection, awarenessStatesToArray,
} from '@hocuspocus/common'
import { v4 as uuid } from 'uuid'
import type WebSocket from 'ws'
import type { Doc } from 'yjs'
import { applyUpdate, encodeStateAsUpdate } from 'yjs'
import meta from '../package.json' assert { type: 'json' }
import { ClientConnection } from './ClientConnection.ts'
import type Connection from './Connection.ts'
import { DirectConnection } from './DirectConnection.ts'
import Document from './Document.ts'
import type { Server } from './Server.ts'
import type {
  AwarenessUpdate,
  Configuration,
  ConnectionConfiguration,
  HookName,
  HookPayloadByName,
  beforeBroadcastStatelessPayload,
  onChangePayload,
  onDisconnectPayload,
  onStoreDocumentPayload,
} from './types.ts'
import { useDebounce } from './util/debounce.ts'
import { getParameters } from './util/getParameters.ts'

export const defaultConfiguration = {
  name: null,
  timeout: 30000,
  debounce: 2000,
  maxDebounce: 10000,
  quiet: false,
  yDocOptions: {
    gc: true,
    gcFilter: () => true,
  },
  unloadImmediately: true,
}

export class Hocuspocus {
  configuration: Configuration = {
    ...defaultConfiguration,
    extensions: [],
    onConfigure: () => new Promise(r => r(null)),
    onListen: () => new Promise(r => r(null)),
    onUpgrade: () => new Promise(r => r(null)),
    onConnect: () => new Promise(r => r(null)),
    connected: () => new Promise(r => r(null)),
    beforeHandleMessage: () => new Promise(r => r(null)),
    beforeSync: () => new Promise(r => r(null)),
    beforeBroadcastStateless: () => new Promise(r => r(null)),
    onStateless: () => new Promise(r => r(null)),
    onChange: () => new Promise(r => r(null)),
    onCreateDocument: () => new Promise(r => r(null)),
    onLoadDocument: () => new Promise(r => r(null)),
    onStoreDocument: () => new Promise(r => r(null)),
    afterStoreDocument: () => new Promise(r => r(null)),
    onAwarenessUpdate: () => new Promise(r => r(null)),
    onRequest: () => new Promise(r => r(null)),
    onDisconnect: () => new Promise(r => r(null)),
    onDestroy: () => new Promise(r => r(null)),
  }

  loadingDocuments: Map<string, Promise<Document>> = new Map()

  documents: Map<string, Document> = new Map()

  server?: Server

  debouncer = useDebounce()

  constructor(configuration?: Partial<Configuration>) {
    if (configuration) {
      this.configure(configuration)
    }
  }

  /**
   * Configure Hocuspocus
   */
  configure(configuration: Partial<Configuration>): Hocuspocus {
    this.configuration = {
      ...this.configuration,
      ...configuration,
    }

    this.configuration.extensions.sort((a, b) => {
      const one = typeof a.priority === 'undefined' ? 100 : a.priority
      const two = typeof b.priority === 'undefined' ? 100 : b.priority

      if (one > two) {
        return -1
      }

      if (one < two) {
        return 1
      }

      return 0
    })

    this.configuration.extensions.push({
      onConfigure: this.configuration.onConfigure,
      onListen: this.configuration.onListen,
      onUpgrade: this.configuration.onUpgrade,
      onConnect: this.configuration.onConnect,
      connected: this.configuration.connected,
      onAuthenticate: this.configuration.onAuthenticate,
      onLoadDocument: this.configuration.onLoadDocument,
      afterLoadDocument: this.configuration.afterLoadDocument,
      beforeHandleMessage: this.configuration.beforeHandleMessage,
      beforeBroadcastStateless: this.configuration.beforeBroadcastStateless,
      beforeSync: this.configuration.beforeSync,
      onStateless: this.configuration.onStateless,
      onChange: this.configuration.onChange,
      onStoreDocument: this.configuration.onStoreDocument,
      afterStoreDocument: this.configuration.afterStoreDocument,
      onAwarenessUpdate: this.configuration.onAwarenessUpdate,
      onRequest: this.configuration.onRequest,
      afterUnloadDocument: this.configuration.afterUnloadDocument,
      onDisconnect: this.configuration.onDisconnect,
      onDestroy: this.configuration.onDestroy,
    })

    this.hooks('onConfigure', {
      configuration: this.configuration,
      version: meta.version,
      instance: this,
    })

    return this
  }

  /**
   * 获取活动文档的总数
   */
  getDocumentsCount(): number {
    return this.documents.size
  }

  /**
   * 获取活动连接的总数
   */
  getConnectionsCount(): number {
    const uniqueSocketIds = new Set<string>()
    const totalDirectConnections = Array.from(this.documents.values()).reduce((acc, document) => {
      // 累积唯一的 socket ID
      document.getConnections().forEach(({ socketId }) => {
        uniqueSocketIds.add(socketId)
      })
      // 累积直接连接
      return acc + document.directConnectionsCount
    }, 0)
    // 返回唯一 socket ID 和直接连接的总和
    return uniqueSocketIds.size + totalDirectConnections
  }

  /**
   * 强制关闭一个或多个连接
   */
  closeConnections(documentName?: string) {
    // 遍历所有文档的所有连接
    // 并调用它们的 close 方法，这是一个优雅的
    // 在底层 websocket.close 周围的断开连接包装器
    this.documents.forEach((document: Document) => {
      // 如果指定了 documentName，则如果它不匹配，则跳过
      if (documentName && document.name !== documentName) {
        return
      }

      document.connections.forEach(({ connection }) => {
        connection.close(ResetConnection)
      })
    })
  }

  /**
   * `handleConnection` 方法接收传入的 WebSocket 连接，
   * 运行所有钩子：
   *
   *  - 为所有连接运行 onConnect
   *  - 仅在需要时运行 onAuthenticate
   *
   * … 如果没有任何失败，它将完全建立连接并
   * 加载文档。
   */
  handleConnection(incoming: WebSocket, request: IncomingMessage, defaultContext: any = {}): void {
    const clientConnection = new ClientConnection(incoming, request, this, this.hooks.bind(this), {
      timeout: this.configuration.timeout,
    }, defaultContext)
    clientConnection.onClose((document: Document, hookPayload: onDisconnectPayload) => {
      // 检查文档是否仍有连接，因为这些钩子
      // 可能需要一些时间来解决（例如数据库查询）。如果在此期间有新的连接，
      // 它将依赖于我们现在删除的文档。
      if (document.getConnectionsCount() > 0) {
        return
      }

      // 如果这是最后一个连接，我们需要确保存储文档。
      // 使用 debouncer 立即执行 helper，以运行计划
      // onStoreDocument 并清除运行计时器。
      // 如果此文档没有计划运行，则没有必要触发 onStoreDocument 钩子，因为一切都似乎已经存储了。
      // 仅在文档之前完成加载时运行此操作（即没有持久化空
      // ydoc 如果 onLoadDocument 钩子返回错误）
      if (!document.isLoading && this.debouncer.isDebounced(`onStoreDocument-${document.name}`)) {
        if (this.configuration.unloadImmediately) {
          this.debouncer.executeNow(`onStoreDocument-${document.name}`)
        }
      } else {
        // 立即从内存中删除文档
        this.unloadDocument(document)
      }
    })
  }

  /**
   * 处理给定文档的更新
   *
   * "connection" 不一定是类型 "Connection"，它是 Yjs 的 "origin"（如果更新来自提供者，则它是 "Connection"，但如果更新来自扩展，则可以是任何东西）。
   */
  private async handleDocumentUpdate(document: Document, connection: Connection | undefined, update: Uint8Array, request?: IncomingMessage) {
    const hookPayload: onChangePayload | onStoreDocumentPayload = {
      instance: this,
      clientsCount: document.getConnectionsCount(),
      context: connection?.context || {},
      document,
      documentName: document.name,
      requestHeaders: request?.headers ?? {},
      requestParameters: getParameters(request),
      socketId: connection?.socketId ?? '',
      update,
      transactionOrigin: connection,
    }

    this.hooks('onChange', hookPayload)

    // 如果更新是通过除 WebSocket 连接之外的方式接收的，
    // 我们不需要对此负责。
    // 也忽略通过 redis 连接接收到的更新，因为这将是一个破坏性的变化 (#730, #696, #606)
    if (!connection || (connection as unknown as string) === '__hocuspocus__redis__origin__') {
      return
    }

    await this.storeDocumentHooks(document, hookPayload)
  }

  /**
   * 通过给定的请求创建一个新文档
   */
  public async createDocument(documentName: string, request: Partial<Pick<IncomingMessage, 'headers' | 'url'>>, socketId: string, connection: ConnectionConfiguration, context?: any): Promise<Document> {
    const existingLoadingDoc = this.loadingDocuments.get(documentName)

    if (existingLoadingDoc) {
      return existingLoadingDoc
    }

    const existingDoc = this.documents.get(documentName)
    if (existingDoc) {
      return Promise.resolve(existingDoc)
    }

    const loadDocPromise = this.loadDocument(documentName, request, socketId, connection, context)

    this.loadingDocuments.set(documentName, loadDocPromise)

    try {
      await loadDocPromise
      this.loadingDocuments.delete(documentName)
    } catch (e) {
      this.loadingDocuments.delete(documentName)
      throw e
    }

    return loadDocPromise
  }

  async loadDocument(documentName: string, request: Partial<Pick<IncomingMessage, 'headers' | 'url'>>, socketId: string, connectionConfig: ConnectionConfiguration, context?: any): Promise<Document> {
    const requestHeaders = request.headers ?? {}
    const requestParameters = getParameters(request)

    const yDocOptions = await this.hooks('onCreateDocument', {
      documentName,
      requestHeaders,
      requestParameters,
      connectionConfig,
      context,
      socketId,
      instance: this,
    })

    const document = new Document(documentName, {
      ...this.configuration.yDocOptions,
      ...yDocOptions,
    })
    this.documents.set(documentName, document)

    const hookPayload = {
      instance: this,
      context,
      connectionConfig,
      document,
      documentName,
      socketId,
      requestHeaders,
      requestParameters,
    }

    try {
      await this.hooks('onLoadDocument', hookPayload, (loadedDocument: Doc | undefined) => {
        // 如果一个钩子返回一个 Y-Doc，将文档状态编码为更新
        // 并将其应用到新创建的文档
        // 注意：instanceof 不起作用，因为 Doc !== Doc 出于某种原因我不理解
        if (
          loadedDocument?.constructor.name === 'Document'
          || loadedDocument?.constructor.name === 'Doc'
        ) {
          applyUpdate(document, encodeStateAsUpdate(loadedDocument))
        }
      })
    } catch (e) {
      this.closeConnections(documentName)
      this.unloadDocument(document)
      throw e
    }

    document.isLoading = false
    await this.hooks('afterLoadDocument', hookPayload)

    document.onUpdate((document: Document, connection: Connection, update: Uint8Array) => {
      this.handleDocumentUpdate(document, connection, update, connection?.request)
    })

    document.beforeBroadcastStateless((document: Document, stateless: string) => {
      const hookPayload: beforeBroadcastStatelessPayload = {
        document,
        documentName: document.name,
        payload: stateless,
      }

      this.hooks('beforeBroadcastStateless', hookPayload)
    })

    document.awareness.on('update', (update: AwarenessUpdate) => {
      this.hooks('onAwarenessUpdate', {
        ...hookPayload,
        ...update,
        awareness: document.awareness,
        states: awarenessStatesToArray(document.awareness.getStates()),
      })
    })

    return document
  }

  storeDocumentHooks(document: Document, hookPayload: onStoreDocumentPayload, immediately?: boolean) {
    return this.debouncer.debounce(
      `onStoreDocument-${document.name}`,
      () => {
        return this.hooks('onStoreDocument', hookPayload)
          .then(() => {
            this.hooks('afterStoreDocument', hookPayload).then(async () => {
              // 从内存中删除文档。

              if (document.getConnectionsCount() > 0) {
                return
              }

              await this.unloadDocument(document)
            })
          })
          .catch(error => {
            console.error('Caught error during storeDocumentHooks', error)

            if (error?.message) {
              throw error
            }
          })
      },
      immediately ? 0 : this.configuration.debounce,
      this.configuration.maxDebounce,
    )

  }

  /**
   * 在所有配置的扩展上运行给定的钩子。
   * 在每个钩子之后运行给定的回调。
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  hooks<T extends HookName>(name: T, payload: HookPayloadByName[T], callback: Function | null = null): Promise<any> {
    const { extensions } = this.configuration

    // 创建一个新的 `thenable` 链
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/resolve
    let chain = Promise.resolve()

    extensions
      // 获取所有具有给定钩子的扩展
      .filter(extension => typeof extension[name] === 'function')
      // 通过所有配置的钩子运行
      .forEach(extension => {
        chain = chain
          .then(() => (extension[name] as any)?.(payload))
          .catch(error => {
            // 确保记录错误消息
            if (error?.message) {
              console.error(`[${name}]`, error.message)
            }

            throw error
          })

        if (callback) {
          chain = chain.then((...args: any[]) => callback(...args))
        }
      })

    return chain
  }

  async unloadDocument(document: Document): Promise<any> {
    const documentName = document.name
    if (!this.documents.has(documentName)) return

    await this.hooks('beforeUnloadDocument', { instance: this, documentName })

    if (document.getConnectionsCount() > 0) {
      return
    }

    this.documents.delete(documentName)
    document.destroy()
    await this.hooks('afterUnloadDocument', { instance: this, documentName })
  }

  async openDirectConnection(documentName: string, context?: any): Promise<DirectConnection> {
    const connectionConfig: ConnectionConfiguration = {
      isAuthenticated: true,
      readOnly: false,
    }

    const document: Document = await this.createDocument(
      documentName,
      {}, // 直接连接没有请求参数
      uuid(),
      connectionConfig,
      context,
    )

    return new DirectConnection(document, this, context)
  }
}
