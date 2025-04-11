const assert = require('assert')
const { fork } = require('child_process')
const path = require('path')
const AWS = require('aws-sdk')

const queueName = 'test-queue'
const queueUrl = `http://localhost:4566/000000000000/${queueName}`

const sqs = new AWS.SQS({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566',
  accessKeyId: 'test',
  secretAccessKey: 'test'
})

describe('Consumer Integration Test (real process)', function () {
  this.timeout(20000)

  before(async () => {
    try {
      await sqs.createQueue({ QueueName: queueName }).promise()
    } catch (err) {
      if (!err.message.includes('QueueAlreadyExists')) throw err
    }

    try {
      await sqs.purgeQueue({ QueueUrl: queueUrl }).promise()
    } catch (err) {
      console.warn('Queue purge warning:', err.message)
    }

    const messages = Array.from({ length: 5 }, (_, i) => ({
      Id: `${i + 1}`,
      MessageBody: `Test message ${i + 1}`
    }))

    await sqs.sendMessageBatch({
      QueueUrl: queueUrl,
      Entries: messages
    }).promise()
  })

  it('should receive and process 5 messages concurrently', done => {
    const consumerPath = path.join(__dirname, '../consumer.js')
    const consumer = fork(consumerPath, [], {
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['inherit', 'pipe', 'pipe', 'ipc']
    })

    const logs = []
    const startTimes = []
    let testPassed = false

    consumer.stdout.on('data', data => {
      const lines = data.toString().split('\n').filter(Boolean)
      lines.forEach(line => {
        console.log('[child]', line)
        logs.push(line)

        if (line.includes('processing:')) {
          startTimes.push(Date.now())
        }
      })
    })

    consumer.stderr.on('data', data => {
      console.error('[child stderr]', data.toString())
    })

    consumer.on('message', msg => {
      if (msg.type === 'done') {
        const doneCount = logs.filter(l => l.includes('done:')).length
        assert.strictEqual(doneCount, 5, 'Expected 5 messages to be fully processed')

        const concurrentStarts = startTimes.filter(t => t - startTimes[0] < 1000).length
        assert(
          concurrentStarts > 1,
          `Expected concurrency but found sequential execution. Only ${concurrentStarts} started within 1s`
        )

        testPassed = true
        consumer.kill()
      }
    })

    consumer.on('exit', code => {
      if (!testPassed) {
        return done(new Error(`Consumer exited unexpectedly (code: ${code}) before processing completed`))
      }

      done()
    })

    consumer.send({
      type: 'assign',
      queueId: 'test-queue-id',
      queueUrl
    })
  })
})
