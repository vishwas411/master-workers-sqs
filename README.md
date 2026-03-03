# Distributed Queue Processing System

A fault-tolerant distributed worker-consumer system built using **Node.js 22**, **MongoDB**, and **AWS SQS** (LocalStack for local development). The system manages dynamic queue assignment, scalable message processing, real-time job tracking, and includes race condition protection for concurrent queue assignments.

## Features

- **Master-Worker Architecture:** A centralized master assigns queues to workers. Each worker manages its own pool of consumers.
- **Jobs Tracking:** Real-time monitoring of queue processing with lifecycle tracking (queued → running → completed), performance metrics, and automatic cleanup via TTL indexes.
- **Completion-Based Counting:** Jobs track total processed messages with a single database update at completion, supporting consumer reuse and reducing IPC overhead.
- **Dynamic Concurrency:** Consumers fetch queue-specific concurrency limits (1-5) from the database at runtime, falling back to a default of 5.
- **Race Condition Protection:** MongoDB unique indexes on `assignments.queueUrl` prevent duplicate queue assignments under concurrent load.
- **Queue Metadata Management:** Complete queue lifecycle with concurrency control, creation tracking, and DB → SQS one-way sync that preserves MongoDB ObjectIds.
- **Worker Load Balancing:** Queues are distributed to the least-loaded worker, capped by `MAX_LOAD`.
- **Auto-Setup:** Database indexes and configuration are automatically created on startup.
- **CLI:** Queue management via `src/cli/sqs.js` (create, delete, list, send, size, set-concurrency).

## Project Structure

```
.
├── src/
│   ├── server.js              # entry point, launches master/worker based on MODE
│   ├── services/
│   │   ├── master.js          # Express API, queue assignment, job creation
│   │   ├── worker.js          # polls DB for assignments, forks/reuses consumers
│   │   └── consumer.js        # processes SQS messages in parallel via IPC
│   └── cli/
│       └── sqs.js             # CLI for queue management and master notification
├── config/
│   └── jest.config.js         # Jest test configuration
├── scripts/
│   ├── start-services.sh      # Podman pod setup script
│   ├── stop-services.sh       # Podman pod teardown script
│   └── docker-compose.yml     # LocalStack + MongoDB service definitions
├── env/                       # environment-specific config (development.json, unittest.json)
└── __tests__/                 # Jest test suites
```

## Prerequisites

