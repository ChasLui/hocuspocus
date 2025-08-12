# Extension Kafka

Scale Hocuspocus horizontally using Kafka. Run multiple server instances behind a load balancer and sync document updates,
awareness, and stateless messages across instances through Kafka.

This extension does not persist data; it only synchronizes it across nodes. Use a persistence extension such as
[Database](/server/extensions#Database), [SQLite](/server/extensions/sqlite) or [S3](/server/extensions/s3) to store documents.

## Installation

```bash
npm install @hocuspocus/extension-kafka kafkajs
```

Requires KafkaJS v2.2+ (regex topic subscriptions) and a Kafka broker (3.x works fine). A local broker is provided in the
repo `docker-compose.yml` as service `kafka`.

## Configuration

```ts
import { Server } from "@hocuspocus/server";
import { Kafka } from "@hocuspocus/extension-kafka";

const server = new Server({
  extensions: [
    new Kafka({
      kafka: { brokers: ["localhost:9092"] }, // KafkaJS client config
      // identifier: "host-123",          // optional unique instance id (default random UUID)
      // prefix: "hocuspocus",            // topic prefix, final topic `${prefix}.${documentName}`
      // groupIdBase: "hocuspocus",       // base for consumer group id
      // disconnectDelay: 1000,            // ms to delay document unload/afterStore coordination
      // lockTimeout: 1000,                 // ms TTL for best-effort locks
    }),
  ],
});

server.listen();
```

### Options

- `kafka` (required): KafkaJS `KafkaConfig` with `brokers: string[]`.
- `identifier` (optional): Unique identifier for this server instance. Default: random UUID, used for message filtering and lock ownership.
- `prefix` (optional): Topic prefix. Final per-document topic is `${prefix}.${documentName}`. Default: `hocuspocus`.
- `groupIdBase` (optional): Base for Kafka consumer group id. The effective group is `${groupIdBase}-${identifier}`. Default: `hocuspocus`.
- `disconnectDelay` (optional): Delay used when unloading idle documents and coordinating `afterStoreDocument`. Default: `1000` ms.
- `lockTimeout` (optional): TTL for best-effort lock messages. Default: `1000` ms.

## CLI usage

You can run a Kafka-enabled server using the `@hocuspocus/cli` as well.

```bash
npx @hocuspocus/cli \
  --kafka \
  --kafka-brokers 127.0.0.1:9092 \
  --sqlite # optional persistence
```

Flags:

- `--kafka`: Enable the Kafka extension
- `--kafka-brokers`: Comma-separated list of brokers (required when using `--kafka`); can also set `KAFKA_BROKERS`
- `--kafka-prefix`: Topic prefix, default `hocuspocus`
- `--kafka-group`: Consumer group id base, default `hocuspocus`
- `--kafka-id`: Unique instance identifier, default random UUID
- `--kafka-disconnect-delay`: Delay in ms before unloading documents after store/disconnect, default `1000`
- `--kafka-lock-timeout`: TTL in ms for best-effort locks, default `1000`

Examples:

```bash
hocuspocus --kafka --kafka-brokers 127.0.0.1:9092
hocuspocus --kafka --kafka-brokers 10.0.0.1:9092,10.0.0.2:9092 --kafka-prefix myapp --kafka-group mygroup
```

## How it works

- **Topics**: one Kafka topic per document: `<prefix>.<documentName>`.
- **Subscription**: a single consumer subscribes via regex `^<prefix>\.` and routes messages to documents.
- **Ordering**: messages are produced with `key = documentName` to preserve order per document partition.
- **Awareness and Sync**:
  - On `afterLoadDocument`, the server publishes a first sync step and queries awareness from other instances.
  - On local `onChange`, if the change did not originate from Kafka, a first sync step is broadcast to other instances.
- **Stateless messages**: forwarded to other instances via Kafka before local broadcast.
- **Best-effort locking**: a global locks topic `<prefix>.__locks` is used to coordinate `onStoreDocument/afterStoreDocument` across instances.
  - Lock key: `${prefix}:${documentName}` with `LOCK_REQUEST` and `LOCK_RELEASE` messages; TTL is controlled by `lockTimeout`.
  - This is an advisory mechanism to reduce write contention. For correctness, rely on storage-level optimistic concurrency.

## Usage examples

### Kafka + SQLite

```ts
import { Server } from "@hocuspocus/server";
import { Logger } from "@hocuspocus/extension-logger";
import { Kafka } from "@hocuspocus/extension-kafka";
import { SQLite } from "@hocuspocus/extension-sqlite";

const brokers = (process.env.KAFKA_BROKERS || "127.0.0.1:9092").split(",");

const server1 = new Server({
  name: "kafka-sql-1",
  port: 8000,
  extensions: [new Logger(), new Kafka({ kafka: { brokers } }), new SQLite()],
});

const server2 = new Server({
  name: "kafka-sql-2",
  port: 8001,
  extensions: [new Logger(), new Kafka({ kafka: { brokers } }), new SQLite()],
});

server1.listen();
server2.listen();
```

### Kafka + S3 (MinIO)

```ts
import { Server } from "@hocuspocus/server";
import { Logger } from "@hocuspocus/extension-logger";
import { Kafka } from "@hocuspocus/extension-kafka";
import { S3 } from "@hocuspocus/extension-s3";

const brokers = (process.env.KAFKA_BROKERS || "127.0.0.1:9092").split(",");

const server = new Server({
  name: "kafka-s3-1",
  port: 8002,
  extensions: [
    new Logger(),
    new Kafka({ kafka: { brokers } }),
    new S3({
      bucket: process.env.S3_BUCKET || "hocuspocus-documents",
      endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "minioadmin",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "minioadmin",
      },
    }),
  ],
});

server.listen();
```

## Playground

A full example is available at `playground/backend/src/kafka.ts`.

1. Start local services (Kafka and MinIO):

```bash
docker compose up -d kafka minio minio-init
```

1. Run the demo servers:

```bash
cd playground/backend
KAFKA_BROKERS=127.0.0.1:9092 node --experimental-transform-types ./src/kafka.ts
```

You will get two SQLite-backed servers on ports `8000` and `8001`, and two S3-backed servers on ports `8002` and `8003`.

## Notes

- This extension synchronizes messages only; it does not persist documents.
- The lock mechanism is best-effort and advisory. Use your database/storage for conflict resolution and consistency.
