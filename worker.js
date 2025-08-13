const { fork } = require('child_process')
const { MongoClient, ObjectId } = require('mongodb')
const path = require('path')
const nconf = require('nconf')

nconf.file(path.join(__dirname, `env/${process.env.NODE_ENV || 'development'}.json`))

const MONGO_URI = nconf.get('MONGODB_URI')
const DB_NAME = nconf.get('MONGODB_NAME')
const COLLECTION_NAME = 'assignments'

const MAX_LOAD = parseInt(nconf.get('MAX_LOAD') || 5)
const MAX_USAGE = parseInt(nconf.get('CONSUMER_USAGE_LIMIT') || 5)

const consumers = []
const idleConsumers = new Set()
const activeAssignments = new Map()
const consumerUsageCount = new Map()

async function startWorkerManager() {
  const client = new MongoClient(MONGO_URI)
  await client.connect()
  const db = client.db(DB_NAME)
  const collection = db.collection(COLLECTION_NAME)

  console.log(`Worker Manager (PID ${process.pid}) started. Polling DB for queue assignments...`)

  async function pollDB() {
    try {
      const assignments = await collection.find({ worker: `${process.pid}` }).toArray()

      for (const assignment of assignments) {
        const assignmentId = assignment._id.toString()

        if (!activeAssignments.has(assignmentId)) {
          if (idleConsumers.size > 0) {
            const consumerIndex = Array.from(idleConsumers)[0]
            const consumer = consumers[consumerIndex]
            idleConsumers.delete(consumerIndex)
            activeAssignments.set(assignmentId, consumerIndex)

            consumer.send({
              type: 'assign',
              assignmentId: assignmentId,
              queueUrl: assignment.queueUrl
            })

            console.log(`Assigned assignment ${assignmentId} to consumer PID ${consumer.pid}`)
          } else if ((consumers.length - idleConsumers.size) < MAX_LOAD) {
            const consumerIndex = consumers.length
            const consumer = fork(path.join(__dirname, 'consumer.js'))

            consumers.push(consumer)
            activeAssignments.set(assignmentId, consumerIndex)
            consumerUsageCount.set(consumer.pid, 1)

            consumer.on('message', async msg => {
              if (msg.type === 'done') {
                const donePid = msg.consumerPid
                const doneAssignmentId = msg.assignmentId
                const usage = consumerUsageCount.get(donePid) || 1

                console.log(`Consumer PID ${donePid} finished assignment ${doneAssignmentId}`)
                activeAssignments.delete(doneAssignmentId)

                try {
                  await collection.deleteOne({ _id: new ObjectId(doneAssignmentId) })
                  console.log(`Deleted assignment ${doneAssignmentId} from DB`)
                } catch (err) {
                  console.error(`Failed to delete assignment ${doneAssignmentId}:`, err)
                }

                if (usage >= MAX_USAGE) {
                  console.log(`Terminating consumer PID ${donePid} after ${MAX_USAGE} assignments`)
                  const c = consumers.find(c => c.pid === donePid)
                  c.kill()
                } else {
                  const index = consumers.findIndex(c => c.pid === donePid)
                  idleConsumers.add(index)
                  consumerUsageCount.set(donePid, usage + 1)
                }
              }
            })

            consumer.on('exit', () => {
              console.log(`Consumer process exited: PID ${consumer.pid}`)
              const index = consumers.findIndex(c => c.pid === consumer.pid)
              idleConsumers.delete(index)
              consumerUsageCount.delete(consumer.pid)
            })

            consumer.send({
              type: 'assign',
              assignmentId: assignmentId,
              queueUrl: assignment.queueUrl
            })

            console.log(`Forked and assigned assignment ${assignmentId} to new consumer PID ${consumer.pid}`)
          }
        }
      }
    } catch (err) {
      console.error('Error polling DB:', err)
    }

    setTimeout(pollDB, 1000)
  }

  pollDB()
}

async function registerWorkerInstance() {
  try {
    const client = new MongoClient(MONGO_URI)
    await client.connect()
    const db = client.db(DB_NAME)
    await db.collection('workers').insertOne({
      pid: process.pid,
      startedAt: new Date()
    })
    console.log(`Worker process registered with PID ${process.pid}`)
  } catch (err) {
    console.error('Failed to register worker in DB:', err)
  }
}

registerWorkerInstance()
  .then(() => startWorkerManager())
  .catch(err => {
    console.error('Worker manager failed to start:', err)
    process.exit(1)
  })