- **Node.js** 22 ([Download](https://nodejs.org/))
- **Git** ([Download](https://git-scm.com/downloads))
- **Container Runtime** (one of):
  - **Podman** ([Install Guide](https://podman.io/getting-started/installation)) — Recommended
  - **Docker** ([Install Guide](https://docs.docker.com/get-docker/))

```bash
node --version    # Should show v22.x
podman --version  # or docker --version
```

## Getting Started

### 1. Clone and Install

```bash
git clone https://github.com/vishwas411/master-workers-sqs.git
cd master-workers-sqs
npm install
```

### 2. Start Infrastructure

```bash
./scripts/start-services.sh
```

This creates a Podman pod with:
- **LocalStack** (SQS) on port 4566
- **MongoDB 7** on port 27017

Verify with `podman pod ps`.

### 3. Start the Application

```bash
NODE_ENV=development MODE=MW node src/server.js
```

| Mode | Command | Description |
|------|---------|-------------|
| `MW` | `npm start` | Master + Workers (default) |
| `M`  | `npm run start:master` | Master only |
| `W`  | `npm run start:worker` | Worker only |

### 4. Test It

```bash
node src/cli/sqs.js create my-queue
node src/cli/sqs.js send my-queue 10
node src/cli/sqs.js size my-queue
```

### 5. Stop

```bash
./scripts/stop-services.sh
```

## MongoDB Collections

### `queues`

Persistent queue metadata. Each document holds `name`, `queueUrl`, `concurrency` (1-5), `createdAt`, `syncedAt`, `updatedAt`. Unique indexes on `name` and `queueUrl`.

### `assignments`

Ephemeral queue-to-worker mappings. Created when a queue is assigned, deleted after processing completes. Includes `queueId` referencing the `queues` collection. Unique index on `queueUrl` prevents duplicates.

### `workers`

Tracks active worker PIDs and their start time.

### `jobs`

Complete lifecycle tracking for every queue processing operation.

```json
{
  "queueName": "orders",
  "queueUrl": "http://localhost:4566/000000000000/orders",
  "queueId": "ObjectId(...)",
  "status": "completed",
  "messageCount": 23,
  "processor": { "workerPid": "12345", "consumerPid": "67890" },
  "createdAt": "2026-03-01T10:00:00Z",
  "startedAt": "2026-03-01T10:00:01Z",
  "endedAt": "2026-03-01T10:00:15Z",
  "lastModified": "2026-03-01T10:00:15Z"
}
```

- Status transitions: `queued` → `running` → `completed`
- Compound indexes on `{status, createdAt}` and `{queueUrl, status}`
- TTL index on `lastModified` auto-purges documents after 5 days

## CLI Commands

```bash
node src/cli/sqs.js create <name>                  # Create queue (SQS + DB)
node src/cli/sqs.js delete <name>                  # Delete queue (SQS + DB)
node src/cli/sqs.js list                           # List all SQS queues
node src/cli/sqs.js send <name> <count>            # Send test messages + notify master
node src/cli/sqs.js size <name>                    # Check approximate message count
node src/cli/sqs.js set-concurrency <name> <1-5>   # Set queue-specific concurrency
```

## NPM Scripts

```bash
npm start               # MODE=MW (master + workers)
npm run start:master    # MODE=M
npm run start:worker    # MODE=W
npm run setup           # ./scripts/start-services.sh
npm run cleanup         # ./scripts/stop-services.sh
npm test                # Run test suite
npm run test:watch      # Jest watch mode
npm run test:coverage   # Coverage report
npm run queue:create    # node src/cli/sqs.js create
npm run queue:list      # node src/cli/sqs.js list
npm run queue:delete    # node src/cli/sqs.js delete
npm run db:status       # MongoDB stats
npm run db:jobs         # Recent jobs
npm run db:queues       # All queues
```

## Configuration

All settings are managed via `env/<NODE_ENV>.json` using **nconf**:

| Key | Description | Default |
|-----|-------------|---------|
| `AWS_REGION` | AWS region | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | AWS access key | `test` |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | `test` |
| `AWS_SQS_ENDPOINT` | SQS endpoint URL | `http://localhost:4566` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017` |
| `MONGODB_NAME` | Database name | `masterworkers` |
| `PORT` | Master API port | `3000` |
| `MAX_LOAD` | Max queues per worker | `5` |
| `CONSUMER_USAGE_LIMIT` | Max assignments per consumer before recycling | `5` |
| `WORKER_INSTANCES` | Number of worker processes in MW mode | `1` |

## Testing

The test suite uses **Jest** and validates behavior through **database state and IPC messages** rather than console output, making tests resilient to log message changes.

```bash
npm test
```

**27 tests across 4 suites:**

| Suite | Tests | What's Verified |
|-------|-------|-----------------|
| `master.test.js` | 9 | Index creation, job documents, multi-queue assignment, unique constraints, MAX_LOAD enforcement, assignment cleanup, queue prioritization, API availability |
| `worker.test.js` | 5 | Worker registration in DB, job status lifecycle (queued → completed), message count accuracy, consumer reuse, DB connection error handling |
| `consumer.test.js` | 5 | Message count via IPC, batch processing (>10 messages), counter reset on consumer reuse, SQS error resilience, malformed message handling |
| `sqs.test.js` | 8 | Queue CRUD in both SQS and DB, message sending + count verification, concurrency validation, duplicate prevention, non-existent queue handling |

## Message Handling Capacity

- Default concurrency per consumer: **5**
- Max consumers per worker: **MAX_LOAD** (default 5)
- With 2 workers: up to **50 messages in parallel** (5 queues x 5 concurrent x 2 workers)
- Scale horizontally via `WORKER_INSTANCES`

## Troubleshooting

**Port conflicts:**
```bash
lsof -i :4566  # LocalStack
lsof -i :27017 # MongoDB
./scripts/stop-services.sh
```

**Container issues:**
```bash
podman ps --pod
podman logs mongodb-masterworkers
podman logs localstack-sqs
```

**Permission issues:**
```bash
chmod +x scripts/start-services.sh scripts/stop-services.sh
```

**LocalStack health:**
```bash
curl http://localhost:4566/_localstack/health
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@aws-sdk/client-sqs` | AWS SQS client (SDK v3) |
| `async` | Concurrency control for message processing |
| `express` | Master API HTTP server |
| `mongodb` | Native MongoDB driver |
| `nconf` | Environment-specific configuration |
| `dotenv` | Environment variable loading |
| `jest` (dev) | Test framework |

---

Built to demonstrate fault-tolerant, distributed, and observable queue processing pipelines in Node.js.
