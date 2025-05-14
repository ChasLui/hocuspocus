import type WebSocket from 'ws'
import { Awareness, removeAwarenessStates, applyAwarenessUpdate } from 'y-protocols/awareness'
import { applyUpdate, Doc, encodeStateAsUpdate } from 'yjs'
import type { AwarenessUpdate } from './types.ts'
import type Connection from './Connection.ts'
import { OutgoingMessage } from './OutgoingMessage.ts'

export class Document extends Doc {

  awareness: Awareness

  callbacks = {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    onUpdate: (document: Document, connection: Connection, update: Uint8Array) => {},
    beforeBroadcastStateless: (document: Document, stateless: string) => {},
  }

  connections: Map<WebSocket, {
    clients: Set<any>,
    connection: Connection
  }> = new Map()

  // 此文档的直接（非 WebSocket）连接数
  directConnectionsCount = 0

  name: string

  isLoading: boolean

  isDestroyed = false

  /**
   * 构造函数。
   */
  constructor(name: string, yDocOptions?: object) {
    super(yDocOptions)

    this.name = name

    this.awareness = new Awareness(this)
    this.awareness.setLocalState(null)

    this.awareness.on('update', this.handleAwarenessUpdate.bind(this))
    this.on('update', this.handleUpdate.bind(this))

    this.isLoading = true
  }

  /**
   * 检查文档（XMLFragment 或 Map）是否为空
   */
  isEmpty(fieldName: string): boolean {
    // eslint-disable-next-line no-underscore-dangle
    return !this.get(fieldName)._start && !this.get(fieldName)._map.size
  }

  /**
   * 将给定的文档（或文档数组）合并到此文档中
   */
  merge(documents: Doc|Array<Doc>): Document {
    (Array.isArray(documents) ? documents : [documents]).forEach(document => {
      applyUpdate(this, encodeStateAsUpdate(document))
    })

    return this
  }

  /**
   * 设置一个回调，当文档更新时将被触发
   */
  onUpdate(callback: (document: Document, connection: Connection, update: Uint8Array) => void): Document {
    this.callbacks.onUpdate = callback

    return this
  }

  /**
   * 设置一个回调，当无状态消息被广播时将被触发
   */
  beforeBroadcastStateless(callback: (document: Document, stateless: string) => void): Document {
    this.callbacks.beforeBroadcastStateless = callback

    return this
  }

  /**
   * 在底层 WebSocket 连接上注册一个连接和一组客户端
   */
  addConnection(connection: Connection): Document {
    this.connections.set(connection.webSocket, {
      clients: new Set(),
      connection,
    })

    return this
  }

  /**
   * 给定的连接是否已注册在此文档上
   */
  hasConnection(connection: Connection): boolean {
    return this.connections.has(connection.webSocket)
  }

  /**
   * 从此文档中删除给定的连接
   */
  removeConnection(connection: Connection): Document {
    removeAwarenessStates(
      this.awareness,
      Array.from(this.getClients(connection.webSocket)),
      null,
    )

    this.connections.delete(connection.webSocket)

    return this
  }

  addDirectConnection(): Document {
    this.directConnectionsCount += 1

    return this
  }

  removeDirectConnection(): Document {
    if (this.directConnectionsCount > 0) {
      this.directConnectionsCount -= 1
    }

    return this
  }

  /**
   * 获取此文档的活动连接数
   */
  getConnectionsCount(): number {
    return this.connections.size + this.directConnectionsCount
  }

  /**
   * 获取此文档的注册连接数组
   */
  getConnections(): Array<Connection> {
    return Array.from(this.connections.values()).map(data => data.connection)
  }

  /**
   * 获取给定连接实例的客户端 ID 数组
   */
  getClients(connectionInstance: WebSocket): Set<any> {
    const connection = this.connections.get(connectionInstance)

    return connection?.clients === undefined ? new Set() : connection.clients
  }

  /**
   * 文档是否具有意识状态
   */
  hasAwarenessStates(): boolean {
    return this.awareness.getStates().size > 0
  }

  /**
   * 应用给定的意识更新
   */
  applyAwarenessUpdate(connection: Connection, update: Uint8Array): Document {
    applyAwarenessUpdate(
      this.awareness,
      update,
      connection.webSocket,
    )

    return this
  }

  /**
   * 处理意识更新并同步更改到客户端
   * @private
   */
  private handleAwarenessUpdate(
    { added, updated, removed }: AwarenessUpdate,
    connectionInstance: WebSocket,
  ): Document {
    const changedClients = added.concat(updated, removed)

    if (connectionInstance !== null) {
      const connection = this.connections.get(connectionInstance)

      if (connection) {
        added.forEach((clientId: any) => connection.clients.add(clientId))
        removed.forEach((clientId: any) => connection.clients.delete(clientId))
      }
    }

    this.getConnections().forEach(connection => {
      const awarenessMessage = new OutgoingMessage(this.name)
        .createAwarenessUpdateMessage(this.awareness, changedClients)

      connection.send(
        awarenessMessage.toUint8Array(),
      )
    })

    return this
  }

  /**
   * 处理文档更新并同步更改到客户端
   */
  private handleUpdate(update: Uint8Array, connection: Connection): Document {
    this.callbacks.onUpdate(this, connection, update)

    const message = new OutgoingMessage(this.name)
      .createSyncMessage()
      .writeUpdate(update)

    this.getConnections().forEach(connection => {
      connection.send(
        message.toUint8Array(),
      )
    })

    return this
  }

  /**
   * 向所有连接广播无状态消息
   */
  public broadcastStateless(payload: string, filter?: (conn: Connection) => boolean): void {
    this.callbacks.beforeBroadcastStateless(this, payload)

    const connections = filter ? this.getConnections().filter(filter) : this.getConnections()

    connections.forEach(connection => {
      connection.sendStateless(payload)
    })
  }

  destroy() {
    super.destroy()
    this.isDestroyed = true
  }
}

export default Document
