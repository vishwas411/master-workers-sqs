# Distributed Queue Processing System

A fault-tolerant distributed worker-consumer system built using **Node.js**, **MongoDB**, and **AWS SQS** (LocalStack for local testing). The system manages dynamic queue assignment, scalable message processing, real-time job tracking, and includes race condition protection for concurrent queue assignments.

## 🚀 Recent Major Updates

- **Completion-Based Message Counting:** Jobs now update message count once at completion with accurate counts, fixing consumer reuse bugs and reducing IPC overhead
- **Jobs Tracking System:** Complete lifecycle tracking with automatic cleanup - job documents auto-purge after 5 days
- **Dynamic Concurrency Control:** Consumers now fetch queue-specific concurrency from database instead of using fixed environment variables
- **Enhanced Assignment Collection:** Assignment documents include queue ObjectId references for proper data relationships
- **AWS SDK v3:** Upgraded to modern, modular AWS SDK for better performance and maintenance
- **Queue Metadata Management:** Complete lifecycle management with concurrency control
- **One-Way Smart Sync:** DB → SQS sync preserves ObjectIds while ensuring consistency
- **Enhanced CLI:** Professional queue management with concurrency configuration
- **nconf Configuration:** Centralized, environment-specific configuration management

## 📌 Features

- **Master-Worker Architecture:** A centralized master assigns queues to workers. Each worker manages its own pool of consumers.
- **Comprehensive Jobs Tracking:** Real-time monitoring of queue processing with detailed lifecycle tracking, performance metrics, and status transitions.
- **Efficient Message Counting:** Jobs track total processed messages with single database update at completion, supporting consumer reuse and reducing IPC overhead.
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

### `jobs` (NEW - Complete Lifecycle Tracking)
Comprehensive tracking for all queue processing operations with real-time status monitoring.

**Purpose:** Audit trail, performance monitoring, and operational visibility for queue processing.

**Document Structure:**
```json
{
  "_id": "ObjectId(...)",
  "queueName": "orders-processing",
  "queueUrl": "http://localhost:4566/000000000000/orders-processing",
  "queueId": "ObjectId(...)",  // Reference to queues collection
  "status": "running",         // queued | running | completed
  "messageCount": 23,          // Total messages processed
  "processor": {
    "workerPid": "12345",      // Worker that received assignment
    "consumerPid": "67890"     // Consumer actually processing messages
  },
  "createdAt": "2025-08-13T19:13:22.817Z",    // Job creation time
  "startedAt": "2025-08-13T19:13:45.123Z",    // Processing start time  
  "endedAt": "2025-08-13T19:14:12.456Z",      // Processing completion time
  "lastModified": "2025-08-13T19:14:12.456Z"  // Last status update
}
```

**Key Features:**
- **Status Transitions:** Automatic tracking through queued → running → completed lifecycle
- **Completion-Based Counting:** Message count updated once at job completion for accuracy and performance
- **Performance Metrics:** Message counts, processing duration, timing analytics
- **Process Attribution:** Full traceability of which worker/consumer handled each job
- **Consumer Reuse Support:** Accurate counting across multiple consumer assignments
- **Efficient Indexing:** Compound indexes on `{status, createdAt}` and `{queueUrl, status}` for fast queries
- **Automatic Cleanup:** TTL index automatically purges job documents after 5 days from last modification

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
- **Dynamic Concurrency:** Queue-specific concurrency fetched from database
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

## 🚀 Quick Start (Local Mode)

### **1. Start Infrastructure Services**

```bash
# Quick Start (Recommended)
./start-services.sh

# Stop Services
./stop-services.sh

# Alternative: Docker/Podman Compose (if available)
podman-compose up -d  # or docker-compose up -d

# Check service health
podman pod ps
podman ps --pod
```

**Podman Pod Configuration:**
- **Pod Name**: `masterworkers-pod` (both services share networking)
- **LocalStack**: SQS simulation on port 4566
- **MongoDB**: Database on port 27017  
- **Volumes**: Persistent data storage (`localstack_data`, `mongodb_data`)
- **Network**: Shared pod network for optimal communication

### **2. Start Application**

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

### **Runtime Requirements**
- **Node.js** >= 18.x
- **MongoDB** >= 4.x (or container via Podman/Docker)
- **LocalStack** (or AWS) for SQS simulation (or container via Podman/Docker)

### **Container Support** 
- **Podman/Docker** for containerized MongoDB and LocalStack
- **docker-compose.yml** included for easy service management

### **Node.js Dependencies**
- **AWS SDK v3** (`@aws-sdk/client-sqs`) - Modern, modular, actively maintained
- **async** - Concurrency control library for message processing
- **nconf** - Environment-specific configuration management
- **MongoDB Driver** - Native MongoDB client for Node.js

---

This project demonstrates how to build fault-tolerant, distributed, and observable queue processing pipelines in Node.js with extensibility for real-world scale.