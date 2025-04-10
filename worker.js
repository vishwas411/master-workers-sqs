const { MongoClient } = require('mongodb')
const { fork } = require('child_process')
const path = require('path')
const nconf = require('nconf')

nconf.file(path.join(__dirname, `env/${process.env.NODE_ENV || 'development'}.json`))

const MONGO_URI = nconf.get('MONGODB_URI')
const DB_NAME = nconf.get('MONGODB_NAME')
const COLLECTION_NAME = 'queues'

const activeConsumers = new Map() // key = queue._id.toString(), value = child process

async function startWorkerManager() {
  const client = new MongoClient(MONGO_URI)
  await client.connect()
  const db = client.db(DB_NAME)
  const collection = db.collection(COLLECTION_NAME)

  console.log('Worker Manager started. Polling DB for queue assignments...')

  async function pollDB() {
    try {
      const queues = await collection.find({}).toArray()

      for (const q of queues) {
        const queueId = q._id.toString()

        if (!activeConsumers.has(queueId)) {
          const queueUrl = q.queueUrl
          console.log(`Forking consumer for queue ID: ${queueId}, URL: ${queueUrl}`)

          const consumer = fork(path.join(__dirname, 'consumer.js'), [], {
            env: {
              ...process.env,
              QUEUE_ID: queueId,
              QUEUE_URL: queueUrl
            }
          })

          activeConsumers.set(queueId, consumer)

          consumer.on('exit', code => {
            console.log(`Consumer for ID ${queueId} exited with code ${code}`)
            activeConsumers.delete(queueId)
          })

          consumer.on('message', msg => {
            console.log(`Consumer [${queueId}] message:`, msg)
          })
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
  console.error('Failed to start worker manager:', err)
  process.exit(1)
})
