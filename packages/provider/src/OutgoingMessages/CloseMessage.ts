import * as encoding from 'lib0/encoding'
import type { OutgoingMessageArguments } from '../types.ts'
import { MessageType } from '../types.ts'
import { OutgoingMessage } from '../OutgoingMessage.ts'

export class CloseMessage extends OutgoingMessage {
  type = MessageType.CLOSE

  description = '请求服务器关闭连接'

  get(args: Partial<OutgoingMessageArguments>) {
    encoding.writeVarString(this.encoder, args.documentName!)
    encoding.writeVarUint(this.encoder, this.type)

    return this.encoder
  }
}
