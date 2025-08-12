import { Kafka as KafkaJS } from 'kafkajs'

type Message = { key?: Buffer | string; value?: Buffer | string }

class InMemoryBus {
  consumers: Set<FakeConsumer> = new Set()

  publish(topic: string, message: Message) {
    // Async deliver to avoid reentrancy
    setTimeout(() => {
      for (const consumer of this.consumers) {
        if (!consumer.eachMessage) continue
        if (!consumer.matches(topic)) continue
        consumer.eachMessage({ topic, message: {
          key: typeof message.key === 'string' ? Buffer.from(message.key) : (message.key ?? null),
          value: typeof message.value === 'string' ? Buffer.from(message.value) : (message.value ?? null),
        } as any })
      }
    }, 0)
  }
}

const BUS = new InMemoryBus()

class FakeProducer {
  async connect() {}
  async disconnect() {}
  async send({ topic, messages }: { topic: string; messages: Message[] }) {
    for (const m of messages) BUS.publish(topic, m)
  }
}

class FakeConsumer {
  private subscriptions: Array<string | RegExp> = []
  public eachMessage?: (args: { topic: string; message: { key: Buffer | null; value: Buffer | null } }) => void

  async connect() {}
  async disconnect() {}
  async subscribe({ topic }: { topic: string | RegExp; fromBeginning?: boolean }) {
    this.subscriptions.push(topic)
  }
  async run({ eachMessage }: { eachMessage: FakeConsumer['eachMessage'] }) {
    this.eachMessage = eachMessage!
    BUS.consumers.add(this)
  }
  matches(topic: string) {
    return this.subscriptions.some(p => (typeof p === 'string' ? p === topic : p.test(topic)))
  }
}

let installed = false
export function ensureKafkaMock() {
  if (installed) return
  // Replace prototype methods once for all tests
  // @ts-ignore
  KafkaJS.prototype.producer = function () { return new FakeProducer() as any }
  // @ts-ignore
  KafkaJS.prototype.consumer = function () { return new FakeConsumer() as any }
  installed = true
}

export function resetKafkaMock() {
  BUS.consumers.clear()
}


