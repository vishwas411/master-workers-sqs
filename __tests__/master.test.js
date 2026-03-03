const http = require('http')
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

function waitForJobWithStatus(db, query, status, timeout = 15000) {
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

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}${path}`, (res) => {
      resolve(res.statusCode)
    })
    req.on('error', reject)
    req.setTimeout(2000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

describe('Master Process Tests', () => {
  let masterProcess
  let db
  const testPort = nconf.get('PORT') || 3001

  beforeAll(async () => {
    db = await getTestDb()
  })

  afterEach(async () => {
    if (masterProcess && !masterProcess.killed) {
      masterProcess.stdout?.destroy()
      masterProcess.stderr?.destroy()
      masterProcess.kill('SIGTERM')
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  })

  describe('Master Startup', () => {
    test('should start master process and create indexes', async () => {
      masterProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'M' }
      })

      await waitForOutput(masterProcess, 'Master API running')
      await new Promise(resolve => setTimeout(resolve, 1000))

      const assignmentIndexes = await db.collection('assignments').indexes()
      const queueIndexes = await db.collection('queues').indexes()
      const jobIndexes = await db.collection('jobs').indexes()

      const assignmentIndexNames = assignmentIndexes.map(i => Object.keys(i.key)).flat()
      const queueIndexNames = queueIndexes.map(i => Object.keys(i.key)).flat()

      expect(assignmentIndexNames).toContain('queueUrl')
      expect(queueIndexNames).toContain('name')
      expect(queueIndexNames).toContain('queueUrl')
      expect(jobIndexes.length).toBeGreaterThanOrEqual(3)
    })

    test('should create database collections on startup', async () => {
      masterProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'M' }
      })

      await waitForOutput(masterProcess, 'Master API running')
      await new Promise(resolve => setTimeout(resolve, 1000))

      const collections = await db.listCollections().toArray()
      const collectionNames = collections.map(c => c.name)

      expect(collectionNames).toContain('queues')
      expect(collectionNames).toContain('assignments')
      expect(collectionNames).toContain('jobs')
    })
  })

  describe('Queue Assignment Logic', () => {
    test('should create job document when queue is assigned', async () => {
      const testQueue = 'test-assignment-queue'
      await cleanQueue(testQueue)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueue}`)

      masterProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'M' }
      })
      await waitForOutput(masterProcess, 'Master API running')

      const workerProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'W' }
      })

      try {
        await waitForWorkerRegistration(db)
        await execAsync(`NODE_ENV=unittest node src/cli/sqs.js send ${testQueue} 5`)
        await new Promise(resolve => setTimeout(resolve, 3000))

        const jobDoc = await db.collection('jobs').findOne({ queueName: testQueue })
        expect(jobDoc).toBeTruthy()
        expect(jobDoc.queueName).toBe(testQueue)
        expect(jobDoc.status).toMatch(/queued|running|completed/)
        expect(jobDoc.processor.workerPid).toBeTruthy()
        expect(jobDoc.createdAt).toBeInstanceOf(Date)
      } finally {
        workerProcess.kill('SIGTERM')
      }
    })

    test('should handle multiple queue assignments', async () => {
      const queue1 = 'test-multi-queue-1'
      const queue2 = 'test-multi-queue-2'
      const queue3 = 'test-multi-queue-3'

      await cleanQueue(queue1)
      await cleanQueue(queue2)
      await cleanQueue(queue3)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${queue1}`)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${queue2}`)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${queue3}`)

      masterProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'M' }
      })
      await waitForOutput(masterProcess, 'Master API running')

      const workerProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'W' }
      })

      try {
        await waitForWorkerRegistration(db)

        await execAsync(`NODE_ENV=unittest node src/cli/sqs.js send ${queue1} 3`)
        await execAsync(`NODE_ENV=unittest node src/cli/sqs.js send ${queue2} 5`)

        await new Promise(resolve => setTimeout(resolve, 3000))

        const jobs = await db.collection('jobs').find({}).toArray()
        expect(jobs.length).toBeGreaterThanOrEqual(1)

        jobs.forEach(job => {
          expect(job.status).toMatch(/queued|running|completed/)
          expect(job.processor.workerPid).toBeTruthy()
          expect(job.queueName).toBeTruthy()
        })
      } finally {
        workerProcess.kill('SIGTERM')
      }
    })

    test('should prevent duplicate assignments with unique constraints', async () => {
      const testQueue = 'test-unique-assignment'
      await cleanQueue(testQueue)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueue}`)

      masterProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'M' }
      })
      await waitForOutput(masterProcess, 'Master API running')

      const worker1 = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'W' }
      })
      const worker2 = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'W' }
      })

      try {
        await waitForWorkerRegistration(db)
        await execAsync(`NODE_ENV=unittest node src/cli/sqs.js send ${testQueue} 10`)
        await new Promise(resolve => setTimeout(resolve, 3000))

        const assignments = await db.collection('assignments').find({
          queueUrl: { $regex: testQueue }
        }).toArray()

        const jobs = await db.collection('jobs').find({
          queueName: testQueue
        }).toArray()

        expect(assignments.length + jobs.length).toBeGreaterThanOrEqual(1)
        expect(assignments.length).toBeLessThanOrEqual(1)
        expect(jobs.length).toBeLessThanOrEqual(1)

        if (assignments.length > 0) {
          expect(assignments[0].queueUrl).toBeTruthy()
          expect(assignments[0].worker).toBeTruthy()
          expect(assignments[0].queueId).toBeTruthy()
        }
      } finally {
        worker1.kill('SIGTERM')
        worker2.kill('SIGTERM')
      }
    })

    test('should respect MAX_LOAD worker capacity', async () => {
      const queues = ['load-test-1', 'load-test-2', 'load-test-3', 'load-test-4']

      for (const queue of queues) {
        await cleanQueue(queue)
        await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${queue}`)
      }

      masterProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'M' }
      })
      await waitForOutput(masterProcess, 'Master API running')

      const workerProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'W' }
      })

      try {
        await waitForWorkerRegistration(db)

        for (const queue of queues) {
          await execAsync(`NODE_ENV=unittest node src/cli/sqs.js send ${queue} 5`)
        }

        await new Promise(resolve => setTimeout(resolve, 5000))

        const jobs = await db.collection('jobs').find({}).toArray()
        const assignments = await db.collection('assignments').find({}).toArray()

        expect(jobs.length).toBeGreaterThanOrEqual(1)
        expect(assignments.length).toBeLessThanOrEqual(2)
      } finally {
        workerProcess.kill('SIGTERM')
      }
    })

    test('should clean up assignments after job completion', async () => {
      const testQueue = 'test-cleanup-assignment'
      await cleanQueue(testQueue)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${testQueue}`)

      masterProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'M' }
      })
      await waitForOutput(masterProcess, 'Master API running')

      const workerProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'W' }
      })

      try {
        await waitForWorkerRegistration(db)
        await execAsync(`NODE_ENV=unittest node src/cli/sqs.js send ${testQueue} 2`)

        await new Promise(resolve => setTimeout(resolve, 15000))

        const assignments = await db.collection('assignments').find({
          queueUrl: { $regex: testQueue }
        }).toArray()

        const jobs = await db.collection('jobs').find({
          queueName: testQueue
        }).toArray()

        expect(assignments.length).toBe(0)
        expect(jobs.length).toBeGreaterThanOrEqual(1)
        expect(jobs[0].status).toBe('completed')
        expect(jobs[0].messageCount).toBeGreaterThan(0)
        expect(jobs[0].endedAt).toBeInstanceOf(Date)
      } finally {
        workerProcess.kill('SIGTERM')
      }
    })

    test('should assign queues with messages first', async () => {
      const emptyQueue = 'test-empty-queue'
      const fullQueue = 'test-full-queue'

      await cleanQueue(emptyQueue)
      await cleanQueue(fullQueue)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${emptyQueue}`)
      await execAsync(`NODE_ENV=unittest node src/cli/sqs.js create ${fullQueue}`)

      masterProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'M' }
      })
      await waitForOutput(masterProcess, 'Master API running')

      const workerProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'W' }
      })

      try {
        await waitForWorkerRegistration(db)
        await execAsync(`NODE_ENV=unittest node src/cli/sqs.js send ${fullQueue} 10`)

        await new Promise(resolve => setTimeout(resolve, 4000))

        const jobs = await db.collection('jobs').find({}).toArray()
        expect(jobs.length).toBeGreaterThanOrEqual(1)
        const assignedQueues = jobs.map(job => job.queueName)
        expect(assignedQueues).toContain(fullQueue)
      } finally {
        workerProcess.kill('SIGTERM')
      }
    })
  })

  describe('API Endpoints', () => {
    test('should start API server on correct port', async () => {
      masterProcess = spawn('node', ['src/server.js'], {
        env: { ...process.env, NODE_ENV: 'unittest', MODE: 'M' }
      })

      await waitForOutput(masterProcess, 'Master API running')

      const statusCode = await httpGet(testPort, '/assign-queue')
      expect([400, 404, 405]).toContain(statusCode)
    })
  })
})
