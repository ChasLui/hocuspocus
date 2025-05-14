import * as decoding from 'lib0/decoding'
import { readVarString } from 'lib0/decoding'
import { applyAwarenessUpdate } from 'y-protocols/awareness'
import {
  messageYjsSyncStep1,
  messageYjsSyncStep2,
  messageYjsUpdate,
  readSyncStep1,
  readSyncStep2,
  readUpdate,
} from 'y-protocols/sync'
import * as Y from 'yjs'
import type Connection from './Connection.ts'
import type Document from './Document.ts'
import type { IncomingMessage } from './IncomingMessage.ts'
import { OutgoingMessage } from './OutgoingMessage.ts'
import { MessageType } from './types.ts'

export class MessageReceiver {

  message: IncomingMessage

  defaultTransactionOrigin?: string

  constructor(message: IncomingMessage, defaultTransactionOrigin?: string) {
    this.message = message
    this.defaultTransactionOrigin = defaultTransactionOrigin
  }

  public async apply(document: Document, connection?: Connection, reply?: (message: Uint8Array) => void) {
    const { message } = this
    const type = message.readVarUint()
    const emptyMessageLength = message.length

    switch (type) {
      case MessageType.Sync:
      case MessageType.SyncReply: {
        message.writeVarUint(MessageType.Sync)
        await this.readSyncMessage(message, document, connection, reply, type !== MessageType.SyncReply)

        if (message.length > emptyMessageLength + 1) {
          if (reply) {
            reply(message.toUint8Array())
          } else if (connection) {
            // TODO: 我们应该记录这个，不是吗？
            // this.logger.log({
            //   direction: 'out',
            //   type: MessageType.Awareness,
            //   category: 'Update',
            // })
            connection.send(message.toUint8Array())
          }
        }

        break
      }
      case MessageType.Awareness: {
        await applyAwarenessUpdate(document.awareness, message.readVarUint8Array(), connection?.webSocket)

        break
      }
      case MessageType.QueryAwareness: {

        this.applyQueryAwarenessMessage(document, reply)

        break
      }
      case MessageType.Stateless: {
        connection?.callbacks.statelessCallback({
          connection,
          documentName: document.name,
          document,
          payload: readVarString(message.decoder),
        })

        break
      }
      case MessageType.BroadcastStateless: {
        const msg = message.readVarString()
        document.getConnections().forEach(connection => {
          connection.sendStateless(msg)
        })
        break
      }

      case MessageType.CLOSE: {
        connection?.close({
          code: 1000,
          reason: 'provider_initiated',
        })
        break
      }

      case MessageType.Auth:
        console.error('Received an authentication message on a connection that is already fully authenticated. Probably your provider has been destroyed + recreated really fast.')
        break

      default:
        console.error(`Unable to handle message of type ${type}: no handler defined! Are your provider/server versions aligned?`)
        // Do nothing
    }
  }

  async readSyncMessage(message: IncomingMessage, document: Document, connection?: Connection, reply?: (message: Uint8Array) => void, requestFirstSync = true) {
    const type = message.readVarUint()

    if (connection) {
      await connection.callbacks.beforeSync(connection, {
        type,
        payload: message.peekVarUint8Array(),
      })
    }

    switch (type) {
      case messageYjsSyncStep1: {
        readSyncStep1(message.decoder, message.encoder, document)

        // When the server receives SyncStep1, it should reply with SyncStep2 immediately followed by SyncStep1.
        if (reply && requestFirstSync) {
          const syncMessage = (new OutgoingMessage(document.name)
            .createSyncReplyMessage()
            .writeFirstSyncStepFor(document))

          reply(syncMessage.toUint8Array())
        } else if (connection) {
          const syncMessage = (new OutgoingMessage(document.name)
            .createSyncMessage()
            .writeFirstSyncStepFor(document))

          connection.send(syncMessage.toUint8Array())
        }
        break
      }
      case messageYjsSyncStep2:
        if (connection?.readOnly) {
          // 我们在只读模式下，所以不能应用更新。
          // 让我们使用 snapshotContainsUpdate 来看看更新是否实际上包含更改。
          // 如果没有，我们仍然可以确认更新
          const snapshot = Y.snapshot(document)
          const update = decoding.readVarUint8Array(message.decoder)
          if (Y.snapshotContainsUpdate(snapshot, update)) {
            // 更新中没有新的更改
            const ackMessage = new OutgoingMessage(document.name)
              .writeSyncStatus(true)

            connection.send(ackMessage.toUint8Array())
          } else {
            // 更新中包含我们无法应用的新更改，因为 readOnly
            const ackMessage = new OutgoingMessage(document.name)
              .writeSyncStatus(false)

            connection.send(ackMessage.toUint8Array())
          }
          break
        }

        readSyncStep2(message.decoder, document, connection ?? this.defaultTransactionOrigin)

        if (connection) {
          connection.send(new OutgoingMessage(document.name)
            .writeSyncStatus(true).toUint8Array())
        }
        break
      case messageYjsUpdate:
        if (connection?.readOnly) {
          connection.send(new OutgoingMessage(document.name)
            .writeSyncStatus(false).toUint8Array())
          break
        }

        readUpdate(message.decoder, document, connection)
        if (connection) {
          connection.send(new OutgoingMessage(document.name)
            .writeSyncStatus(true).toUint8Array())
        }
        break
      default:
        throw new Error(`Received a message with an unknown type: ${type}`)
    }

    return type
  }

  applyQueryAwarenessMessage(document: Document, reply?: (message: Uint8Array) => void) {
    const message = new OutgoingMessage(document.name)
      .createAwarenessUpdateMessage(document.awareness)

    if (reply) {
      reply(message.toUint8Array())
    }
  }
}
