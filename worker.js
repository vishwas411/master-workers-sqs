const AWS = require('aws-sdk')
const nconf = require('nconf')
const path = require('path')

nconf.file(path.join(__dirname, `env/${process.env.NODE_ENV || 'development'}.json`))

const sqs = new AWS.SQS({
  region: nconf.get('AWS_REGION'),
  accessKeyId: nconf.get('AWS_ACCESS_KEY_ID'),
  secretAccessKey: nconf.get('AWS_SECRET_ACCESS_KEY'),
  endpoint: 'http://localhost:4566' // Pointing to LocalStack
})

const queueUrl = nconf.get('SQS_QUEUE_URL')
const CONCURRENCY_LIMIT = 5 // Maximum parallel processing
let activeMessages = 0 // Track number of currently processing messages

console.log(`Worker ${process.pid} started. Listening to SQS: ${queueUrl}`)

// Function to process a message
async function processMessage(message) {
  try {
    console.log(`Worker ${process.pid} processing message:`, message.Body)
    
    // Simulate message processing time
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Delete the message from the queue after processing
    await sqs.deleteMessage({
      QueueUrl: queueUrl,
      ReceiptHandle: message.ReceiptHandle
    }).promise()

    console.log(`Worker ${process.pid} finished processing message:`, message.Body)
  } catch (error) {
    console.error(`Error processing message in Worker ${process.pid}:`, error)
  } finally {
    activeMessages-- // Reduce active message count
    pollMessages() // Fetch next message if slots are available
  }
}

// Function to poll messages while maintaining concurrency
async function pollMessages() {
  if (activeMessages >= CONCURRENCY_LIMIT) {
    return // Don't poll if at concurrency limit
  }

  try {
    const data = await sqs.receiveMessage({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: Math.min(CONCURRENCY_LIMIT - activeMessages, 10), // Fetch up to 10 messages
      WaitTimeSeconds: 5,
      VisibilityTimeout: 10 // Message remains hidden for 10s while processing
    }).promise()

    if (data.Messages) {
      for (const message of data.Messages) {
        if (activeMessages >= CONCURRENCY_LIMIT) break // Stop if we hit the limit

        activeMessages++ // Increase active message count
        processMessage(message) // Process message in parallel
      }
    }
  } catch (error) {
    console.error(`Error receiving messages in Worker ${process.pid}:`, error)
  } finally {
    setTimeout(pollMessages, 1000) // Continue polling
  }
}

// Start polling
pollMessages()
