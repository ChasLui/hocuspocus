import test from 'ava'
import { WebSocketStatus } from '@hocuspocus/provider'
import {
  newHocuspocus, newHocuspocusProvider, newHocuspocusProviderWebsocket, sleep,
} from '../utils/index.ts'
import { retryableAssertion } from '../utils/retryableAssertion.ts'

// test('closes all connections', async t => {
//   const server = await newHocuspocus()
//   const socket = newHocuspocusProviderWebsocket(server)
//   const socket2 = newHocuspocusProviderWebsocket(server)

//   const provider = newHocuspocusProvider(server, {
//     name: 'hocuspocus-test',
//     onClose() {
//       // Make sure it doesn’t reconnect.
//       socket.disconnect()
//     },
//     websocketProvider: socket,
//   })

//   const anotherProvider = newHocuspocusProvider(server, {
//     name: 'hocuspocus-test-2',
//     onClose() {
//       // Make sure it doesn’t reconnect.
//       socket2.disconnect()
//     },
//     websocketProvider: socket2,
//   })

//   await sleep(100)

//   server.closeConnections()

//   t.is(server.documents.size, 1)
// })

test('closes a specific connection when a documentName is passed', async t => {
  const server = await newHocuspocus()
  const socket = newHocuspocusProviderWebsocket(server)
  const socket2 = newHocuspocusProviderWebsocket(server)

  const provider = newHocuspocusProvider(server, {
    name: 'hocuspocus-test',
    onClose() {
      // Make sure it doesn’t reconnect.
      socket.disconnect()
    },
    websocketProvider: socket,
  })

  const anotherProvider = newHocuspocusProvider(server, {
    name: 'hocuspocus-test-2',
    websocketProvider: socket2,
  })

  await sleep(100)

  server.closeConnections('hocuspocus-test')

  await retryableAssertion(t, tt => {
    tt.is(socket.status, WebSocketStatus.Disconnected)
    tt.is(socket2.status, WebSocketStatus.Connected)
  })
})

// test('uses a proper close event', async t => {
//   await new Promise(async resolve => {
//     const server = await newHocuspocus()

//     newHocuspocusProvider(server, {
//       name: 'hocuspocus-test',
//       onSynced() {
//         server.closeConnections()
//       },
//       onClose({ event }) {
//         // Make sure it doesn’t reconnect.
//         t.is(event.code, 1000)
//         t.is(event.reason, 'Reset Connection')

//         resolve('done')
//       },
//     })
//   })
// })
