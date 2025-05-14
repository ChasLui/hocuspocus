import type { IncomingHttpHeaders, IncomingMessage } from 'http'
import type { URLSearchParams } from 'url'
import {
  type CloseEvent,
  ConnectionTimeout,
  Forbidden, ResetConnection, Unauthorized, WsReadyStates,
} from '@hocuspocus/common'
import * as decoding from 'lib0/decoding'
import { v4 as uuid } from 'uuid'
import type WebSocket from 'ws'
import Connection from './Connection.ts'
import type Document from './Document.ts'
import type { Hocuspocus } from './Hocuspocus.ts'
import { IncomingMessage as SocketIncomingMessage } from './IncomingMessage.ts'
import { OutgoingMessage } from './OutgoingMessage.ts'
import type {
  ConnectionConfiguration,
  beforeHandleMessagePayload,
  beforeSyncPayload,
  onDisconnectPayload,
} from './types.ts'
import {
  MessageType,
} from './types.ts'
import { getParameters } from './util/getParameters.ts'

/**
 * `ClientConnection` 类负责处理传入的 WebSocket 连接。
 *
 * TODO-refactor:
 * - 使用事件处理程序而不是直接调用钩子，钩子应该从 Hocuspocus.ts 调用
 */
export class ClientConnection {
  // 此映射指示是否已为传入消息（即 documentName）设置了一个 `Connection` 实例
  private readonly documentConnections: Record<string, Connection> = {}

  // 在连接建立时，消息将被排队并稍后处理。
  private readonly incomingMessageQueue: Record<string, Uint8Array[]> = {}

  // 在连接建立时，消息将被排队并稍后处理。
  private readonly documentConnectionsEstablished = new Set<string>()

  // 文档的钩子负载
  private readonly hookPayloads: Record<string, {
    instance: Hocuspocus,
    request: IncomingMessage,
    requestHeaders: IncomingHttpHeaders,
    requestParameters: URLSearchParams,
    socketId: string,
    connectionConfig: ConnectionConfiguration,
    context: any,
  }> = {}

  private readonly callbacks = {
    onClose: [(document: Document, payload: onDisconnectPayload) => {}],
  }

  // 每个新连接都会获得一个唯一的标识符。
  private readonly socketId = uuid()

  timeout: number

  pingInterval: NodeJS.Timeout

  pongReceived = true

  /**
    * `ClientConnection` 类接收传入的 WebSocket 连接，
    * 运行所有钩子：
    *
    *  - onConnect 所有连接
    *  - onAuthenticate 仅在需要时
    *
    * … 如果没有任何失败，它将完全建立连接并
    * 加载文档。
    */
  constructor(
    private readonly websocket: WebSocket,
    private readonly request: IncomingMessage,
    private readonly documentProvider: {
        createDocument: Hocuspocus['createDocument'],
    },
    // TODO: change to events
    private readonly hooks: Hocuspocus['hooks'],
    private readonly opts: {
        timeout: number,
    },
    private readonly defaultContext: any = {},
  ) {
    this.timeout = opts.timeout
    this.pingInterval = setInterval(this.check, this.timeout)
    websocket.on('pong', this.handlePong)

    websocket.on('message', this.messageHandler)
    websocket.once('close', this.handleWebsocketClose)
  }

  private handleWebsocketClose = (code: number, reason: Buffer) => {
    this.close({ code, reason: reason.toString() })
    this.websocket.removeListener('message', this.messageHandler)
    this.websocket.removeListener('pong', this.handlePong)
    clearInterval(this.pingInterval)
  }

  close(event?: CloseEvent) {
    Object.values(this.documentConnections).forEach(connection => connection.close(event))
  }

  handlePong = () => {
    this.pongReceived = true
  }

