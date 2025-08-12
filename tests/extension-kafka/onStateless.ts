import test from 'ava'
import { Kafka } from '@hocuspocus/extension-kafka'
import { v4 as uuidv4 } from 'uuid'
import { newHocuspocus, newHocuspocusProvider } from '../utils/index.ts'
import { ensureKafkaMock, resetKafkaMock } from '../utils/mockKafka.ts'

const kafkaBrokers = (process.env.KAFKA_BROKERS || '127.0.0.1:9092').split(',')

const kafkaSettings = { kafka: { brokers: kafkaBrokers } }

test.before(() => { ensureKafkaMock() })
test.afterEach.always(() => { resetKafkaMock() })

test('syncs broadcast stateless message via Kafka between servers and clients', async t => {
  await new Promise(async resolve => {
    const payloadToSend = 'STATELESS-MESSAGE'
    const sharedPrefix = `kafka-${uuidv4()}`

    const server = await newHocuspocus({
      extensions: [
        new Kafka({
          ...kafkaSettings,
          identifier: `server${uuidv4()}`,
          prefix: sharedPrefix,
        }),
      ],
    })

    const anotherServer = await newHocuspocus({
      extensions: [
        new Kafka({
          ...kafkaSettings,
          identifier: `anotherServer${uuidv4()}`,
          prefix: sharedPrefix,
        }),
      ],
    })

    newHocuspocusProvider(anotherServer, {
      onStateless: ({ payload }) => {
        t.is(payload, payloadToSend)
        t.pass()
        resolve('done')
      },
    })

    newHocuspocusProvider(server, {
      onSynced() {
        server.documents.get('hocuspocus-test')?.broadcastStateless(payloadToSend)
      },
    })
  })
})

test('client stateless messages via Kafka shouldnt propagate to other server', async t => {
  const sharedPrefix = `kafka-${uuidv4()}`
  await new Promise(async resolve => {
    const payloadToSend = 'STATELESS-MESSAGE'

    const server = await newHocuspocus({
      extensions: [
        new Kafka({
          ...kafkaSettings,
          identifier: `server${uuidv4()}`,
          prefix: sharedPrefix,
        }),
      ],
      async onStateless({ payload }) {
        t.is(payloadToSend, payload)
        t.pass()
        resolve('done')
      },
    })

    await newHocuspocus({
      extensions: [
        new Kafka({
          ...kafkaSettings,
          identifier: `anotherServer${uuidv4()}`,
          prefix: sharedPrefix,
        }),
      ],
      async onStateless() {
        t.fail()
      },
    })

    const provider = newHocuspocusProvider(server, {
      onSynced() {
        provider.sendStateless(payloadToSend)
      },
    })
  })
})

test('server client stateless messages via Kafka shouldnt propagate to other client', async t => {
  await new Promise(async resolve => {
    const sharedPrefix = `kafka-${uuidv4()}`

    const server = await newHocuspocus({
      extensions: [
        new Kafka({
          ...kafkaSettings,
          identifier: `server${uuidv4()}`,
          prefix: sharedPrefix,
        }),
      ],
      async onStateless({ connection }) {
        connection.sendStateless('test123')
      },
    })

    const anotherServer = await newHocuspocus({
      extensions: [
        new Kafka({
          ...kafkaSettings,
          identifier: `anotherServer${uuidv4()}`,
          prefix: sharedPrefix,
        }),
      ],
      async onStateless() {
        t.fail()
      },
    })

    newHocuspocusProvider(anotherServer, {
      onStateless() {
        t.fail()
      },
    })

    const provider = newHocuspocusProvider(server, {
      onSynced() {
        provider.sendStateless('ok')
      },
      onStateless() {
        t.pass()
      },
    })

    setTimeout(() => {
      resolve('done')
    }, 500)
  })
})
