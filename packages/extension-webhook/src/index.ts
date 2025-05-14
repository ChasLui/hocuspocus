import { createHmac } from 'crypto'
import type {
  Extension,
  onChangePayload,
  onConnectPayload,
  onLoadDocumentPayload,
  onDisconnectPayload,
} from '@hocuspocus/server'
import type { Doc } from 'yjs'
import type { Transformer } from '@hocuspocus/transformer'
import { TiptapTransformer } from '@hocuspocus/transformer'
import axios from 'axios'
import { Forbidden } from '@hocuspocus/common'

export enum Events {
  onChange = 'change',
  onConnect = 'connect',
  onCreate = 'create',
  onDisconnect = 'disconnect',
}

export interface Configuration {
  debounce: number | false | null,
  debounceMaxWait: number,
  secret: string,
  transformer: Transformer | {
    toYdoc: (document: any) => Doc,
    fromYdoc: (document: Doc) => any,
  },
  url: string,
  events: Array<Events>,
}

export class Webhook implements Extension {

  configuration: Configuration = {
    debounce: 2000,
    debounceMaxWait: 10000,
    secret: '',
    transformer: TiptapTransformer,
    url: '',
    events: [
      Events.onChange,
    ],
  }

  debounced: Map<string, { timeout: NodeJS.Timeout, start: number }> = new Map()

  /**
   * 构造函数
   */
  constructor(configuration?: Partial<Configuration>) {
    this.configuration = {
      ...this.configuration,
      ...configuration,
    }

    if (!this.configuration.url) {
      throw new Error('url is required!')
    }
  }

  /**
   * 创建响应体的签名
   */
  createSignature(body: string): string {
    const hmac = createHmac('sha256', this.configuration.secret)

    return `sha256=${hmac.update(body).digest('hex')}`
  }

  /**
   * 使用给定的标识符对给定的函数进行防抖
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  debounce(id: string, func: Function) {
    const old = this.debounced.get(id)
    const start = old?.start || Date.now()

    const run = () => {
      this.debounced.delete(id)
      func()
    }

    if (old?.timeout) clearTimeout(old.timeout)
    if (Date.now() - start >= this.configuration.debounceMaxWait) return run()

    this.debounced.set(id, {
      start,
      timeout: setTimeout(run, <number> this.configuration.debounce),
    })
  }

  /**
   * 向包含给定数据的给定 URL 发送请求
   */
  async sendRequest(event: Events, payload: any) {
    const json = JSON.stringify({ event, payload })

    return axios.post(
      this.configuration.url,
      json,
      { headers: { 'X-Hocuspocus-Signature-256': this.createSignature(json), 'Content-Type': 'application/json' } },
    )
  }

  /**
   * onChange 钩子
   */
  async onChange(data: onChangePayload) {
    if (!this.configuration.events.includes(Events.onChange)) {
      return
    }

    const save = async () => {
      try {
        await this.sendRequest(Events.onChange, {
          document: this.configuration.transformer.fromYdoc(data.document),
          documentName: data.documentName,
          context: data.context,
          requestHeaders: data.requestHeaders,
          requestParameters: Object.fromEntries(data.requestParameters.entries()),
        })
      } catch (e) {
        console.error(`在 extension-webhook 中捕获到错误： ${e}`)
      }
    }

    if (!this.configuration.debounce) {
      return save()
    }

    this.debounce(data.documentName, save)
  }

  /**
   * onLoadDocument 钩子
   */
  async onLoadDocument(data: onLoadDocumentPayload) {
    if (!this.configuration.events.includes(Events.onCreate)) {
      return
    }

    try {
      const response = await this.sendRequest(Events.onCreate, {
        documentName: data.documentName,
        requestHeaders: data.requestHeaders,
        requestParameters: Object.fromEntries(data.requestParameters.entries()),
      })

      if (response.status !== 200 || !response.data) return

      const document = typeof response.data === 'string'
        ? JSON.parse(response.data)
        : response.data

      // eslint-disable-next-line guard-for-in,no-restricted-syntax
      for (const fieldName in document) {
        if (data.document.isEmpty(fieldName)) {
          data.document.merge(
            this.configuration.transformer.toYdoc(document[fieldName], fieldName),
          )
        }
      }
    } catch (e) {
      console.error(`Caught error in extension-webhook: ${e}`)
    }
  }

  /**
   * onConnect 钩子
   */
  async onConnect(data: onConnectPayload) {
    if (!this.configuration.events.includes(Events.onConnect)) {
      return
    }

    try {
      const response = await this.sendRequest(Events.onConnect, {
        documentName: data.documentName,
        requestHeaders: data.requestHeaders,
        requestParameters: Object.fromEntries(data.requestParameters.entries()),
      })

      return typeof response.data === 'string' && response.data.length > 0
        ? JSON.parse(response.data)
        : response.data
    } catch (e) {
      console.error(`Caught error in extension-webhook: ${e}`)
      throw Forbidden
    }
  }

  async onDisconnect(data: onDisconnectPayload) {
    if (!this.configuration.events.includes(Events.onDisconnect)) {
      return
    }

    try {
      await this.sendRequest(Events.onDisconnect, {
        documentName: data.documentName,
        requestHeaders: data.requestHeaders,
        requestParameters: Object.fromEntries(data.requestParameters.entries()),
        context: data.context,
      })
    } catch (e) {
      console.error(`Caught error in extension-webhook: ${e}`)
    }
  }

}
