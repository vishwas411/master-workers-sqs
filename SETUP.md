# 🚀 Complete Setup Guide

This guide will help you set up the Master-Workers-SQS system from scratch on your local machine.

## 📋 Prerequisites Checklist

Before starting, make sure you have these installed:

- [ ] **Node.js** >= 18.x - [Download here](https://nodejs.org/)
- [ ] **Git** - [Download here](https://git-scm.com/downloads)  
- [ ] **Container Runtime** (choose one):
  - [ ] **Podman** (Recommended) - [Install Guide](https://podman.io/getting-started/installation)
  - [ ] **Docker** (Alternative) - [Install Guide](https://docs.docker.com/get-docker/)

### Verify Prerequisites
```bash
node --version    # Should show v18.x or higher
git --version     # Any recent version
podman --version  # or docker --version
```

## 🛠️ Step-by-Step Setup

### 1. Clone Repository
```bash
git clone https://github.com/vishwas411/master-workers-sqs.git
cd master-workers-sqs-1
```

### 2. Install Node.js Dependencies
```bash
npm install
```

### 3. Start Infrastructure Services
```bash
# This starts both LocalStack (SQS) and MongoDB
./start-services.sh
```

**Expected output:**
```
🚀 Starting Master-Workers infrastructure services...
📦 Starting LocalStack (SQS)...
📦 Starting MongoDB...
✅ LocalStack (SQS) is ready on port 4566
✅ MongoDB is ready on port 27017
🎯 Infrastructure services started!
```

### 4. Start the Application
```bash
# Start both master and workers (recommended)
NODE_ENV=development MODE=MW node server.js
```

**Expected output:**
```
Server starting in MODE=MW
Ensured unique index on assignments.queueUrl
Ensured unique index on queues.name
...
Master API running at http://localhost:3000
Worker Manager (PID xxxx) started. Polling DB for queue assignments...
```

## ✅ Verification Steps

### Test SQS Operations
```bash
# Create a test queue
node sqs.js create my-first-queue

# Send some test messages
node sqs.js send my-first-queue 10

# Check queue size
node sqs.js size my-first-queue

# List all queues
node sqs.js list
```

### Check Database Collections
```bash
# View created queues
mongosh masterworkers --eval "db.queues.find().pretty()"

# Monitor jobs (after messages are processed)
mongosh masterworkers --eval "db.jobs.find().sort({createdAt: -1}).limit(3).pretty()"

# Check active assignments
mongosh masterworkers --eval "db.assignments.find().pretty()"
```

### Monitor Processing
Watch the application logs to see messages being processed in real-time.

## 🎯 Quick Test Workflow

Run this complete test to verify everything works:

```bash
# 1. Create queue and send messages
node sqs.js create test-workflow
node sqs.js send test-workflow 5

# 2. Check processing in MongoDB
mongosh masterworkers --eval "
  db.jobs.find(
    {queueName: 'test-workflow'}, 
    {status: 1, messageCount: 1, createdAt: 1}
  ).sort({createdAt: -1}).limit(1).pretty()
"

# 3. Verify queue is empty after processing
node sqs.js size test-workflow
```

## 🛑 Stop Services

When done testing:
```bash
# Stop all infrastructure
./stop-services.sh

# Stop the application (Ctrl+C in terminal)
```

## 🐛 Common Issues

### "Command not found: ./start-services.sh"
```bash
chmod +x start-services.sh stop-services.sh
```

### "Port already in use"
```bash
# Check what's using the ports
lsof -i :4566  # LocalStack
lsof -i :27017 # MongoDB

# Stop any conflicting services
./stop-services.sh
```

### "Cannot connect to MongoDB"
```bash
# Check container status
podman ps --pod

# Check MongoDB logs
podman logs mongodb-masterworkers
```

### "SQS operations fail"
```bash
# Verify LocalStack health
curl http://localhost:4566/_localstack/health

# Check LocalStack logs
podman logs localstack-sqs
```

## 📚 Next Steps

After successful setup:

1. **Explore the CLI**: Try different `sqs.js` commands
2. **Monitor Processing**: Watch logs as messages are processed
3. **Database Inspection**: Use MongoDB queries to understand data flow
4. **Configuration**: Modify `env/development.json` for custom settings
5. **Testing**: Run `npm test` to execute the test suite

## 🆘 Getting Help

If you encounter issues:

1. Check the [Troubleshooting section](README.md#troubleshooting) in README
2. Verify all prerequisites are correctly installed
3. Make sure no other services are using ports 4566 or 27017
4. Check container logs for detailed error messages

---

**✅ Success!** If all steps completed without errors, you now have a fully functional distributed queue processing system running locally!
