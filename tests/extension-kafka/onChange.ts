import test from 'ava'
import { Kafka } from '@hocuspocus/extension-kafka'
import { v4 as uuidv4 } from 'uuid'
import { newHocuspocus, newHocuspocusProvider } from '../utils/index.ts'
import { ensureKafkaMock, resetKafkaMock } from '../utils/mockKafka.ts'

const kafkaBrokers = (process.env.KAFKA_BROKERS || '127.0.0.1:9092').split(',')

const kafkaSettings = { kafka: { brokers: kafkaBrokers } }

test.before(() => { ensureKafkaMock() })
test.afterEach.always(() => { resetKafkaMock() })

test('syncs updates between servers and clients via Kafka', async t => {
  await new Promise(async resolve => {
    const server = await newHocuspocus({
      extensions: [
        new Kafka({
          ...kafkaSettings,
          identifier: `server${uuidv4()}`,
        }),
      ],
    })

    const anotherServer = await newHocuspocus({
      extensions: [
        new Kafka({
          ...kafkaSettings,
          identifier: `anotherServer${uuidv4()}`,
        }),
      ],
    })

    const provider = newHocuspocusProvider(server, {
      onSynced() {
        provider.document.getArray('foo').insert(0, ['bar'])
      },
    })

    const anotherProvider = newHocuspocusProvider(anotherServer, {
      onSynced() {
        provider.on('message', () => {
          setTimeout(() => {
            t.is(
              provider.document.getArray('foo').get(0),
              anotherProvider.document.getArray('foo').get(0),
            )

            resolve('done')
          }, 200)
        })
      },
    })
  })
})
