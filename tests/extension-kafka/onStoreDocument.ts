import test from 'ava'
import type { onStoreDocumentPayload } from '@hocuspocus/server'
import { Kafka } from '@hocuspocus/extension-kafka'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import { uuidv4 } from 'lib0/random'
import { newHocuspocus, newHocuspocusProvider } from '../utils/index.ts'
import { ensureKafkaMock, resetKafkaMock } from '../utils/mockKafka.ts'

const kafkaBrokers = (process.env.KAFKA_BROKERS || '127.0.0.1:9092').split(',')

const kafkaSettings = {
  kafka: { brokers: kafkaBrokers },
}

test.before(() => { ensureKafkaMock() })
test.afterEach.always(() => { resetKafkaMock() })

test('kafka: stores documents without conflicts (perDocument locking)', async t => {
  await new Promise(async resolve => {
    // eslint-disable-next-line prefer-const
    let anotherProvider: HocuspocusProvider

    class CustomStorageExtension {
      async onStoreDocument({ document }: onStoreDocumentPayload) {
        t.is(document.getArray('foo').get(0), 'bar')
        t.is(document.getArray('foo').get(0), anotherProvider.document.getArray('foo').get(0))
        resolve('done')
      }
    }

    const server = await newHocuspocus({
      name: 'kafka-1',
      extensions: [
        new Kafka({
          ...kafkaSettings,
          prefix: 'extension-kafka.onStoreDocument1',
        }),
        new CustomStorageExtension(),
      ],
    })

    const anotherServer = await newHocuspocus({
      name: 'kafka-2',
      extensions: [
        new Kafka({
          ...kafkaSettings,
          prefix: 'extension-kafka.onStoreDocument1',
        }),
        new CustomStorageExtension(),
      ],
    })

    newHocuspocusProvider(server)

    anotherProvider = newHocuspocusProvider(anotherServer, {
      onSynced() {
        anotherProvider.document.getArray('foo').insert(0, ['bar'])
        anotherProvider.disconnect()
      },
    })
  })
})

test('kafka: stores documents when the last client disconnects', async t => {
  await new Promise(async resolve => {
    // eslint-disable-next-line prefer-const
    let provider: HocuspocusProvider

    const server = await newHocuspocus({
      extensions: [
        new Kafka({
          ...kafkaSettings,
          prefix: 'extension-kafka.onStoreDocument2',
        }),
      ],
      onStoreDocument: async ({ document }) => {
        t.is(provider.document.getArray('foo').get(0), document.getArray('foo').get(0))
        resolve('done')
      },
    })

    provider = newHocuspocusProvider(server, {
      onSynced() {
        provider.document.getArray('foo').insert(0, ['bar'])
        provider.disconnect()
      },
    })
  })
})

test('kafka: document gets unloaded on both servers after disconnection', async t => {
  await new Promise(async resolve => {
    class CustomStorageExtension {
      priority = 10

      onStoreDocument({ document }: onStoreDocumentPayload) {
        return new Promise(resolve2 => {
          setTimeout(() => {
            resolve2('')
          }, 3000)
        })
      }
    }

    const server = await newHocuspocus({
      name: 'kafka-1',
      extensions: [
        new Kafka({
          ...kafkaSettings,
          prefix: 'extension-kafka.onStoreDocument3',
        }),
        new CustomStorageExtension(),
      ],
    })

    const anotherServer = await newHocuspocus({
      name: 'kafka-2',
      extensions: [
        new Kafka({
          ...kafkaSettings,
          prefix: 'extension-kafka.onStoreDocument3',
        }),
        new CustomStorageExtension(),
      ],
    })

    const provider = newHocuspocusProvider(server)

    const anotherProvider = newHocuspocusProvider(anotherServer, {
      onSynced() {
        anotherProvider.document.getArray('foo').insert(0, ['bar'])
        provider.document.getArray('foo2').insert(0, ['bar'])

        setTimeout(() => {
          provider.configuration.websocketProvider.disconnect()
          anotherProvider.configuration.websocketProvider.disconnect()

          setTimeout(() => {
            t.is(anotherServer.documents.size, 0)
            t.is(server.documents.size, 0)
            resolve('')
          }, 5000)
        }, 1500)
      },
    })
  })
})
