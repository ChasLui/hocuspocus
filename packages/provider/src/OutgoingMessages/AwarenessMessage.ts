import * as encoding from 'lib0/encoding'
import { encodeAwarenessUpdate } from 'y-protocols/awareness'
import type { OutgoingMessageArguments } from '../types.ts'
import { MessageType } from '../types.ts'
import { OutgoingMessage } from '../OutgoingMessage.ts'

export class AwarenessMessage extends OutgoingMessage {
  type = MessageType.Awareness

  description = '意识状态更新'

  get(args: Partial<OutgoingMessageArguments>) {
    if (typeof args.awareness === 'undefined') {
      throw new Error('意识消息需要 awareness 作为参数')
    }

    if (typeof args.clients === 'undefined') {
      throw new Error('意识消息需要 clients 作为参数')
    }

    encoding.writeVarString(this.encoder, args.documentName!)
    encoding.writeVarUint(this.encoder, this.type)

    let awarenessUpdate
    if (args.states === undefined) {
      awarenessUpdate = encodeAwarenessUpdate(args.awareness, args.clients)
    } else {
      awarenessUpdate = encodeAwarenessUpdate(args.awareness, args.clients, args.states)
    }

    encoding.writeVarUint8Array(this.encoder, awarenessUpdate)

    return this.encoder
  }
}
