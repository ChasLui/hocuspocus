import { Kafka as KafkaJS, logLevel } from 'kafkajs'

const brokers = (process.env.KAFKA_BROKERS || '127.0.0.1:9092').split(',')

export async function waitForKafka(maxMs = 20000) {
  const kafka = new KafkaJS({ clientId: 'tests-waiter', brokers, logLevel: logLevel.NOTHING })
  const admin = kafka.admin()

  const start = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await admin.connect()
      await admin.listTopics()
      await admin.disconnect()
      return
    } catch {
      try {
        await admin.disconnect()
      } catch {}
      if (Date.now() - start > maxMs) {
        throw new Error('Kafka did not become ready in time')
      }
      await new Promise(r => setTimeout(r, 500))
    }
  }
}


