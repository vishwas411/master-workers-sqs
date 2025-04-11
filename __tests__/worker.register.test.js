const assert = require('assert')
const { MongoClient } = require('mongodb')
const { fork } = require('child_process')
const path = require('path')
const nconf = require('nconf')

nconf.file(path.join(__dirname, '../env/test.json'))
const MONGO_URI = nconf.get('MONGODB_URI')
const DB_NAME = nconf.get('MONGODB_NAME')

describe('Worker Registration (Integration)', function () {
  this.timeout(10000)

  let client, db

  before(async () => {
    client = await MongoClient.connect(MONGO_URI)
    db = client.db(DB_NAME)
    await db.collection('workers').deleteMany({})
  })

  after(async () => {
    await client.close()
  })

  it('should register worker PID in the database on startup', done => {
    const workerPath = path.join(__dirname, '../worker.js')
    const worker = fork(workerPath, [], {
      env: { ...process.env, NODE_ENV: 'test' }
    })

    setTimeout(async () => {
      try {
        const records = await db.collection('workers').find({}).toArray()
        assert.strictEqual(records.length, 1, 'Expected one worker to be registered')
        assert.strictEqual(typeof records[0].pid, 'number')
        assert.ok(records[0].startedAt instanceof Date)
        worker.kill()
        done()
      } catch (err) {
        worker.kill()
        done(err)
      }
    }, 1000)
  })
})
