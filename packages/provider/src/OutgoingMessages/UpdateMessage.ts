import { writeVarString, writeVarUint } from 'lib0/encoding'
import { writeUpdate } from 'y-protocols/sync'
import type { OutgoingMessageArguments } from '../types.ts'
import { MessageType } from '../types.ts'
import { OutgoingMessage } from '../OutgoingMessage.ts'

export class UpdateMessage extends OutgoingMessage {
  type = MessageType.Sync

  description = '文档更新'

  get(args: Partial<OutgoingMessageArguments>) {
    writeVarString(this.encoder, args.documentName!)
    writeVarUint(this.encoder, this.type)

    writeUpdate(this.encoder, args.update)

    return this.encoder
  }
}
