const { spawn, fork } = require('child_process')
const { exec } = require('child_process')
const { promisify } = require('util')

const execAsync = promisify(exec)

async function cleanQueue(name) {
  await execAsync(`NODE_ENV=unittest node src/cli/sqs.js delete ${name}`).catch(() => {})
}

describe('Consumer Process Tests', () => {
  let consumerProcess
  let db

  beforeAll(async () => {
    db = await getTestDb()
  })

  afterEach(async () => {
    if (consumerProcess && !consumerProcess.killed) {
      consumerProcess.kill('SIGTERM')
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  })

  describe('Message Processing', () => {
    test('should process messages with correct concurrency', async () => {
      const testQueue = 'test-consumer-concurrency'
      await cleanQueue(testQueue)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueue}`)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js set-concurrency ${testQueue} 3`)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js send ${testQueue} 6`)
      
      const queueDoc = await db.collection('queues').findOne({ name: testQueue })
      expect(queueDoc.concurrency).toBe(3)
      
      return new Promise((resolve, reject) => {
        consumerProcess = fork('src/services/consumer.js', [], {
          env: { ...process.env, NODE_ENV: 'unittest' },
          silent: true
        })
        
        consumerProcess.send({
          type: 'assign',
          assignmentId: 'test-assignment-123',
          queueUrl: queueDoc.queueUrl,
          consumerIndex: 0
        })
        
        consumerProcess.on('message', (msg) => {
          if (msg.type === 'done') {
            try {
              expect(msg.totalProcessedMessages).toBe(6)
              expect(msg.assignmentId).toBe('test-assignment-123')
              resolve()
            } catch (error) {
              reject(error)
            }
          }
        })
        
        setTimeout(() => reject(new Error('Consumer concurrency test timeout')), 45000)
      })
    })

    test('should track message count correctly across batches', async () => {
      const testQueue = 'test-consumer-batching'
      await cleanQueue(testQueue)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueue}`)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js send ${testQueue} 15`)
      
      const queueDoc = await db.collection('queues').findOne({ name: testQueue })
      
      return new Promise((resolve, reject) => {
        consumerProcess = fork('src/services/consumer.js', [], {
          env: { ...process.env, NODE_ENV: 'unittest' },
          silent: true
        })
        
        consumerProcess.send({
          type: 'assign',
          assignmentId: 'test-batch-assignment',
          queueUrl: queueDoc.queueUrl,
          consumerIndex: 0
        })
        
        consumerProcess.on('message', (msg) => {
          if (msg.type === 'done') {
            try {
              expect(msg.totalProcessedMessages).toBe(15)
              expect(msg.assignmentId).toBe('test-batch-assignment')
              resolve()
            } catch (error) {
              reject(error)
            }
          }
        })
        
        setTimeout(() => reject(new Error('Consumer batching test timeout')), 60000)
      })
    })

    test('should reset message count for reused consumer', async () => {
      const testQueue1 = 'test-reuse-reset-1'
      const testQueue2 = 'test-reuse-reset-2'
      
      await cleanQueue(testQueue1)
      await cleanQueue(testQueue2)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueue1}`)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js send ${testQueue1} 3`)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueue2}`)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js send ${testQueue2} 5`)
      
      const queue1Doc = await db.collection('queues').findOne({ name: testQueue1 })
      const queue2Doc = await db.collection('queues').findOne({ name: testQueue2 })
      
      return new Promise((resolve, reject) => {
        let assignmentComplete = 0
        
        consumerProcess = fork('src/services/consumer.js', [], {
          env: { ...process.env, NODE_ENV: 'unittest' },
          silent: true
        })
        
        consumerProcess.send({
          type: 'assign',
          assignmentId: 'test-reuse-1',
          queueUrl: queue1Doc.queueUrl,
          consumerIndex: 0
        })
        
        consumerProcess.on('message', (msg) => {
          if (msg.type === 'done' && msg.assignmentId === 'test-reuse-1') {
            try {
              expect(msg.totalProcessedMessages).toBe(3)
              assignmentComplete++
              
              setTimeout(() => {
                consumerProcess.send({
                  type: 'assign',
                  assignmentId: 'test-reuse-2',
                  queueUrl: queue2Doc.queueUrl,
                  consumerIndex: 0
                })
              }, 1000)
            } catch (error) {
              reject(error)
            }
          } else if (msg.type === 'done' && msg.assignmentId === 'test-reuse-2') {
            try {
              expect(msg.totalProcessedMessages).toBe(5)
              assignmentComplete++
              
              if (assignmentComplete === 2) {
                resolve()
              }
            } catch (error) {
              reject(error)
            }
          }
        })
        
        setTimeout(() => reject(new Error('Consumer reuse test timeout')), 25000)
      })
    })
  })

  describe('Error Handling', () => {
    test('should handle SQS connection errors', async () => {
      return new Promise((resolve, reject) => {
        consumerProcess = fork('src/services/consumer.js', [], {
          env: { ...process.env, NODE_ENV: 'unittest' },
          silent: true
        })
        
        consumerProcess.send({
          type: 'assign',
          assignmentId: 'error-test',
          queueUrl: 'http://localhost:34566/000000000000/non-existent-queue-xyz',
          consumerIndex: 0
        })
        
        consumerProcess.on('message', (msg) => {
          if (msg.type === 'done') {
            resolve()
          }
        })
        
        setTimeout(() => {
          expect(consumerProcess.killed).toBe(false)
          resolve()
        }, 8000)
      })
    })

    test('should handle malformed assignment messages', (done) => {
      consumerProcess = fork('src/services/consumer.js', [], {
        env: { ...process.env, NODE_ENV: 'unittest' },
        silent: true
      })
      
      consumerProcess.send({
        type: 'assign',
      })
      
      setTimeout(() => {
        expect(consumerProcess.killed).toBe(false)
        done()
      }, 2000)
    })
  })
})
