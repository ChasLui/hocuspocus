import { Server } from "@hocuspocus/server";
import { Logger } from "@hocuspocus/extension-logger";
import { Kafka } from "@hocuspocus/extension-kafka";
import { SQLite } from "@hocuspocus/extension-sqlite";
import { S3 } from "@hocuspocus/extension-s3";

const brokers = (process.env.KAFKA_BROKERS || "127.0.0.1:9092").split(",");

// 1) Kafka + Database (SQLite)
const kafkaSql1 = new Server({
  port: 8000,
  name: "kafka-sql-1",
  extensions: [new Logger(), new Kafka({ kafka: { brokers } }), new SQLite()],
});

const kafkaSql2 = new Server({
  port: 8001,
  name: "kafka-sql-2",
  extensions: [new Logger(), new Kafka({ kafka: { brokers } }), new SQLite()],
});

// 2) Kafka + S3 (MinIO by default)
const kafkaS31 = new Server({
  port: 8002,
  name: "kafka-s3-1",
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

const kafkaS32 = new Server({
  port: 8003,
  name: "kafka-s3-2",
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

[
  // start servers
  (
    kafkaSql1,
    kafkaSql2,
    kafkaS31,
    kafkaS32
  )
].forEach((s) => s.listen());

console.log(`
🚀 Kafka Playground Started

  Kafka + SQLite:
    http://localhost:8000
    http://localhost:8001
  Kafka + S3 (MinIO):
    http://localhost:8002
    http://localhost:8003
`);
