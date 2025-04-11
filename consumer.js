const AWS = require('aws-sdk')
const path = require('path')
const nconf = require('nconf')

nconf.file(path.join(__dirname, `env/${process.env.NODE_ENV || 'development'}.json`))

const sqs = new AWS.SQS({
  region: nconf.get('AWS_REGION'),
  accessKeyId: nconf.get('AWS_ACCESS_KEY_ID'),
  secretAccessKey: nconf.get('AWS_SECRET_ACCESS_KEY'),
  endpoint: nconf.get('AWS_SQS_ENDPOINT')
})

const CONCURRENCY_LIMIT = nconf.get('CONCURRENCY_LIMIT') || 5
let activeMessages = 0
let currentQueueId = null
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

    await sqs.deleteMessage({
      QueueUrl: currentQueueUrl,
      ReceiptHandle: message.ReceiptHandle
    }).promise()

    console.log(`Consumer ${process.pid} done:`, message.Body)
  } catch (err) {
    console.error('Error processing message:', err)
  } finally {
    activeMessages--
    pollMessages()
  }
}

async function pollMessages() {
  if (!currentQueueUrl || !currentQueueId || hasNotifiedDone || activeMessages >= CONCURRENCY_LIMIT) return

  try {
    const data = await sqs.receiveMessage({
      QueueUrl: currentQueueUrl,
      MaxNumberOfMessages: Math.min(CONCURRENCY_LIMIT - activeMessages, 10),
      WaitTimeSeconds: 5,
      VisibilityTimeout: 10
    }).promise()

    if (data.Messages && data.Messages.length > 0) {
      for (const msg of data.Messages) {
        if (activeMessages >= CONCURRENCY_LIMIT) break
        activeMessages++
        processMessage(msg)
      }
    } else if (activeMessages === 0 && !hasNotifiedDone) {
      process.send({ type: 'done', queueId: currentQueueId, consumerPid: process.pid })
      currentQueueId = null
      currentQueueUrl = null
      hasNotifiedDone = true
    }
  } catch (err) {
    console.error('Polling error:', err)
  }

  setTimeout(pollMessages, 1000)
}

process.on('message', msg => {
  if (msg.type === 'assign') {
    currentQueueId = msg.queueId
    currentQueueUrl = msg.queueUrl
    consumerIndex = msg.consumerIndex
    hasNotifiedDone = false
    console.log(`Consumer ${process.pid} assigned queue ${currentQueueId}`)
    pollMessages()
  }
})

module.exports = {
  pollMessages,
  processMessage
}