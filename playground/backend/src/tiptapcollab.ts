import express from 'express'
import expressWebsockets from 'express-ws'
// @ts-ignore
import jsonwebtoken from 'jsonwebtoken'
// @ts-ignore
import cors from 'cors'

const { app } = expressWebsockets(express())
app.use(cors())

app.get('/', (request, response) => {
  // 不要在生产中这样做，这只是为了演示目的。秘密必须存储在服务器上，并且永远不要到达客户端。
  const { secret } = request.query

  const jwt = jsonwebtoken.sign({
    allowedDocumentNames: ['test1', 'test2'],
  }, secret?.toString() ?? '')

  response.send(jwt)
})
app.listen(1234, () => console.log('Listening on http://127.0.0.1:1234…'))
