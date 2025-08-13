#!/usr/bin/env node

const http = require('http')
const { MongoClient } = require('mongodb')
const nconf = require('nconf')
const path = require('path')
const { 
  SQSClient, 
  CreateQueueCommand, 
  DeleteQueueCommand, 
  ListQueuesCommand,
  SendMessageCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand 
} = require('@aws-sdk/client-sqs')

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

const [, , command, ...args] = process.argv

async function createQueue(name) {
  const uri = nconf.get('MONGODB_URI')
  const dbName = nconf.get('MONGODB_NAME')
  
  try {
    const result = await sqs.send(new CreateQueueCommand({
      QueueName: name
    }))
    
    // Also save the queue document to MongoDB
    const client = new MongoClient(uri)
    await client.connect()
    const db = client.db(dbName)
    const queuesCol = db.collection('queues')
    
    const queueDocument = {
      name: name,
      queueUrl: result.QueueUrl,
      concurrency: 5, // default concurrency
      createdAt: new Date(),
      updatedAt: new Date(),
      syncedAt: new Date()
    }
    
    await queuesCol.insertOne(queueDocument)
    await client.close()
    
    console.log(`Created queue '${name}': ${result.QueueUrl}`)
    console.log(`Saved queue document to database with ObjectId: ${queueDocument._id}`)
  } catch (err) {
    if (err.code === 11000) {
      console.error(`Queue '${name}' already exists in database`)
    } else {
      console.error(`Failed to create queue '${name}':`, err.message)
    }
  }
}

async function deleteQueue(name) {
  const uri = nconf.get('MONGODB_URI')
  const dbName = nconf.get('MONGODB_NAME')
  
  try {
    const url = await getQueueUrl(name)
    await sqs.send(new DeleteQueueCommand({ QueueUrl: url }))
    
    // Also remove the queue document from MongoDB
    const client = new MongoClient(uri)
    await client.connect()
    const db = client.db(dbName)
    const queuesCol = db.collection('queues')
    
    const result = await queuesCol.deleteOne({ name: name })
    await client.close()
    
    console.log(`Deleted queue '${name}'`)
    if (result.deletedCount > 0) {
      console.log(`Removed queue document from database`)
    } else {
      console.log(`No queue document found in database to remove`)
    }
  } catch (err) {
    console.error(`Failed to delete queue '${name}':`, err.message)
  }
}

async function listQueues() {
  try {
    const result = await sqs.send(new ListQueuesCommand({}))
    const urls = result.QueueUrls || []
    if (urls.length === 0) {
      console.log('No queues found.')
    } else {
      console.log('Queues:')
      urls.forEach(url => console.log('- ' + url))
    }
  } catch (err) {
    console.error('Failed to list queues:', err.message)
  }
}

async function fetchQueueDocument(queueName) {
  const uri = nconf.get('MONGODB_URI')
  const dbName = nconf.get('MONGODB_NAME')
  
  try {
    const client = new MongoClient(uri)
    await client.connect()
    const db = client.db(dbName)
    const queuesCol = db.collection('queues')
    
    const queueDoc = await queuesCol.findOne({ name: queueName })
    await client.close()
    
    return queueDoc
  } catch (err) {
    console.error(`Failed to fetch queue document for '${queueName}':`, err.message)
    return null
  }
}

async function notifyMaster(queueName) {
  // Fetch queue document from database
  let queueDocument = await fetchQueueDocument(queueName)
  
  if (!queueDocument) {
    console.warn(`Queue '${queueName}' not found in database. Constructing minimal queue document.`)
    // Construct minimal queue document if not found in DB
    queueDocument = {
      name: queueName,
      queueUrl: `${nconf.get('AWS_SQS_ENDPOINT')}/000000000000/${queueName}`,
      // No _id field - indicates this is a constructed document
    }
  }

  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ 
      queueDocument 
    })

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
          console.log(`Master response:`, response)
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
          sqs.send(new SendMessageCommand({
            QueueUrl: url,
            MessageBody: `Test message ${i}`
          }))
        )
      }
  
      await Promise.all(promises)
  
      const duration = ((Date.now() - start) / 1000).toFixed(2)
      console.log(`Successfully sent ${count} messages to '${name}' in ${duration}s`)
  
      try {
        await notifyMaster(name)
      } catch (notifyErr) {
        console.warn(`Master did not respond to assignment request for '${name}': ${notifyErr.message}`)
      }
  
    } catch (err) {
      console.error(`Failed to send messages to '${name}':`, err.message)
    }
  }
  
async function getQueueSize(name) {
    try {
      const url = await getQueueUrl(name)
      const result = await sqs.send(new GetQueueAttributesCommand({
        QueueUrl: url,
        AttributeNames: ['ApproximateNumberOfMessages']
      }))
  
      const count = result.Attributes.ApproximateNumberOfMessages
      console.log(`Queue '${name}' contains ~${count} message(s)`)
    } catch (err) {
      console.error(`Failed to fetch size for queue '${name}':`, err.message)
    }
  }
  

async function getQueueUrl(name) {
  const result = await sqs.send(new GetQueueUrlCommand({ QueueName: name }))
  return result.QueueUrl
}

async function setConcurrency(name, concurrency) {
  const uri = nconf.get('MONGODB_URI')
  const dbName = nconf.get('MONGODB_NAME')
  
  const concurrencyNum = parseInt(concurrency)
  
  if (isNaN(concurrencyNum) || concurrencyNum < 1 || concurrencyNum > 5) {
    console.error('Concurrency must be a number between 1 and 5')
    return
  }

  try {
    const client = new MongoClient(uri)
    await client.connect()
    const db = client.db(dbName)
    const queuesCol = db.collection('queues')
    
    const result = await queuesCol.updateOne(
      { name: name },
      { 
        $set: { 
          concurrency: concurrencyNum,
          updatedAt: new Date()
        }
      }
    )
    
    if (result.matchedCount === 0) {
      console.error(`Queue '${name}' not found in database`)
    } else {
      console.log(`Updated concurrency for queue '${name}' to ${concurrencyNum}`)
    }
    
    await client.close()
  } catch (err) {
    console.error(`Failed to update concurrency for queue '${name}':`, err.message)
  }
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
    case 'set-concurrency':
      await setConcurrency(args[0], args[1])
      break

    default:
      console.log(`Unknown command: ${command}`)
      console.log(`Usage:
  node sqs.js create <name>
  node sqs.js delete <name>
  node sqs.js list
  node sqs.js send <name> <count>
  node sqs.js size <name>
  node sqs.js set-concurrency <name> <1-5>`)
  }
}

main()
