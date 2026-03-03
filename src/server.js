const { spawn } = require('child_process')
const path = require('path')
const { MongoClient } = require('mongodb')
const nconf = require('nconf')
const { SQSClient, ListQueuesCommand, CreateQueueCommand } = require('@aws-sdk/client-sqs')

const env = process.env.NODE_ENV || 'development'
nconf.file(path.join(__dirname, `../env/${env}.json`))

const mode = process.env.MODE || 'MW'
console.log(`Server starting in MODE=${mode}`)

function launch(name, file) {
  const proc = spawn('node', [path.join(__dirname, file)], {
    stdio: 'inherit'
  })

  proc.on('exit', code => {
    console.log(`${name} process exited with code ${code}`)
  })
}

async function cleanStaleWorkers() {
  const uri = nconf.get('MONGODB_URI')
  const dbName = nconf.get('MONGODB_NAME')

  try {
    const client = new MongoClient(uri)
    await client.connect()
    const db = client.db(dbName)
    const result = await db.collection('workers').deleteMany({})
    console.log(`Cleaned up ${result.deletedCount} stale workers from DB`)
    await client.close()
  } catch (err) {
    console.error('Failed to clean stale workers:', err)
  }
}

async function ensureIndexes() {
  const uri = nconf.get('MONGODB_URI')
  const dbName = nconf.get('MONGODB_NAME')

  try {
    const client = new MongoClient(uri)
    await client.connect()
    const db = client.db(dbName)
    
    await db.collection('assignments').createIndex(
      { queueUrl: 1 }, 
      { unique: true, background: true }
    )
    console.log('Ensured unique index on assignments.queueUrl')

    await db.collection('queues').createIndex(
      { name: 1 }, 
      { unique: true, background: true }
    )
    console.log('Ensured unique index on queues.name')

    await db.collection('queues').createIndex(
      { queueUrl: 1 }, 
      { unique: true, background: true }
    )
    console.log('Ensured unique index on queues.queueUrl')

    await db.collection('jobs').createIndex(
      { status: 1, createdAt: -1 },
      { background: true }
    )
    console.log('Ensured compound index on jobs.status and jobs.createdAt')
    
    await db.collection('jobs').createIndex(
      { queueUrl: 1, status: 1 },
      { background: true }
    )
    console.log('Ensured compound index on jobs.queueUrl and jobs.status')

    await db.collection('jobs').createIndex(
      { lastModified: 1 },
      { expireAfterSeconds: 432000, background: true }
    )
    console.log('Ensured TTL index on jobs.lastModified (5 days auto-purge)')
    
    await client.close()
  } catch (err) {
    console.error('Failed to ensure database indexes:', err)
  }
}

async function syncQueues() {
  const uri = nconf.get('MONGODB_URI')
  const dbName = nconf.get('MONGODB_NAME')
  
  try {
    const sqs = new SQSClient({
      region: nconf.get('AWS_REGION'),
      credentials: {
        accessKeyId: nconf.get('AWS_ACCESS_KEY_ID'),
        secretAccessKey: nconf.get('AWS_SECRET_ACCESS_KEY')
      },
      endpoint: nconf.get('AWS_SQS_ENDPOINT'),
      forcePathStyle: true
    })

    const client = new MongoClient(uri)
    await client.connect()
    const db = client.db(dbName)
    const queuesCol = db.collection('queues')
    
    console.log('Syncing queues: DB → SQS (one-way sync to preserve ObjectIds)...')
    
    const sqsQueues = await sqs.send(new ListQueuesCommand({}))
    const sqsQueueUrls = sqsQueues.QueueUrls || []

    const dbQueues = await queuesCol.find({}).toArray()

    const toCreate = dbQueues.filter(dbQueue => 
      !sqsQueueUrls.includes(dbQueue.queueUrl)
    )
    
    if (toCreate.length > 0) {
      console.log(`Creating ${toCreate.length} missing SQS queues from DB...`)
      
      for (const dbQueue of toCreate) {
        try {
          const result = await sqs.send(new CreateQueueCommand({
            QueueName: dbQueue.name
          }))
          console.log(`Created SQS queue: ${dbQueue.name}`)
          
          if (result.QueueUrl !== dbQueue.queueUrl) {
            await queuesCol.updateOne(
              { _id: dbQueue._id },
              { $set: { queueUrl: result.QueueUrl, syncedAt: new Date() } }
            )
          } else {
            await queuesCol.updateOne(
              { _id: dbQueue._id },
              { $set: { syncedAt: new Date() } }
            )
          }
        } catch (sqsErr) {
          console.error(`Failed to create SQS queue '${dbQueue.name}':`, sqsErr.message)
        }
      }
    }

    const existing = dbQueues.filter(dbQueue => 
      sqsQueueUrls.includes(dbQueue.queueUrl)
    )
    
    if (existing.length > 0) {
      await queuesCol.updateMany(
        { _id: { $in: existing.map(q => q._id) } },
        { $set: { syncedAt: new Date() } }
      )
      console.log(`Updated sync timestamp for ${existing.length} existing queues`)
    }
    
    console.log('Queue sync completed successfully (DB ObjectIds preserved)')
    await client.close()
  } catch (err) {
    console.error('Failed to sync queues:', err)
  }
}

async function startServer() {
  await ensureIndexes()

  if (mode.includes('M')) {
    await syncQueues()
  }
  
  if (mode === 'MW') {
    await cleanStaleWorkers()
  }

  if (mode.includes('M')) {
    launch('Master', 'services/master.js')
  }

  if (mode === 'W') {
    launch('Worker', 'services/worker.js')
  } else if (mode === 'MW') {
    const count = parseInt(nconf.get('WORKER_INSTANCES') || 1)
    for (let i = 0; i < count; i++) {
      launch(`Worker ${i + 1}`, 'services/worker.js')
    }
  }
  
}

startServer()
