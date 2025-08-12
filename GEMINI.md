# Hocuspocus Project Context for Qwen Code

## Project Overview

Hocuspocus is a plug-and-play collaboration backend built on top of [Yjs](https://github.com/yjs/yjs). It provides a WebSocket server that facilitates real-time collaborative editing by managing shared Yjs documents. The project is structured as a monorepo using Lerna, containing multiple packages for the core server, extensions (like database persistence, Redis, S3, etc.), a client provider, and playground examples.

**Core Technologies:**
- **Language:** TypeScript
- **Runtime:** Node.js (v22+)
- **Build Tool:** Rollup
- **Monorepo Management:** Lerna
- **Testing:** Ava
- **Linting/Formatting:** Biome, TypeScript Compiler
- **Package Manager:** NPM
- **Key Dependencies:** `yjs`, `ws` (WebSocket), `lib0`

## Project Structure

The project is organized into several key directories:
- `packages/`: Contains the core source code, split into multiple NPM packages.
  - `server/`: The main Hocuspocus server logic (`@hocuspocus/server`).
  - `provider/`: The client-side provider (`@hocuspocus/provider`) for connecting to the server.
  - `common/`: Shared utilities and types (`@hocuspocus/common`).
  - `extension-*/`: Various official extensions (e.g., `extension-sqlite`, `extension-redis`, `extension-s3`).
  - `cli/`: A command-line interface package.
  - `transformer/`: Utilities for transforming document data.
- `playground/`: Example applications demonstrating Hocuspocus usage (frontend and backend examples).
- `tests/`: Integration and unit tests.
- `docs/`: Documentation files.

## Key Packages

### `@hocuspocus/server`
This is the core package. It exports the main `Server` and `Hocuspocus` classes.
- **`Hocuspocus` class:** The central orchestrator managing documents, connections, and extensions.
- **`Server` class:** Wraps the Node.js HTTP and WebSocket servers, handling the network layer.
- **Extensions:** The server's functionality is extended via extension objects that hook into various lifecycle events (e.g., `onConnect`, `onLoadDocument`, `onStoreDocument`).

### `@hocuspocus/provider`
A client-side package that provides a Yjs `WebsocketProvider` to connect to a Hocuspocus server.

### Extensions
Hocuspocus provides official extensions for common needs:
- `@hocuspocus/extension-sqlite`: For persisting document state to an SQLite database.
- `@hocuspocus/extension-redis`: For scaling horizontally using Redis.
- `@hocuspocus/extension-s3`: For persisting document state to S3-compatible storage.
- `@hocuspocus/extension-database`: A generic database persistence driver.
- `@hocuspocus/extension-logger`, `@hocuspocus/extension-throttle`, `@hocuspocus/extension-webhook`: For logging, throttling connections, and sending webhooks.

## Building and Running

### Prerequisites
- Node.js version 22 or higher.
- Docker & Docker Compose (for running development services like Redis and MinIO).

### Development Setup
1.  **Install Dependencies:**
    ```bash
    npm install
    ```
2.  **Set up Environment (`.env` file and Docker services):**
    ```bash
    npm run dev:setup # This runs `dev:env` and `dev:services`
    ```
    This copies `.env.example` to `.env` and starts Docker containers for Redis and MinIO (S3-compatible) as defined in `docker-compose.yml`.

3.  **(Optional) Test S3 Configuration:**
    ```bash
    npm run dev:test-s3
    ```

### Development Scripts
- **Start Default Playground:**
    ```bash
    npm run playground # or npm run playground:default
    ```
    This concurrently runs a frontend example (in `playground/frontend`) and a backend server example (in `playground/backend`) using the default configuration.
- **Start Specific Playgrounds:** There are scripts for various scenarios like `playground:express`, `playground:redis`, `playground:s3`, etc.
- **Build Packages:**
    ```bash
    npm run build:packages
    ```
- **Watch and Rebuild:**
    ```bash
    npm run build:watch
    ```
- **Linting:**
    ```bash
    npm run lint # Check for issues
    npm run lint:fix # Attempt to fix issues
    npm run lint:ts # Type checking
    ```
- **Testing:**
    ```bash
    npm run test # Run tests once
    npm run test:watch # Run tests in watch mode
    ```

### Running the Server Directly
The `packages/cli` package provides a basic CLI entry point. After building, you can run it directly with Node.js, for example, with S3 extension:
```bash
cd packages/cli
node src/index.js --s3 --s3-bucket hocuspocus-documents --s3-endpoint http://localhost:9000
```

## Development Conventions

- **Monorepo:** Packages are managed with Lerna. Changes often span multiple packages.
- **TypeScript:** The project is written in TypeScript with strict type checking (`lint:ts`).
- **Linting & Formatting:** Code style is enforced by Biome. Run `npm run lint:fix` before committing.
- **Testing:** Tests are written using Ava and located in the `tests/` directory. Run `npm run test`.
- **Building:** Source code in `src/` is compiled to `dist/` using Rollup. Run `npm run build:packages`.
- **Extensions:** Extensions are a core part of Hocuspocus, allowing customization and integration with external services. They implement a defined interface with lifecycle hooks.
- **Yjs Integration:** Hocuspocus heavily relies on Yjs for Conflict-free Replicated Data Types (CRDTs) to manage the shared document state.

## Contributing
Please see `docs/contributing.md` for detailed contribution guidelines.