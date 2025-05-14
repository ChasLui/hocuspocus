import type {
  Extension,
  onConnectPayload,
} from '@hocuspocus/server'

export interface ThrottleConfiguration {
  throttle: number | null | false, // 在拒绝请求之前，在 `consideredSeconds` 内有多少请求 (设置为 15 意味着第 16 个请求将被拒绝)
  consideredSeconds: number, // 考虑多少秒 (默认是当前连接尝试的最后 60 秒)
  banTime: number, // 在收到太多请求后禁止多长时间 (以分钟为单位!)
  cleanupInterval: number // 清理 IP 记录的频率 (这不会删除仍然被阻止或足够新的 IP 通过 `consideredSeconds`)
}

export class Throttle implements Extension {

  configuration: ThrottleConfiguration = {
    throttle: 15,
    banTime: 5,
    consideredSeconds: 60,
    cleanupInterval: 90,
  }

  connectionsByIp: Map<string, Array<number>> = new Map()

  bannedIps: Map<string, number> = new Map()

  cleanupInterval?: NodeJS.Timeout

  /**
   * 构造函数
   */
  constructor(configuration?: Partial<ThrottleConfiguration>) {
    this.configuration = {
      ...this.configuration,
      ...configuration,
    }

    this.cleanupInterval = setInterval(this.clearMaps.bind(this), this.configuration.cleanupInterval * 1000)
  }

  onDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    return Promise.resolve()
  }

  public clearMaps() {
    this.connectionsByIp.forEach((value, key) => {
      const filteredValue = value
        .filter(timestamp => timestamp + (this.configuration.consideredSeconds * 1000) > Date.now())

      if (filteredValue.length) {
        this.connectionsByIp.set(key, filteredValue)
      } else {
        this.connectionsByIp.delete(key)
      }
    })

    this.bannedIps.forEach((value, key) => {
      if (!this.isBanned(key)) {
        this.bannedIps.delete(key)
      }
    })
  }

  isBanned(ip: string) {
    const bannedAt = this.bannedIps.get(ip) || 0
    return Date.now() < (bannedAt + (this.configuration.banTime * 60 * 1000))
  }

  /**
   * 限制请求
   * @private
   */
  private throttle(ip: string): boolean {
    if (!this.configuration.throttle) {
      return false
    }

    if (this.isBanned(ip)) return true

    this.bannedIps.delete(ip)

    // 将此连接尝试添加到先前连接的列表中
    const previousConnections = this.connectionsByIp.get(ip) || []
    previousConnections.push(Date.now())

    // 计算在最后考虑的时间间隔内之前的连接
    const previousConnectionsInTheConsideredInterval = previousConnections
      .filter(timestamp => timestamp + (this.configuration.consideredSeconds * 1000) > Date.now())

    this.connectionsByIp.set(ip, previousConnectionsInTheConsideredInterval)

    if (previousConnectionsInTheConsideredInterval.length > this.configuration.throttle) {
      this.bannedIps.set(ip, Date.now())
      return true
    }

    return false
  }

  /**
   * onConnect 钩子
   * @param data
   */
  onConnect(data: onConnectPayload): Promise<any> {
    const { request } = data

    // 获取远程 IP 地址
    const ip = request.headers['x-real-ip']
      || request.headers['x-forwarded-for']
      || request.socket.remoteAddress
      || ''

    // 限制连接
    return this.throttle(<string> ip) ? Promise.reject() : Promise.resolve()
  }

}
