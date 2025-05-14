/**
 * WebSocket 连接的状态。
 * https://developer.mozilla.org/de/docs/Web/API/WebSocket/readyState
 */
export enum WsReadyStates {
  Connecting = 0,
  Open = 1,
  Closing = 2,
  Closed = 3,
}
