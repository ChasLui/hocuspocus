# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hocuspocus is a plug & play collaboration backend based on Y.js. It provides real-time collaborative editing capabilities through WebSocket connections with various persistence and scaling extensions.

## Architecture

### Monorepo Structure
- **packages/**: Core packages organized as independent modules
  - `server/`: Main Hocuspocus server implementation
  - `provider/`: Client-side provider for connecting to Hocuspocus
  - `extension-*`: Various extensions (database, redis, s3, sqlite, throttle, webhook, logger)
  - `cli/`: Command-line interface
  - `transformer/`: Document transformation utilities
  - `common/`: Shared utilities
- **playground/**: Development playground with frontend/backend examples
- **tests/**: Comprehensive test suite organized by component
- **docs/**: Documentation files

### Core Components
- **Server**: WebSocket server handling collaborative documents
- **Extensions**: Plugin system for persistence (S3, SQLite, Database), scaling (Redis), and other features
- **Provider**: Client-side library for connecting applications to Hocuspocus
- **Documents**: Y.js documents managing collaborative state

## Development Commands

### Essential Commands
```bash
# Install dependencies and start development environment
npm run dev:setup              # Complete setup (.env + Docker services)
npm test                       # Run full test suite with AVA
npm run test:watch             # Run tests in watch mode
npm run lint                   # Run Biome linter and TypeScript checks
npm run lint:fix               # Auto-fix linting issues
```

### Build and Release
```bash
npm run build:packages         # Build all packages
npm run build:watch            # Build packages in watch mode
npm clean:packages             # Clean build artifacts
```

### Development Services
```bash
npm run dev:services           # Start Docker services (Redis + MinIO S3)
npm run dev:services:down      # Stop Docker services
npm run dev:services:reset     # Reset services and clear data
npm run dev:test-s3            # Test S3/MinIO configuration
```

### Playground Examples
```bash
npm run playground             # Default playground (frontend + backend)
npm run playground:s3          # S3 extension example
npm run playground:redis       # Redis scaling example
npm run playground:s3-redis    # Combined S3 + Redis example
```

## Testing

### Test Framework
- Uses **AVA** test runner with TypeScript support
- Tests are located in `tests/` directory organized by component
- Worker threads disabled due to Y.js limitations
- Uses experimental TypeScript transform for direct .ts execution

### Running Specific Tests
```bash
# Run tests for specific components
npx ava tests/server/*.ts
npx ava tests/extension-s3/*.ts
npx ava tests/provider/*.ts
```

### Test Dependencies
**S3 Extension Tests**: Require MinIO service running locally
- Start services: `npm run dev:services`
- Test connection: `npm run dev:test-s3`
- Uses test bucket `hocuspocus-test` with MinIO at `localhost:9000`

**Redis Extension Tests**: Require Redis service
- Configured in `tests/utils/redisConnectionSettings.ts`
- Uses local Redis at `localhost:6379`

## Extension Development

### Creating Extensions
Extensions follow a hook-based pattern with lifecycle methods:
- `onConnect`, `onDisconnect`: Connection management
- `onLoadDocument`, `onStoreDocument`: Document persistence
- `onChange`, `onAwarenessUpdate`: Document state changes
- `onAuthenticate`: Authentication handling

### Key Extension Types
- **Persistence**: S3, SQLite, Database extensions for document storage
- **Scaling**: Redis extension for multi-instance coordination
- **Utility**: Logger, Throttle, Webhook extensions for operational features

## Configuration

### Environment Setup
- Copy `.env.example` to `.env` for local development
- Docker Compose provides Redis and MinIO services
- MinIO credentials: `minioadmin/minioadmin`
- Default buckets: `hocuspocus-documents`, `hocuspocus-test`

### TypeScript Configuration
- Uses TypeScript 5.8.2 with strict configuration
- Experimental features enabled: `--experimental-transform-types`
- Module resolution set to Node.js ESM

## Development Notes

### Y.js Integration
- All document operations must be performed within transactions
- Documents are automatically synchronized across connections
- Use `doc.transact()` for atomic changes

### WebSocket Communication
- Server handles WebSocket upgrades and binary protocols
- Provider manages connection state and reconnection
- Awareness API handles user presence information

### Performance Considerations
- Documents are unloaded from memory when no connections remain
- Debounced document storage prevents excessive persistence calls
- Redis extension enables horizontal scaling across multiple server instances