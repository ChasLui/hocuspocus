import type {
  Extension,
  onChangePayload,
  onConfigurePayload,
  onConnectPayload,
  onLoadDocumentPayload,
  onDestroyPayload,
  onDisconnectPayload,
  onRequestPayload,
  onUpgradePayload,
} from '@hocuspocus/server'

export interface LoggerConfiguration {
  /**
   * 在所有日志消息前面添加一个字符串。
   *
   * @deprecated
   */
  prefix: null | string,
  /**
   * 是否为 `onLoadDocument` 钩子记录日志。
   */
  onLoadDocument: boolean,
  /**
   * 是否为 `onChange` 钩子记录日志。
   */
  onChange: boolean,
  /**
   * 是否为 `onStoreDocument` 钩子记录日志。
   */
   onStoreDocument: boolean,
  /**
   * 是否为 `onConnect` 钩子记录日志。
   */
  onConnect: boolean,
  /**
   * 是否为 `onDisconnect` 钩子记录日志。
   */
  onDisconnect: boolean,
  /**
   * 是否为 `onUpgrade` 钩子记录日志。
   */
  onUpgrade: boolean,
  /**
   * 是否为 `onRequest` 钩子记录日志。
   */
  onRequest: boolean,
  /**
   * 是否为 `onDestroy` 钩子记录日志。
   */
  onDestroy: boolean,
  /**
   * 是否为 `onConfigure` 钩子记录日志。
   */
  onConfigure: boolean,
  /**
   * 一个日志函数，如果未提供，输出将转到控制台。
   */
  log: (...args: any[]) => void,
}

export class Logger implements Extension {
  name: string | null = null

  configuration: LoggerConfiguration = {
    prefix: null,
    onLoadDocument: true,
    onChange: true,
    onStoreDocument: true,
    onConnect: true,
    onDisconnect: true,
    onUpgrade: true,
    onRequest: true,
    onDestroy: true,
    onConfigure: true,
    log: console.log, // eslint-disable-line
  }

  /**
   * 构造函数
   */
  constructor(configuration?: Partial<LoggerConfiguration>) {
    this.configuration = {
      ...this.configuration,
      ...configuration,
    }
  }

  async onConfigure(data: onConfigurePayload) {
    this.name = data.instance.configuration.name

    if (!this.configuration.onConfigure) {
      return
    }

    if (this.configuration.prefix) {
      console.warn('[Hocuspocus 警告]Logger \'prefix\' 已弃用。将 \'name\' 传递给 Hocuspocus 配置。')
    }
  }

  async onLoadDocument(data: onLoadDocumentPayload) {
    if (this.configuration.onLoadDocument) {
      this.log(`Loaded document "${data.documentName}".`)
    }
  }

  async onChange(data: onChangePayload) {
    if (this.configuration.onChange) {
      this.log(`Document "${data.documentName}" changed.`)
    }
  }

  async onStoreDocument(data: onDisconnectPayload) {
    if (this.configuration.onStoreDocument) {
      this.log(`Store "${data.documentName}".`)
    }
  }

  async onConnect(data: onConnectPayload) {
    if (this.configuration.onConnect) {
      this.log(`New connection to "${data.documentName}".`)
    }
  }

  async onDisconnect(data: onDisconnectPayload) {
    if (this.configuration.onDisconnect) {
      this.log(`Connection to "${data.documentName}" closed.`)
    }
  }

  async onUpgrade(data: onUpgradePayload) {
    if (this.configuration.onUpgrade) {
      this.log('Upgrading connection …')
    }
  }

  async onRequest(data: onRequestPayload) {
    if (this.configuration.onRequest) {
      this.log(`Incoming HTTP Request to ${data.request.url}`)
    }
  }

  async onDestroy(data: onDestroyPayload) {
    if (this.configuration.onDestroy) {
      this.log('Shut down.')
    }
  }

  private log(message: string) {
    const date = (new Date()).toISOString()
    let meta = `${date}`

    if (this.name) {
      meta = `${this.name} ${meta}`
    }

    message = `[${meta}] ${message}`

    this.configuration.log(message)
  }
}
