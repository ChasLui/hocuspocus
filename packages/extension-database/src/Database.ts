import type {
  Extension,
  onChangePayload,
  onLoadDocumentPayload,
  storePayload,
  fetchPayload,
} from '@hocuspocus/server'
import * as Y from 'yjs'

export interface DatabaseConfiguration {
  /**
   * 传递一个 Promise 从你的数据库中检索更新。Promise 应该解析为
   * 一个包含 Y.js 兼容二进制数据的数组。
   */
  fetch: (data: fetchPayload) => Promise<Uint8Array | null>,
  /**
   * 传递一个函数来存储更新到你的数据库。
   */
  store: (data: storePayload) => Promise<void>,
}

export class Database implements Extension {
  /**
   * 默认配置
   */
  configuration: DatabaseConfiguration = {
    fetch: async () => null,
    store: async () => {},
  }

  /**
   * 构造函数
   */
  constructor(configuration: Partial<DatabaseConfiguration>) {
    this.configuration = {
      ...this.configuration,
      ...configuration,
    }
  }

  /**
   * 从数据库中获取存储的数据。
   */
  async onLoadDocument(data: onLoadDocumentPayload): Promise<any> {
    const update = await this.configuration.fetch(data)

    if (update) {
      Y.applyUpdate(data.document, update)
    }
  }

  /**
   * 在数据库中存储新的更新。
   */
  async onStoreDocument(data: onChangePayload) {
    await this.configuration.store({
      ...data,
      state: Buffer.from(
        Y.encodeStateAsUpdate(data.document),
      ),
    })
  }
}
