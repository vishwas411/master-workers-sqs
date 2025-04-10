#!/usr/bin/env node

const AWS = require('aws-sdk')
const http = require('http')

const sqs = new AWS.SQS({
  region: 'us-east-1',
  accessKeyId: 'test',
  secretAccessKey: 'test',
  endpoint: 'http://localhost:4566'
})

const [, , command, ...args] = process.argv

async function createQueue(name) {
  try {
    const result = await sqs.createQueue({
      QueueName: name
    }).promise()
    console.log(`✅ Created queue '${name}': ${result.QueueUrl}`)
  } catch (err) {
    console.error(`❌ Failed to create queue '${name}':`, err.message)
  }
}

async function deleteQueue(name) {
  try {
    const url = await getQueueUrl(name)
    await sqs.deleteQueue({ QueueUrl: url }).promise()
    console.log(`🗑️  Deleted queue '${name}'`)
  } catch (err) {
    console.error(`❌ Failed to delete queue '${name}':`, err.message)
  }
}

async function listQueues() {
  try {
    const result = await sqs.listQueues().promise()
    const urls = result.QueueUrls || []
    if (urls.length === 0) {
      console.log('📭 No queues found.')
    } else {
      console.log('📋 Queues:')
      urls.forEach(url => console.log('- ' + url))
    }
  } catch (err) {
    console.error('❌ Failed to list queues:', err.message)
  }
}

async function notifyMaster(queueName) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ queueName })

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/assign-queue',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    }

    const req = http.request(options, res => {
      let body = ''
      res.on('data', chunk => (body += chunk))
      res.on('end', () => {
        try {
          const response = JSON.parse(body)
          console.log(`📡 Master response:`, response)
          resolve(response)
        } catch (e) {
          reject(e)
        }
      })
    })

    req.on('error', reject)
    req.write(data)
    req.end()
  })
}


async function sendMessages(name, count) {
    const start = Date.now()
    try {
      const url = await getQueueUrl(name)
      const promises = []
  
      for (let i = 1; i <= count; i++) {
        promises.push(
          sqs.sendMessage({
            QueueUrl: url,
            MessageBody: `Test message ${i}`
          }).promise()
        )
      }
  
      await Promise.all(promises)
  
      const duration = ((Date.now() - start) / 1000).toFixed(2)
      console.log(`📨 Successfully sent ${count} messages to '${name}' in ${duration}s`)
  
      try {
        await notifyMaster(name)
      } catch (notifyErr) {
        console.warn(`⚠️ Master did not respond to assignment request for '${name}': ${notifyErr.message}`)
      }
  
    } catch (err) {
      console.error(`❌ Failed to send messages to '${name}':`, err.message)
    }
  }
  
async function getQueueSize(name) {
    try {
      const url = await getQueueUrl(name)
      const result = await sqs.getQueueAttributes({
        QueueUrl: url,
        AttributeNames: ['ApproximateNumberOfMessages']
      }).promise()
  
      const count = result.Attributes.ApproximateNumberOfMessages
      console.log(`📦 Queue '${name}' contains ~${count} message(s)`)
    } catch (err) {
      console.error(`❌ Failed to fetch size for queue '${name}':`, err.message)
    }
  }
  

async function getQueueUrl(name) {
  const result = await sqs.getQueueUrl({ QueueName: name }).promise()
  return result.QueueUrl
}

async function main() {
  switch (command) {
    case 'create':
      await createQueue(args[0])
      break
    case 'delete':
      await deleteQueue(args[0])
      break
    case 'list':
      await listQueues()
      break
    case 'send':
      await sendMessages(args[0], parseInt(args[1]))
      break
    case 'size':
      await getQueueSize(args[0])
      break
    default:
      console.log(`❓ Unknown command: ${command}`)
      console.log(`Usage:
  node sqs.js create <name>
  node sqs.js delete <name>
  node sqs.js list
  node sqs.js send <name> <count>
  node sqs.js size <name>`)
  }
}

main()
