const AWS = require('aws-sdk')
const queueUrl = process.env.QUEUE_URL

if (!queueUrl) {
  console.error('No QUEUE_URL provided to consumer')
  process.exit(1)
}

console.log(`Consumer ${process.pid} started for queue: ${queueUrl}`)

const sqs = new AWS.SQS({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566',
  accessKeyId: 'test',
  secretAccessKey: 'test'
})

async function pollMessages() {
  try {
    const data = await sqs.receiveMessage({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 5
    }).promise()

    if (data.Messages) {
      for (const message of data.Messages) {
        console.log(`Consumer ${process.pid} received: ${message.Body}`)

        await sqs.deleteMessage({
          QueueUrl: queueUrl,
          ReceiptHandle: message.ReceiptHandle
        }).promise()
      }
    }
  } catch (err) {
    console.error(`Consumer ${process.pid} error:`, err)
  }

  setTimeout(pollMessages, 1000)
}

pollMessages()
