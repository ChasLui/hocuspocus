import * as encoding from 'lib0/encoding'
import * as syncProtocol from 'y-protocols/sync'
import type { OutgoingMessageArguments } from '../types.ts'
import { MessageType } from '../types.ts'
import { OutgoingMessage } from '../OutgoingMessage.ts'

export class SyncStepOneMessage extends OutgoingMessage {
  type = MessageType.Sync

  description = '第一步同步'

  get(args: Partial<OutgoingMessageArguments>) {
    if (typeof args.document === 'undefined') {
      throw new Error('同步第一步消息需要 document 作为参数')
    }

    encoding.writeVarString(this.encoder, args.documentName!)
    encoding.writeVarUint(this.encoder, this.type)
    syncProtocol.writeSyncStep1(this.encoder, args.document)

    return this.encoder
  }
}
