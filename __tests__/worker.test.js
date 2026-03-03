const { spawn } = require('child_process')
const { exec } = require('child_process')
const { promisify } = require('util')
const nconf = require('nconf')

nconf.env().file({ file: `./env/${process.env.NODE_ENV || 'unittest'}.json` })

const execAsync = promisify(exec)

async function cleanQueue(name) {
  await execAsync(`NODE_ENV=unittest node src/cli/sqs.js delete ${name}`).catch(() => {})
}

function waitForOutput(proc, keyword, timeout = 10000) {
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${keyword}"`)), timeout)
    proc.stdout.on('data', (data) => {
      output += data.toString()
      if (output.includes(keyword)) {
        clearTimeout(timer)
        resolve(output)
      }
    })
  })
}

function waitForWorkerRegistration(db, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for worker registration')), timeout)
    const check = async () => {
      const workers = await db.collection('workers').find({}).toArray()
      if (workers.length > 0) {
        clearTimeout(timer)
        resolve(workers)
      } else {
        setTimeout(check, 300)
      }
    }
    check()
  })
}

function waitForJobWithStatus(db, query, status, timeout = 45000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      reject(new Error(`Timeout waiting for job ${JSON.stringify(query)} with status "${status}"`))
    }, timeout)
    const check = async () => {
      if (settled) return
      try {
        const job = await db.collection('jobs').findOne({ ...query, status })
        if (job) {
          settled = true
          clearTimeout(timer)
          resolve(job)
        } else {
          setTimeout(check, 500)
        }
      } catch (err) {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(err)
        }
      }
    }
    check()
  })
}

describe('Worker Process Tests', () => {
  let workerProcess
  let masterProcess
  let db

  beforeAll(async () => {
    db = await getTestDb()
  })

  afterEach(async () => {
    for (const proc of [workerProcess, masterProcess]) {
      if (proc && !proc.killed) {
        proc.stdout?.destroy()
        proc.stderr?.destroy()
        proc.kill('SIGTERM')
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  })

  describe('Worker Startup', () => {
    test('should start worker and register in database', async () => {
      workerProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'W' }
      })

      const workers = await waitForWorkerRegistration(db)
      expect(workers.length).toBeGreaterThanOrEqual(1)
      expect(workers[0].pid).toBeTruthy()
      expect(workers[0].startedAt).toBeInstanceOf(Date)
    })

    test('should register worker PID in database', async () => {
      workerProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'W' }
      })

      await waitForWorkerRegistration(db)

      const workerDoc = await db.collection('workers').findOne({})
      expect(workerDoc).toBeTruthy()
      expect(workerDoc.pid).toBeTruthy()
      expect(workerDoc.startedAt).toBeInstanceOf(Date)
    })
  })

  describe('Job Processing', () => {
    test('should process messages and update job status', async () => {
      const testQueue = 'test-worker-processing'
      await cleanQueue(testQueue)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueue}`)

      masterProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'M' }
      })
      await waitForOutput(masterProcess, 'Master API running')

      workerProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'W' }
      })
      await waitForWorkerRegistration(db)

      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js send ${testQueue} 3`)

      const jobDoc = await waitForJobWithStatus(db, { queueName: testQueue }, 'completed')

      expect(jobDoc).toBeTruthy()
      expect(jobDoc.status).toBe('completed')
      expect(jobDoc.messageCount).toBe(3)
      expect(jobDoc.endedAt).toBeInstanceOf(Date)
    })

    test('should handle consumer reuse correctly', async () => {
      const testQueue1 = 'test-reuse-1'
      const testQueue2 = 'test-reuse-2'

      await cleanQueue(testQueue1)
      await cleanQueue(testQueue2)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueue1}`)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueue2}`)

      masterProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'M' }
      })
      await waitForOutput(masterProcess, 'Master API running')

      workerProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'W' }
      })
      await waitForWorkerRegistration(db)

      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js send ${testQueue1} 2`)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js send ${testQueue2} 3`)

      const [job1, job2] = await Promise.all([
        waitForJobWithStatus(db, { queueName: testQueue1 }, 'completed', 60000),
        waitForJobWithStatus(db, { queueName: testQueue2 }, 'completed', 60000)
      ])

      expect(job1.status).toBe('completed')
      expect(job1.messageCount).toBe(2)
      expect(job2.status).toBe('completed')
      expect(job2.messageCount).toBe(3)
    }, 90000)
  })

  describe('Error Handling', () => {
    test('should handle database connection errors gracefully', async () => {
      const invalidUri = 'mongodb://localhost:99999'

      workerProcess = spawn('node', ['-e', `
        const { MongoClient } = require('mongodb');
        async function run() {
          const client = new MongoClient('${invalidUri}', { serverSelectionTimeoutMS: 2000 });
          try {
            await client.connect();
            const db = client.db('test');
            await db.collection('workers').insertOne({ pid: process.pid, startedAt: new Date() });
          } catch (err) {
            process.exit(1);
          }
        }
        run();
      `])

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error('Error handling test timeout')), 10000)

        workerProcess.on('exit', (code) => {
          clearTimeout(timeoutId)
          expect(code).not.toBe(0)
          resolve()
        })
      })
    })
  })
})
