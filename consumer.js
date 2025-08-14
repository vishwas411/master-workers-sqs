const path = require('path')
const nconf = require('nconf')
const async = require('async')
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
let currentAssignmentId = null
let currentQueueUrl = null
let hasNotifiedDone = false
let isProcessing = false
let totalProcessedMessages = 0

async function processMessage(message) {
  if (!currentQueueUrl) {
    console.warn('Skipping delete — queueUrl is null')
    return
  }
  
  try {
    console.log(`Consumer ${process.pid} processing:`, message.Body)
    // Random processing time between 1-5 seconds for better concurrency testing
    const processingTime = Math.floor(Math.random() * 4000) + 1000
    await new Promise(resolve => setTimeout(resolve, processingTime))

    await sqs.send(new DeleteMessageCommand({
      QueueUrl: currentQueueUrl,
      ReceiptHandle: message.ReceiptHandle
    }))

    console.log(`Consumer ${process.pid} done:`, message.Body)
  } catch (err) {
    console.error('Error processing message:', err)
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
  if (!currentQueueUrl || !currentAssignmentId || hasNotifiedDone || isProcessing) return

  try {
    const data = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: currentQueueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 5,
      VisibilityTimeout: 10
    }))

    if (data.Messages && data.Messages.length > 0) {
      isProcessing = true
      
      // Use async.eachLimit for concurrency control
      const batchSize = data.Messages.length
      await new Promise((resolve, reject) => {
        async.eachLimit(data.Messages, queueConcurrency, async (message) => {
          try {
            await processMessage(message)
            totalProcessedMessages++
            console.log(`Consumer ${process.pid} processed message, assignment total: ${totalProcessedMessages}`)
          } catch (err) {
            console.error('Error processing individual message:', err)
            throw err
          }
        }, (err) => {
          isProcessing = false
          if (err) {
            console.error('Error in batch processing:', err)
            reject(err)
          } else {
            resolve()
          }
        })
      })
      
      setTimeout(pollMessages, 100)
    } else if (!hasNotifiedDone) {
      console.log(`Consumer ${process.pid} signaling done - processed ${totalProcessedMessages} messages total`)
      process.send({ 
        type: 'done', 
        assignmentId: currentAssignmentId, 
        consumerPid: process.pid,
        totalProcessedMessages: totalProcessedMessages
      })
      currentAssignmentId = null
      currentQueueUrl = null
      hasNotifiedDone = true
      totalProcessedMessages = 0
    }
  } catch (err) {
    console.error('Polling error:', err)
    isProcessing = false
  }

  if (!hasNotifiedDone && !isProcessing) {
    setTimeout(pollMessages, 1000)
  }
}

process.on('message', async msg => {
  if (msg.type === 'assign') {
    currentAssignmentId = msg.assignmentId
    currentQueueUrl = msg.queueUrl
    consumerIndex = msg.consumerIndex
    hasNotifiedDone = false
    isProcessing = false
    totalProcessedMessages = 0
    
    console.log(`Consumer ${process.pid} reset totalProcessedMessages=0 for assignment ${currentAssignmentId}`)

    queueConcurrency = await fetchQueueConcurrency(currentQueueUrl)
    
    console.log(`Consumer ${process.pid} assigned assignment ${currentAssignmentId} with concurrency ${queueConcurrency}`)
    
    // Notify worker that processing has started
    process.send({ type: 'started', assignmentId: currentAssignmentId, consumerPid: process.pid })
    
    pollMessages()
  }
})
