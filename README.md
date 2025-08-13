# Distributed Queue Processing System

A fault-tolerant distributed worker-consumer system built using **Node.js**, **MongoDB**, and **AWS SQS** (LocalStack for local testing). The system manages dynamic queue assignment, scalable message processing, real-time job tracking, and includes race condition protection for concurrent queue assignments.

## 🚀 Recent Major Updates

- **Dynamic Concurrency Control:** Consumers now fetch queue-specific concurrency from database instead of using fixed environment variables
- **Enhanced Assignment Collection:** Assignment documents include queue ObjectId references for proper data relationships
- **AWS SDK v3:** Upgraded to modern, modular AWS SDK for better performance and maintenance
- **Queue Metadata Management:** Complete lifecycle management with concurrency control
- **One-Way Smart Sync:** DB → SQS sync preserves ObjectIds while ensuring consistency
- **Enhanced CLI:** Professional queue management with concurrency configuration
- **nconf Configuration:** Centralized, environment-specific configuration management

## 📌 Features

- **Master-Worker Architecture:** A centralized master assigns queues to workers. Each worker manages its own pool of consumers.
- **Dynamic Concurrency Processing:** Consumers automatically fetch and apply queue-specific concurrency limits from the database, overriding global environment settings.
- **Enhanced Data Relationships:** Assignment documents include queue ObjectId references, enabling powerful aggregation queries and maintaining data integrity.
- **Race Condition Protection:** MongoDB unique indexes prevent duplicate queue assignments under high concurrent load.
- **Queue Metadata Management:** Complete queue lifecycle with concurrency control, creation tracking, and metadata sync.
- **Smart Queue Sync:** DB → SQS one-way sync preserves MongoDB ObjectIds while creating missing SQS queues from database records.
- **Worker Load Balancing:** Queues are distributed based on worker load and capped using `MAX_LOAD`.
- **Auto-Setup:** Database indexes and configuration automatically created on system startup.
- **Professional CLI:** Clean, emoji-free command interface for production environments.
- **Modern Dependencies:** AWS SDK v3 with modular imports and improved performance.

## 🧱 Project Structure

```
.
├── master.js          # Assigns queues to least-loaded worker and creates job metadata
├── worker.js          # Polls DB for assigned queues, forks consumers, manages their lifecycle
├── consumer.js        # Processes messages in parallel and reports back to worker
├── server.js          # Entry-point to launch in various modes (Master, Worker, MW)
├── sqs.js             # Enhanced CLI for queue management (create, delete, send, size, set-concurrency)
├── env/               # Environment-specific config files (development.json, test.json)
├── __tests__/         # Mocha-based test suites for master, worker, consumer logic
└── README.md
```

## 🗄️ MongoDB Collections

### `queues`
**NEW:** Persistent queue metadata management
- `name`, `queueUrl`, `createdAt`, `concurrency` (1-5), `syncedAt`, `updatedAt`
- **Unique Indexes:** `name` and `queueUrl` prevent duplicates
- **Purpose:** Central source of truth for queue configuration and concurrency management

### `assignments` (Enhanced with Queue References)
Tracks queue assignment documents that map queues to workers during processing.
- **Queue ObjectId References:** Each assignment includes `queueId` linking to the `queues` collection for proper data relationships
- **Unique Index:** `queueUrl` field prevents duplicate assignments (race condition protection)
- **Ephemeral:** Documents created during assignment, deleted after message processing
- **Data Integrity:** Enables complex aggregation queries between assignments and queues collections

**Example Document:**
```json
{
  "_id": "ObjectId(...)",
  "queueUrl": "http://localhost:4566/000000000000/orders-queue",
  "worker": "worker_12345",
  "queueId": "ObjectId(...)"  // Reference to queues collection
}
```

### `workers`
Tracks active worker PIDs and their start time.

