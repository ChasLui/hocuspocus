#!/usr/bin/env node

import { Logger } from "@hocuspocus/extension-logger";
import { Kafka } from "@hocuspocus/extension-kafka";
import { Redis } from "@hocuspocus/extension-redis";
import { S3 } from "@hocuspocus/extension-s3";
import { SQLite } from "@hocuspocus/extension-sqlite";
import { Webhook } from "@hocuspocus/extension-webhook";
import { Server } from "@hocuspocus/server";
import meow from "meow";

export const cli = meow(
	`
  Usage
    $ hocuspocus [options]

  Options
    --port=, -p     Set the port, defaults to 1234.
    --webhook=, -w  Configure a custom webhook.
    --sqlite=, -s   Store data in a SQLite database, defaults to :memory:.
    --s3            Store data in S3 or S3-compatible storage.
    --s3-bucket=    S3 bucket name (required when using --s3).
    --s3-region=    S3 region, defaults to us-east-1.
    --s3-prefix=    S3 key prefix for documents.
    --s3-endpoint=  S3 endpoint URL (for S3-compatible services like MinIO).
    --kafka         Enable Kafka extension for horizontal scaling.
    --kafka-brokers Comma-separated list of Kafka brokers (required when using --kafka).
    --kafka-prefix  Kafka topic prefix, defaults to hocuspocus.
    --kafka-group   Kafka consumer group id base, defaults to hocuspocus.
    --kafka-id      Unique instance identifier. Default is a random UUID.
    --kafka-disconnect-delay  Delay (ms) before unloading docs after store/disconnect. Default 1000.
    --kafka-lock-timeout      TTL (ms) for best-effort locks. Default 1000.
    --redis          Enable Redis extension for horizontal scaling.
    --redis-host=    Redis host, defaults to 127.0.0.1.
    --redis-port=    Redis port, defaults to 6379.
    --redis-prefix=  Redis key prefix, defaults to hocuspocus.
    --redis-id=      Unique instance identifier. Default is a random UUID.
    --redis-disconnect-delay  Delay (ms) before unloading docs after store/disconnect. Default 1000.
    --redis-lock-timeout      TTL (ms) for distributed lock. Default 1000.
    --version       Show the current version number.

  Examples
    $ hocuspocus --port 8080
    $ hocuspocus --webhook http://localhost/webhooks/hocuspocus
    $ hocuspocus --sqlite
    $ hocuspocus --sqlite database/default.sqlite
    $ hocuspocus --s3 --s3-bucket my-docs
    $ hocuspocus --s3 --s3-bucket my-docs --s3-region eu-west-1
    $ hocuspocus --s3 --s3-bucket my-docs --s3-endpoint http://localhost:9000
    $ hocuspocus --kafka --kafka-brokers 127.0.0.1:9092
    $ hocuspocus --kafka --kafka-brokers 10.0.0.1:9092,10.0.0.2:9092 --kafka-prefix myapp --kafka-group mygroup
    $ hocuspocus --redis --redis-host 127.0.0.1 --redis-port 6379

  Environment Variables (for S3)
    AWS_ACCESS_KEY_ID       AWS access key ID
    AWS_SECRET_ACCESS_KEY   AWS secret access key
    AWS_REGION              AWS region (alternative to --s3-region)

  Environment Variables (for Kafka)
    KAFKA_BROKERS          Comma-separated brokers, e.g. 127.0.0.1:9092

  Environment Variables (for Redis)
    REDIS_HOST             Redis host (alternative to --redis-host)
    REDIS_PORT             Redis port (alternative to --redis-port)
`,
	{
		importMeta: import.meta,
		flags: {
			port: {
				type: "string",
				shortFlag: "p",
				default: "1234",
			},
			webhook: {
				type: "string",
				shortFlag: "w",
				default: "",
			},
			sqlite: {
				type: "string",
				shortFlag: "s",
				default: "",
			},
			s3: {
				type: "boolean",
				default: false,
			},
			s3Bucket: {
				type: "string",
				default: "",
			},
			s3Region: {
				type: "string",
				default: "us-east-1",
			},
			s3Prefix: {
				type: "string",
				default: "",
			},
			s3Endpoint: {
				type: "string",
				default: "",
			},
      kafka: {
        type: "boolean",
        default: false,
      },
      kafkaBrokers: {
        type: "string",
        default: "",
      },
      kafkaPrefix: {
        type: "string",
        default: "hocuspocus",
      },
      kafkaGroup: {
        type: "string",
        default: "hocuspocus",
      },
      kafkaId: {
        type: "string",
        default: "",
      },
      kafkaDisconnectDelay: {
        type: "string",
        default: "1000",
      },
      kafkaLockTimeout: {
        type: "string",
        default: "1000",
      },
      redis: {
        type: "boolean",
        default: false,
      },
      redisHost: {
        type: "string",
        default: "",
      },
      redisPort: {
        type: "string",
        default: "",
      },
      redisPrefix: {
        type: "string",
        default: "hocuspocus",
      },
      redisId: {
        type: "string",
        default: "",
      },
      redisDisconnectDelay: {
        type: "string",
        default: "1000",
      },
      redisLockTimeout: {
        type: "string",
        default: "1000",
      },
		},
	},
);

