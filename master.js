const express = require('express')
const { MongoClient } = require('mongodb')
const nconf = require('nconf')
const path = require('path')

nconf.file(path.join(__dirname, `env/${process.env.NODE_ENV || 'development'}.json`))

const MONGO_URI = nconf.get('MONGODB_URI')
const DB_NAME = nconf.get('MONGODB_NAME')

const PORT = 3000
const MAX_LOAD = parseInt(nconf.get('MAX_LOAD') || 5)

async function assignQueueToLeastLoadedWorker(queueName) {
  const client = new MongoClient(MONGO_URI)
  await client.connect()
  const db = client.db(DB_NAME)

  const assignmentsCol = db.collection('assignments')
  const workersCol = db.collection('workers')

  const queueUrl = `${nconf.get('AWS_SQS_ENDPOINT')}/000000000000/${queueName}`

  const existingQueue = await assignmentsCol.findOne({ queueUrl })

  if (existingQueue) {
    console.log(`Queue '${queueName}' is already assigned to worker ${existingQueue.worker}`)
    await client.close()
    return {
      success: true,
      alreadyAssigned: true,
      queueUrl: existingQueue.queueUrl,
      worker: existingQueue.worker
    }
  }

  const workers = await workersCol.find({}).toArray()
  if (!workers.length) {
    console.log('No workers available')
    await client.close()
    return { success: false, message: 'No workers found' }
  }

  // Count assignments per worker
  const assignments = await assignmentsCol.aggregate([
    { $group: { _id: '$worker', count: { $sum: 1 } } }
  ]).toArray()

  const assignmentCount = {}
  for (const entry of assignments) {
    assignmentCount[entry._id] = entry.count
  }

  let selectedWorker = null
  let minLoad = Infinity

  for (const worker of workers) {
    const pid = `${worker.pid}`
    const count = assignmentCount[pid] || 0

    if (count < MAX_LOAD && count < minLoad) {
      minLoad = count
      selectedWorker = pid
    }
  }


  if (!selectedWorker) {
    await client.close()
    return { success: false, message: 'No eligible worker found' }
  }

  try {
    const result = await assignmentsCol.insertOne({
      queueUrl,
      worker: selectedWorker
    })

    console.log(`Assigned queue '${queueName}' to worker ${selectedWorker}`)
    await client.close()
    return { success: true, assignedTo: selectedWorker, queueUrl }
  } catch (err) {
    if (err.code === 11000) {
      const existingQueue = await assignmentsCol.findOne({ queueUrl })
      console.log(`Race condition detected: Queue '${queueName}' was assigned to worker ${existingQueue.worker} by concurrent request`)
      await client.close()
      return {
        success: true,
        alreadyAssigned: true,
        queueUrl: existingQueue.queueUrl,
        worker: existingQueue.worker
      }
    }

    await client.close()
    throw err
  }
}

const app = express()
app.use(express.json())

app.post('/assign-queue', async (req, res) => {
  const { queueName } = req.body
  if (!queueName) {
    return res.status(400).json({ success: false, message: 'Missing queueName' })
  }

  const result = await assignQueueToLeastLoadedWorker(queueName)
  if (!result.success) {
    return res.status(500).json(result)
  }

  res.json(result)
})

app.listen(PORT, () => {
  console.log(`Master API running at http://localhost:${PORT}`)
})
