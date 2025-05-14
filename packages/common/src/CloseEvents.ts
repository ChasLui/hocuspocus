export interface CloseEvent {
  code: number,
  reason: string,
}

/**
 * 服务器正在终止连接，因为收到的数据帧太大。
 * 详见: https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code
 */
export const MessageTooBig: CloseEvent = {
  code: 1009,
  reason: 'Message Too Big',
}

/**
 * 服务器成功处理了请求，要求请求者重置其文档视图，并且未返回任何内容。
 */
export const ResetConnection: CloseEvent = {
  code: 4205,
  reason: 'Reset Connection',
}

/**
 * 与 Forbidden 类似，但专门用于需要身份验证且身份验证失败或尚未提供时使用。
 */
export const Unauthorized: CloseEvent = {
  code: 4401,
  reason: 'Unauthorized',
}

/**
 * 请求包含有效数据，并且服务器能够理解，但服务器拒绝执行作。
 */
export const Forbidden: CloseEvent = {
  code: 4403,
  reason: 'Forbidden',
}

/**
 * 服务器等待请求超时。
 */
export const ConnectionTimeout: CloseEvent = {
  code: 4408,
  reason: 'Connection Timeout',
}