  /**
   * 检查是否收到 pong 并关闭连接否则
   * @private
   */
  private check = () => {
    if (!this.pongReceived) {
      return this.close(ConnectionTimeout)
    }

    this.pongReceived = false

    try {
      this.websocket.ping()
    } catch (error) {
      this.close(ConnectionTimeout)
    }

  }

  /**
   * 设置一个回调，当连接关闭时将被触发
   */
  public onClose(callback: (document: Document, payload: onDisconnectPayload) => void): ClientConnection {
    this.callbacks.onClose.push(callback)

    return this
  }

  /**
   * 通过给定的请求和文档创建一个新连接
   */
  private createConnection(connection: WebSocket, document: Document): Connection {
    const hookPayload = this.hookPayloads[document.name]
    const instance = new Connection(
      connection,
      hookPayload.request,
      document,
      hookPayload.socketId,
      hookPayload.context,
      hookPayload.connectionConfig.readOnly,
    )

    instance.onClose(async (document, event) => {
      const disconnectHookPayload: onDisconnectPayload = {
        instance: this.documentProvider as Hocuspocus, // TODO, 当我们将事件而不是钩子用于此类时，这将删除
        clientsCount: document.getConnectionsCount(),
        context: hookPayload.context,
        document,
        socketId: hookPayload.socketId,
        documentName: document.name,
        requestHeaders: hookPayload.request.headers,
        requestParameters: getParameters(hookPayload.request),
      }

      await this.hooks('onDisconnect', disconnectHookPayload)
      this.callbacks.onClose.forEach((callback => callback(document, disconnectHookPayload)))
    })

    instance.onStatelessCallback(async payload => {
      try {
        return await this.hooks('onStateless', payload)
      } catch (error: any) {
        if (error?.message) {
        // 如果一个钩子拒绝了，并且错误为空，什么都不做
        // 这只是为了防止后来的钩子和默认的处理程序做一些事情。如果存在错误，则重新抛出它
          throw error
        }
      }
    })

    instance.beforeHandleMessage((connection, update) => {
      const beforeHandleMessagePayload: beforeHandleMessagePayload = {
        instance: this.documentProvider as Hocuspocus, // TODO, 当我们将事件而不是钩子用于此类时，这将删除
        clientsCount: document.getConnectionsCount(),
        context: hookPayload.context,
        document,
        socketId: hookPayload.socketId,
        connection,
        documentName: document.name,
        requestHeaders: hookPayload.request.headers,
        requestParameters: getParameters(hookPayload.request),
        update,
      }

      return this.hooks('beforeHandleMessage', beforeHandleMessagePayload)
    })

    instance.beforeSync((connection, payload) => {
      const beforeSyncPayload: beforeSyncPayload = {
        clientsCount: document.getConnectionsCount(),
        context: hookPayload.context,
        document,
        documentName: document.name,
        connection,
        type: payload.type,
        payload: payload.payload,
      }

      return this.hooks('beforeSync', beforeSyncPayload)
    })

    return instance
  }

  // 一旦所有钩子都运行，我们将完全建立连接：
  private setUpNewConnection = async (documentName: string) => {
    const hookPayload = this.hookPayloads[documentName]
    // 如果没有任何钩子中断，创建一个文档和连接
    const document = await this.documentProvider.createDocument(documentName, hookPayload.request, hookPayload.socketId, hookPayload.connectionConfig, hookPayload.context)
    const connection = this.createConnection(this.websocket, document)

    connection.onClose((document, event) => {
      delete this.hookPayloads[documentName]
      delete this.documentConnections[documentName]
      delete this.incomingMessageQueue[documentName]
      this.documentConnectionsEstablished.delete(documentName)
    })

    this.documentConnections[documentName] = connection

    // 如果 WebSocket 已经断开连接（哇，这太快了） – 那么
    // 立即调用 close 来清理连接和内存中的文档。
    if (
      this.websocket.readyState === WsReadyStates.Closing
      || this.websocket.readyState === WsReadyStates.Closed
    ) {
      this.close()
      return
    }

    // 不再需要排队消息。
    // 让我们处理队列中的消息。
    this.incomingMessageQueue[documentName].forEach(input => {
      this.websocket.emit('message', input)
    })

    await this.hooks('connected', {
      ...hookPayload,
      documentName,
      context: hookPayload.context,
      connection,
    })
  }

