import test from 'ava'
import type { onAwarenessChangeParameters } from '@hocuspocus/provider'
import { Kafka } from '@hocuspocus/extension-kafka'
import { v4 as uuidv4 } from 'uuid'
import { newHocuspocus, newHocuspocusProvider, sleep } from '../utils/index.ts'
import { ensureKafkaMock, resetKafkaMock } from '../utils/mockKafka.ts'

const kafkaBrokers = (process.env.KAFKA_BROKERS || '127.0.0.1:9092').split(',')

const kafkaSettings = { kafka: { brokers: kafkaBrokers } }

test.before(() => { ensureKafkaMock() })
test.afterEach.always(() => { resetKafkaMock() })

test('syncs awareness between servers and clients via Kafka', async t => {
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

    const provider = newHocuspocusProvider(anotherServer, {
      name: 'another-document',
      onSynced() {
        provider.setAwarenessField('name', 'second')
      },
    })

    newHocuspocusProvider(server, {
      name: 'another-document',
      onAwarenessChange: ({ states }: onAwarenessChangeParameters) => {
        t.is(states.length, 2)
        const state = states.find(state => state.clientId === provider.document.clientID)
        t.is(state?.name, 'second')
        resolve('done')
      },
    })
  })
})

test.serial('syncs existing awareness state via Kafka', async t => {
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
        provider.setAwarenessField('name', 'first')
        setTimeout(() => {
          newHocuspocusProvider(anotherServer, {
            onAwarenessChange({ states }: onAwarenessChangeParameters) {
              t.is(states.length, 2)
              const st = states.find(s => s.clientId === provider.document.clientID)
              t.is(st?.name, 'first')
              resolve('done')
            },
          })
        }, 20)
      },
    })
  })
})
