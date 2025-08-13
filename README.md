# Distributed Queue Processing System

A fault-tolerant distributed worker-consumer system built using **Node.js**, **MongoDB**, and **AWS SQS** (LocalStack for local testing). The system manages dynamic queue assignment, scalable message processing, real-time job tracking, and includes race condition protection for concurrent queue assignments.

## 📌 Features

- **Master-Worker Architecture:** A centralized master assigns queues to workers. Each worker manages its own pool of consumers.
- **Parallel Message Processing:** Consumers handle messages concurrently from assigned queues with configurable concurrency and lifecycle limits.
- **Race Condition Protection:** MongoDB unique indexes prevent duplicate queue assignments under high concurrent load.
- **Job Lifecycle Tracking:** Real-time monitoring of every queue via a `jobs` collection with full audit trail (`queued`, `running`, `completed`).
- **Worker Load Balancing:** Queues are distributed based on worker load and capped using `MAX_LOAD`.
- **Auto-Setup:** Database indexes are automatically created on system startup.
- **Tested Infrastructure:** Integration tests using Mocha simulate full system flows including queue polling, message processing, and job completion.

## 🧱 Project Structure

```
.
├── master.js          # Assigns queues to least-loaded worker and creates job metadata
├── worker.js          # Polls DB for assigned queues, forks consumers, manages their lifecycle
├── consumer.js        # Processes messages in parallel and reports back to worker
├── server.js          # Entry-point to launch in various modes (Master, Worker, MW)
├── sqs.js             # CLI for interacting with queues (create, delete, send, size)
├── env/               # Environment-specific config files (development.json, test.json)
├── __tests__/         # Mocha-based test suites for master, worker, consumer logic
└── README.md
```

## 🗄️ MongoDB Collections

### `assignments`
Tracks queue assignment documents that map queues to workers during processing.
- **Unique Index:** `queueUrl` field prevents duplicate assignments (race condition protection)
- **Ephemeral:** Documents created during assignment, deleted after message processing

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

## ⚙️ Configuration & Scaling

- Uses **LocalStack** (SQS) for local development. Can be easily switched to real AWS by replacing `AWS_SQS_ENDPOINT` in `env/development.json`.
- Message concurrency is defined via `CONCURRENCY_LIMIT`
- Consumer reuse and limit management via `CONSUMER_USAGE_LIMIT`
- Worker scaling via `WORKER_INSTANCES`

## 📈 Message Handling Capacity

- Default concurrency per consumer: 5
- One worker can spawn up to `MAX_LOAD` consumers (default 5)
- With 2 workers, the system can process up to **50 messages in parallel** (5 queues × 5 concurrent messages × 2 workers)
- Can be scaled horizontally by increasing `WORKER_INSTANCES` and running multiple master processes

## 🔮 Roadmap

- [ ] Add more tests covering failure recovery, job timeout, and SQS errors
- [ ] Modularize the system into a proper microservice
- [ ] Add REST API for job and queue inspection
- [ ] Support multi-master failover architecture for high availability

## 🧪 Testing

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

## 📦 Requirements

- Node.js >= 18.x
- MongoDB >= 4.x
- LocalStack (or AWS) for SQS simulation

---

This project demonstrates how to build fault-tolerant, distributed, and observable queue processing pipelines in Node.js with extensibility for real-world scale.