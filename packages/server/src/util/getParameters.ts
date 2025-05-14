import type { IncomingMessage } from 'http'
import { URLSearchParams } from 'url'

/**
 * 通过给定的请求获取参数
 */
export function getParameters(request?: Pick<IncomingMessage, 'url'>): URLSearchParams {
  const query = request?.url?.split('?') || []
  return new URLSearchParams(query[1] ? query[1] : '')
}
