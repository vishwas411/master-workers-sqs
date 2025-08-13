const path = require('path')
const nconf = require('nconf')
const { SQSClient, DeleteMessageCommand, ReceiveMessageCommand } = require('@aws-sdk/client-sqs')
const { MongoClient } = require('mongodb')

nconf.file(path.join(__dirname, `env/${process.env.NODE_ENV || 'development'}.json`))

const sqs = new SQSClient({
  region: nconf.get('AWS_REGION'),
  credentials: {
    accessKeyId: nconf.get('AWS_ACCESS_KEY_ID'),
    secretAccessKey: nconf.get('AWS_SECRET_ACCESS_KEY')
  },
  endpoint: nconf.get('AWS_SQS_ENDPOINT'),
  forcePathStyle: true
})

let queueConcurrency = 5
let activeMessages = 0
let currentAssignmentId = null
let currentQueueUrl = null
let hasNotifiedDone = false

async function processMessage(message) {
  if (!currentQueueUrl) {
    console.warn('Skipping delete — queueUrl is null')
    return
  }
  
  try {
    console.log(`Consumer ${process.pid} processing:`, message.Body)
    await new Promise(resolve => setTimeout(resolve, 3000))

    await sqs.send(new DeleteMessageCommand({
      QueueUrl: currentQueueUrl,
      ReceiptHandle: message.ReceiptHandle
    }))

    console.log(`Consumer ${process.pid} done:`, message.Body)
  } catch (err) {
    console.error('Error processing message:', err)
  } finally {
    activeMessages--
    pollMessages()
  }
}

async function fetchQueueConcurrency(queueUrl) {
  const uri = nconf.get('MONGODB_URI')
  const dbName = nconf.get('MONGODB_NAME')
  
  try {
    const client = new MongoClient(uri)
    await client.connect()
    const db = client.db(dbName)
    const queuesCol = db.collection('queues')

    const queueName = queueUrl.split('/').pop()
    const queueDoc = await queuesCol.findOne({ name: queueName })
    
    await client.close()
    
    if (queueDoc && queueDoc.concurrency) {
      console.log(`Consumer ${process.pid} using queue-specific concurrency: ${queueDoc.concurrency} for queue '${queueName}'`)
      return queueDoc.concurrency
    } else {
      console.log(`Consumer ${process.pid} queue '${queueName}' not found in DB, using default concurrency: 5`)
      return 5
    }
  } catch (err) {
    console.error(`Consumer ${process.pid} failed to fetch queue concurrency:`, err.message)
    return 5
  }
}

async function pollMessages() {
  if (!currentQueueUrl || !currentAssignmentId || hasNotifiedDone || activeMessages >= queueConcurrency) return

  try {
    const data = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: currentQueueUrl,
      MaxNumberOfMessages: Math.min(queueConcurrency - activeMessages, 10),
      WaitTimeSeconds: 5,
      VisibilityTimeout: 10
    }))

    if (data.Messages && data.Messages.length > 0) {
      for (const msg of data.Messages) {
        if (activeMessages >= queueConcurrency) break
        activeMessages++
        processMessage(msg)
      }
    } else if (activeMessages === 0 && !hasNotifiedDone) {
      process.send({ type: 'done', assignmentId: currentAssignmentId, consumerPid: process.pid })
      currentAssignmentId = null
      currentQueueUrl = null
      hasNotifiedDone = true
    }
  } catch (err) {
    console.error('Polling error:', err)
  }

  setTimeout(pollMessages, 1000)
}

process.on('message', async msg => {
  if (msg.type === 'assign') {
    currentAssignmentId = msg.assignmentId
    currentQueueUrl = msg.queueUrl
    consumerIndex = msg.consumerIndex
    hasNotifiedDone = false

    queueConcurrency = await fetchQueueConcurrency(currentQueueUrl)
    
    console.log(`Consumer ${process.pid} assigned assignment ${currentAssignmentId}`)
    pollMessages()
  }
})
