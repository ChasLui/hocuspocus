import * as encoding from 'lib0/encoding'
import type { OutgoingMessageArguments } from '../types.ts'
import { MessageType } from '../types.ts'
import { OutgoingMessage } from '../OutgoingMessage.ts'

export class QueryAwarenessMessage extends OutgoingMessage {
  type = MessageType.QueryAwareness

  description = '查询感知状态'

  get(args: Partial<OutgoingMessageArguments>) {

    encoding.writeVarString(this.encoder, args.documentName!)
    encoding.writeVarUint(this.encoder, this.type)

    return this.encoder
  }
}
