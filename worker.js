// worker.js - Manages a dynamic pool of sqs consumers
const { fork } = require('child_process')
const { MongoClient, ObjectId } = require('mongodb')
const path = require('path')
const nconf = require('nconf')

nconf.file(path.join(__dirname, `env/${process.env.NODE_ENV || 'development'}.json`))

const MONGO_URI = nconf.get('MONGODB_URI')
const DB_NAME = nconf.get('MONGODB_NAME')
const COLLECTION_NAME = 'queues'

const MAX_CONSUMERS = parseInt(nconf.get('MAX_CONSUMERS') || 5)
const consumers = [] // array of child processes
const idleConsumers = new Set() // consumer index
const activeAssignments = new Map() // queueId -> consumer index
const consumerUsageCount = new Map() // pid -> assignment count

async function startWorkerManager() {
  const client = new MongoClient(MONGO_URI)
  await client.connect()
  const db = client.db(DB_NAME)
  const collection = db.collection(COLLECTION_NAME)

  console.log('Worker Manager started. Polling DB for queues...')

  async function pollDB() {
    try {
      const queues = await collection.find({}).toArray()

      for (const queue of queues) {
        const queueId = queue._id.toString()

        // If this queue is not already being processed
        if (!activeAssignments.has(queueId)) {
          // Reuse idle consumer if available
          if (idleConsumers.size > 0) {
            const consumerIndex = Array.from(idleConsumers)[0]
            const consumer = consumers[consumerIndex]
            idleConsumers.delete(consumerIndex)
            activeAssignments.set(queueId, consumerIndex)

            consumers[consumerIndex].send({
              type: 'assign',
              queueId,
              queueUrl: queue.queueUrl,
              consumerIndex
            })

            console.log(`Assigned queue ${queueId} to consumer PID ${consumer.pid}`)
          } else if (consumers.length < MAX_CONSUMERS) {
            // Create a new consumer if under the max limit
            const consumerIndex = consumers.length
            const consumer = fork(path.join(__dirname, 'consumer.js'))

            consumers.push(consumer)
            activeAssignments.set(queueId, consumerIndex)
            consumerUsageCount.set(consumer.pid, 1)

            consumer.on('message', async msg => {
              if (msg.type === 'done') {
                const donePid = msg.consumerPid
                const doneQueueId = msg.queueId
                const usage = consumerUsageCount.get(donePid) || 1

                console.log(`Consumer PID ${donePid} finished queue ${doneQueueId}`)
                activeAssignments.delete(doneQueueId)

                try {
                  await collection.deleteOne({ _id: new ObjectId(doneQueueId) })
                  console.log(`Deleted queue ${doneQueueId} from DB`)
                } catch (err) {
                  console.error(`Failed to delete queue ${doneQueueId}:`, err)
                }

                const MAX_USAGE = parseInt(nconf.get('CONSUMER_USAGE_LIMIT') || 5)
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
              queueId,
              queueUrl: queue.queueUrl,
              consumerIndex
            })

            console.log(`Forked and assigned queue ${queueId} to new consumer PID ${consumer.pid}`)
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

startWorkerManager().catch(err => {
  console.error('Worker manager failed to start:', err)
  process.exit(1)
})
