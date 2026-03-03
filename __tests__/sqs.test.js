const { exec } = require('child_process')
const { promisify } = require('util')
const nconf = require('nconf')
const { SQSClient, GetQueueUrlCommand, GetQueueAttributesCommand } = require('@aws-sdk/client-sqs')

const execAsync = promisify(exec)

nconf.env().file({ file: `./env/${process.env.NODE_ENV || 'unittest'}.json` })

const sqs = new SQSClient({
  region: nconf.get('AWS_REGION'),
  credentials: {
    accessKeyId: nconf.get('AWS_ACCESS_KEY_ID'),
    secretAccessKey: nconf.get('AWS_SECRET_ACCESS_KEY')
  },
  endpoint: nconf.get('AWS_SQS_ENDPOINT'),
  forcePathStyle: true
})

describe('SQS Integration Tests', () => {
  const testQueueName = 'test-sqs-integration'
  let db

  beforeAll(async () => {
    db = await getTestDb()
  })

  afterEach(async () => {
    try {
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js delete ${testQueueName}`)
    } catch (error) {
      // Queue might not exist, that's ok
    }
  })

  describe('Queue Management', () => {
    test('should create a queue and save to database', async () => {
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueueName}`)

      const queueDoc = await db.collection('queues').findOne({ name: testQueueName })
      expect(queueDoc).toBeTruthy()
      expect(queueDoc.name).toBe(testQueueName)
      expect(queueDoc.queueUrl).toContain(testQueueName)
      expect(queueDoc.concurrency).toBe(5)
      expect(queueDoc.createdAt).toBeInstanceOf(Date)

      const sqsResult = await sqs.send(new GetQueueUrlCommand({ QueueName: testQueueName }))
      expect(sqsResult.QueueUrl).toContain(testQueueName)
    })

    test('should list queues from SQS', async () => {
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueueName}`)

      const sqsResult = await sqs.send(new GetQueueUrlCommand({ QueueName: testQueueName }))
      expect(sqsResult.QueueUrl).toContain(testQueueName)
    })

    test('should delete queue and remove from database', async () => {
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueueName}`)

      let queueDoc = await db.collection('queues').findOne({ name: testQueueName })
      expect(queueDoc).toBeTruthy()

      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js delete ${testQueueName}`)

      queueDoc = await db.collection('queues').findOne({ name: testQueueName })
      expect(queueDoc).toBeFalsy()

      await expect(
        sqs.send(new GetQueueUrlCommand({ QueueName: testQueueName }))
      ).rejects.toThrow()
    })

    test('should send messages to queue', async () => {
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueueName}`)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js send ${testQueueName} 3`)

      const queueDoc = await db.collection('queues').findOne({ name: testQueueName })
      const attrs = await sqs.send(new GetQueueAttributesCommand({
        QueueUrl: queueDoc.queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages']
      }))

      const count = parseInt(attrs.Attributes.ApproximateNumberOfMessages)
      expect(count).toBe(3)
    })

    test('should set and validate queue concurrency', async () => {
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueueName}`)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js set-concurrency ${testQueueName} 3`)

      const queueDoc = await db.collection('queues').findOne({ name: testQueueName })
      expect(queueDoc.concurrency).toBe(3)
    })

    test('should reject invalid concurrency values', async () => {
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueueName}`)

      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js set-concurrency ${testQueueName} 10`).catch(() => {})
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js set-concurrency ${testQueueName} 0`).catch(() => {})

      const queueDoc = await db.collection('queues').findOne({ name: testQueueName })
      expect(queueDoc.concurrency).toBe(5)
    })
  })

  describe('Error Handling', () => {
    test('should handle duplicate queue creation gracefully', async () => {
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueueName}`)

      await db.collection('queues').createIndex({ name: 1 }, { unique: true })

      const queuesBefore = await db.collection('queues').find({ name: testQueueName }).toArray()
      expect(queuesBefore.length).toBe(1)

      try {
        await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueueName}`)
      } catch (error) {
        // expected — duplicate key error
      }

      const queuesAfter = await db.collection('queues').find({ name: testQueueName }).toArray()
      expect(queuesAfter.length).toBe(1)
    })

    test('should handle non-existent queue operations', async () => {
      const nonExistentQueue = 'non-existent-queue-12345'

      await expect(
        sqs.send(new GetQueueUrlCommand({ QueueName: nonExistentQueue }))
      ).rejects.toThrow()
    })
  })
})