  // 此监听器处理身份验证消息并排队其他消息。
  private handleQueueingMessage = async (data: Uint8Array) => {
    try {
      const tmpMsg = new SocketIncomingMessage(data)

      const documentName = decoding.readVarString(tmpMsg.decoder)
      const type = decoding.readVarUint(tmpMsg.decoder)

      if (!(type === MessageType.Auth && !this.documentConnectionsEstablished.has(documentName))) {
        this.incomingMessageQueue[documentName].push(data)
        return
      }

      // 好的，我们得到了我们正在等待的身份验证消息：
      this.documentConnectionsEstablished.add(documentName)

      // 第二个整数包含子消息类型
      // 当从客户端到服务器发送时，它总是身份验证
      decoding.readVarUint(tmpMsg.decoder)
      const token = decoding.readVarString(tmpMsg.decoder)

      try {
        const hookPayload = this.hookPayloads[documentName]

        await this.hooks('onConnect', { ...hookPayload, documentName }, (contextAdditions: any) => {
          // 从所有钩子合并上下文
          hookPayload.context = { ...hookPayload.context, ...contextAdditions }
        })

        await this.hooks('onAuthenticate', {
          token,
          ...hookPayload,
          documentName,
        }, (contextAdditions: any) => {
          // 钩子可以给我们更多的上下文，我们将合并所有内容。
          // 然后我们将上下文传递给其他钩子。
          hookPayload.context = { ...hookPayload.context, ...contextAdditions }
        })
        // 所有 `onAuthenticate` 钩子都通过了。
        hookPayload.connectionConfig.isAuthenticated = true

        // 让客户端知道身份验证成功。
        const message = new OutgoingMessage(documentName).writeAuthenticated(hookPayload.connectionConfig.readOnly)

        this.websocket.send(message.toUint8Array())

        // 是时候实际建立连接了。
        await this.setUpNewConnection(documentName)
      } catch (err: any) {
        const error = err || Forbidden
        const message = new OutgoingMessage(documentName).writePermissionDenied(error.reason ?? 'permission-denied')

        this.websocket.send(message.toUint8Array())
      }

      // 捕获由于数据解码失败而导致的错误
    } catch (error) {
      console.error(error)
      this.websocket.close(ResetConnection.code, ResetConnection.reason)
    }
  }

  private messageHandler = async (data: Uint8Array) => {
    try {
      const tmpMsg = new SocketIncomingMessage(data)

      const documentName = decoding.readVarString(tmpMsg.decoder)

      const connection = this.documentConnections[documentName]
      if (connection) {
        // 将消息转发给连接
        connection.handleMessage(data)

        // 我们已经在文档上设置了一个 `Connection`
        return
      }

      const isFirst = this.incomingMessageQueue[documentName] === undefined
      if (isFirst) {
        this.incomingMessageQueue[documentName] = []
        if (this.hookPayloads[documentName]) {
          throw new Error('first message, but hookPayloads exists')
        }

        const hookPayload = {
          instance: this.documentProvider as Hocuspocus,
          request: this.request,
          connectionConfig: {
            readOnly: false,
            isAuthenticated: false,
          },
          requestHeaders: this.request.headers,
          requestParameters: getParameters(this.request),
          socketId: this.socketId,
          context: {
            ...this.defaultContext,
          },
        }

        this.hookPayloads[documentName] = hookPayload
      }

      this.handleQueueingMessage(data)
    } catch (closeError) {
      // 在处理无效负载时需要捕获
      console.error(closeError)
      this.websocket.close(Unauthorized.code, Unauthorized.reason)
    }
  }
}
