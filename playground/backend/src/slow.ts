import { Server } from '@hocuspocus/server'
import { Logger } from '@hocuspocus/extension-logger'
import { SQLite } from '@hocuspocus/extension-sqlite'

const server = new Server({
  port: 1234,
  extensions: [
    new Logger(),
    new SQLite({
      database: 'db.sqlite',
    }),
  ],

  async onConnect(data) {
    // 模拟一个非常慢的身份验证过程，需要 10 秒（如果您想键入更多内容，则需要更长时间）
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    await new Promise((resolve: Function) => {
      setTimeout(() => { resolve() }, 10000)
    })

    return true
  },
})

server.listen()