export const getConfiguredWebhookExtension = () => {
	return cli.flags.webhook
		? new Webhook({
				url: cli.flags.webhook,
			})
		: undefined;
};

export const getConfiguredSQLiteExtension = () => {
	if (cli.flags.sqlite) {
		return new SQLite({
			database: cli.flags.sqlite,
		});
	}
	if (process.argv.includes("--sqlite")) {
		return new SQLite();
	}

	return undefined;
};

export const getConfiguredS3Extension = () => {
	if (!cli.flags.s3) {
		return undefined;
	}

	const bucket = cli.flags.s3Bucket || process.env.S3_BUCKET;
	if (!bucket) {
		console.error("❌ S3 bucket is required. Use --s3-bucket or set S3_BUCKET environment variable.");
		process.exit(1);
	}

	const config = {
		bucket,
		region: cli.flags.s3Region || process.env.AWS_REGION || "us-east-1",
	};

	if (cli.flags.s3Prefix) {
		config.prefix = cli.flags.s3Prefix;
	}

	if (cli.flags.s3Endpoint) {
		config.endpoint = cli.flags.s3Endpoint;
		config.forcePathStyle = true;
	}

	if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
		config.credentials = {
			accessKeyId: process.env.AWS_ACCESS_KEY_ID,
			secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
		};
	}

	return new S3(config);
};

export const getConfiguredKafkaExtension = () => {
  if (!cli.flags.kafka) {
    return undefined;
  }

  const brokersSource = cli.flags.kafkaBrokers || process.env.KAFKA_BROKERS || "";
  const brokers = brokersSource
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (brokers.length === 0) {
    console.error("❌ Kafka brokers are required. Use --kafka-brokers or set KAFKA_BROKERS environment variable.");
    process.exit(1);
  }

  const config = {
    kafka: { brokers },
    prefix: cli.flags.kafkaPrefix || "hocuspocus",
    groupIdBase: cli.flags.kafkaGroup || "hocuspocus",
    disconnectDelay: Number.parseInt(cli.flags.kafkaDisconnectDelay || "1000", 10),
    lockTimeout: Number.parseInt(cli.flags.kafkaLockTimeout || "1000", 10),
  };

  if (cli.flags.kafkaId) {
    config.identifier = cli.flags.kafkaId;
  }

  return new Kafka(config);
};

export const getConfiguredRedisExtension = () => {
  if (!cli.flags.redis) {
    return undefined;
  }

  const host = cli.flags.redisHost || process.env.REDIS_HOST || "127.0.0.1";
  const portString = cli.flags.redisPort || process.env.REDIS_PORT || "6379";
  const port = Number.parseInt(portString, 10);

  const config = {
    host,
    port,
    prefix: cli.flags.redisPrefix || "hocuspocus",
    disconnectDelay: Number.parseInt(cli.flags.redisDisconnectDelay || "1000", 10),
    lockTimeout: Number.parseInt(cli.flags.redisLockTimeout || "1000", 10),
  };

  if (cli.flags.redisId) {
    config.identifier = cli.flags.redisId;
  }

  return new Redis(config);
};

const server = new Server({
	port: Number.parseInt(cli.flags.port, 10),
	extensions: [
		new Logger(),
		getConfiguredWebhookExtension(),
		getConfiguredSQLiteExtension(),
		getConfiguredS3Extension(),
    getConfiguredKafkaExtension(),
    getConfiguredRedisExtension(),
	].filter((extension) => extension),
});

server.listen();