### `jobs`
Tracks queue execution status with fields:
- `queueId`, `qName`
- `status`: `queued`, `running`, `completed`
- `messageCount`, `processor.workerPid`, `processor.consumerPid`
- `createdAt`, `startedAt`, `endedAt`, `lastModified`

## 💡 Use Cases

- Event-driven microservices needing parallel SQS message processing
- Systems requiring queue-specific tracking and audit logs
- Workload balancing in environments with multiple workers

## ⚙️ Enhanced CLI Commands

The `sqs.js` CLI provides comprehensive queue management:

```bash
# Queue Management
node sqs.js create <name>                    # Create SQS queue
node sqs.js delete <name>                    # Delete SQS queue  
node sqs.js list                             # List all queues

# Message Operations  
node sqs.js send <name> <count>              # Send test messages
node sqs.js size <name>                      # Check message count

# Concurrency Management (NEW)
node sqs.js set-concurrency <name> <1-5>     # Configure queue concurrency
```

## ⚙️ Configuration & Scaling

**Environment Configuration (nconf-based):**
- All settings managed via `env/development.json`
- AWS credentials, endpoints, and MongoDB URIs centrally configured
- Uses **LocalStack** (SQS) for local development, easily switchable to real AWS
- **Dynamic Concurrency:** Queue-specific concurrency fetched from database (overrides legacy `CONCURRENCY_LIMIT`)
- Consumer reuse and limit management via `CONSUMER_USAGE_LIMIT`
- Worker scaling via `WORKER_INSTANCES`

**Queue-Specific Concurrency Control:**
- Each queue in the `queues` collection has its own `concurrency` setting (1-5)
- Consumers automatically fetch and apply these limits at runtime
- Falls back to default (5) if queue not found in database
- Configure using: `node sqs.js set-concurrency <queue-name> <concurrency>`

## 📈 Message Handling Capacity

- Default concurrency per consumer: 5
- One worker can spawn up to `MAX_LOAD` consumers (default 5)
- With 2 workers, the system can process up to **50 messages in parallel** (5 queues × 5 concurrent messages × 2 workers)
- Can be scaled horizontally by increasing `WORKER_INSTANCES` and running multiple master processes

## 🧪 Comprehensive Testing Suite

**Verified Scenarios:**
- ✅ Basic SQS Operations (create, delete, list, send, size)
- ✅ Concurrency Management (set-concurrency with validation)
- ✅ Master Startup & Database Sync (one-way DB → SQS)
- ✅ Single Master + Single Worker (message processing)
- ✅ Multi-Worker Load Balancing (queue distribution)
- ✅ Race Condition Protection (unique indexes prevent duplicates)
- ✅ ObjectId Preservation (DB sync maintains MongoDB document IDs)
- ✅ Error Handling (invalid inputs, missing queues, boundary conditions)

**Run Tests:**
```bash
npm install
npm test
```

## 🚀 Start (Local Mode)

```bash
# Start with both master and workers (MW mode)
NODE_ENV=development MODE=MW node server.js

# Or start them separately:
NODE_ENV=development MODE=M node server.js   # Master only
NODE_ENV=development MODE=W node server.js   # Worker only
```

## 🔮 Roadmap

- [ ] Add more tests covering failure recovery, job timeout, and SQS errors
- [ ] Modularize the system into a proper microservice
- [ ] Add REST API for job and queue inspection
- [ ] Support multi-master failover architecture for high availability

## 📦 Requirements & Dependencies

- **Node.js** >= 18.x
- **MongoDB** >= 4.x
- **LocalStack** (or AWS) for SQS simulation
- **AWS SDK v3** (`@aws-sdk/client-sqs`) - Modern, modular, actively maintained
- **nconf** - Environment-specific configuration management
- **MongoDB Driver** - Native MongoDB client for Node.js

---

This project demonstrates how to build fault-tolerant, distributed, and observable queue processing pipelines in Node.js with extensibility for real-world scale.