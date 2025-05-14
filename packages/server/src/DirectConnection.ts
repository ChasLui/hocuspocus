import { URLSearchParams } from 'url'
import type Document from './Document.ts'
import type { Hocuspocus } from './Hocuspocus.ts'
import type { DirectConnection as DirectConnectionInterface } from './types.ts'

export class DirectConnection implements DirectConnectionInterface {
  document: Document | null = null

  instance!: Hocuspocus

  context: any

  /**
   * 构造函数。
   */
  constructor(
    document: Document,
    instance: Hocuspocus,
    context?: any,
  ) {
    this.document = document
    this.instance = instance
    this.context = context

    this.document.addDirectConnection()
  }

  async transact(transaction: (document: Document) => void) {
    if (!this.document) {
      throw new Error('direct connection closed')
    }

    transaction(this.document)

    await this.instance.storeDocumentHooks(this.document, {
      clientsCount: this.document.getConnectionsCount(),
      context: this.context,
      document: this.document,
      documentName: this.document.name,
      instance: this.instance,
      requestHeaders: {},
      requestParameters: new URLSearchParams(),
      socketId: 'server',
    }, true)
  }

  async disconnect() {
    if (this.document) {
      this.document?.removeDirectConnection()

      await this.instance.storeDocumentHooks(this.document, {
        clientsCount: this.document.getConnectionsCount(),
        context: this.context,
        document: this.document,
        documentName: this.document.name,
        instance: this.instance,
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: 'server',
      }, true)

      // 如果直接连接是文档的唯一连接，
      // 那么我们应该为此文档触发 onDisconnect 钩子
      // 并卸载文档
      if (this.document.getConnectionsCount() === 0) {
        await this.instance.hooks('onDisconnect', {
          instance: this.instance,
          clientsCount: this.document.getConnectionsCount(),
          context: this.context,
          document: this.document,
          socketId: 'server',
          documentName: this.document.name,
          requestHeaders: {},
          requestParameters: new URLSearchParams(),
        })

        await this.instance.unloadDocument(this.document)
      }

      this.document = null
    }
  }

}
