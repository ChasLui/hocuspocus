# Extension Redis

Hocuspocus can be scaled horizontally using the Redis extension. You can spawn multiple instances of the server behind a
load balancer and sync changes and awareness states through Redis. Hocuspocus will propagate all received updates to all other instances
using Redis and thus forward updates to all clients of all Hocuspocus instances.

The Redis extension does not persist data; it only syncs data between instances. Use the [Database](/server/extensions#Database) extension to store your documents.

Please note that all messages will be handled on all instances of Hocuspocus, so if you are trying to reduce cpu load by spawning multiple
servers, you should not connect them via Redis.

Thanks to [@tommoor](https://github.com/tommoor) for writing the initial implementation of that extension.

## Installation

Install the Redis extension with:

```bash
npm install @hocuspocus/extension-redis
```

## Configuration

For a full documentation on all available Redis and Redis cluster options, check out the
[ioredis API docs](https://github.com/luin/ioredis/blob/master/API.md).

```js
import { Server } from "@hocuspocus/server";
import { Redis } from "@hocuspocus/extension-redis";

const server = new Server({
  extensions: [
    new Redis({
      // [required] Hostname of your Redis instance
      host: "127.0.0.1",

      // [required] Port of your Redis instance
      port: 6379,
    }),
  ],
});

server.listen();
```

## Usage

The Redis extension works well with the database extension. Once an instance stores a document, it’s blocked for all
other instances to avoid write conflicts.

```js
import { Server } from "@hocuspocus/server";
import { Logger } from "@hocuspocus/extension-logger";
import { Redis } from "@hocuspocus/extension-redis";
import { SQLite } from "@hocuspocus/extension-sqlite";

// Server 1
const server = new Server({
  name: "server-1", // make sure to use unique server names
  port: 1234,
  extensions: [
    new Logger(),
    new Redis({
      host: "127.0.0.1", // make sure to use the same Redis instance :-)
      port: 6379,
    }),
    new SQLite(),
  ],
});

server.listen();

// Server 2
const anotherServer = new Server({
  name: "server-2",
  port: 1235,
  extensions: [
    new Logger(),
    new Redis({
      host: "127.0.0.1",
      port: 6379,
    }),
    new SQLite(),
  ],
});

anotherServer.listen();
```

## CLI usage

You can run a Redis-enabled server using the `@hocuspocus/cli` as well.

```bash
npx @hocuspocus/cli \
  --redis \
  --redis-host 127.0.0.1 \
  --redis-port 6379 \
  --sqlite # optional persistence
```

Flags:

- `--redis`: Enable the Redis extension
- `--redis-host`: Redis host, default `127.0.0.1`; can also set `REDIS_HOST`
- `--redis-port`: Redis port, default `6379`; can also set `REDIS_PORT`
- `--redis-prefix`: Key prefix, default `hocuspocus`
- `--redis-id`: Unique instance identifier, default random UUID
- `--redis-disconnect-delay`: Delay in ms before unloading documents after store/disconnect, default `1000`
- `--redis-lock-timeout`: TTL in ms for distributed lock, default `1000`

Examples:

```bash
hocuspocus --redis --redis-host 127.0.0.1 --redis-port 6379
hocuspocus --redis --redis-prefix myapp
```
