// server.js - Launch mode controller with worker cleanup in MW mode
const { spawn } = require('child_process')
const path = require('path')
const { MongoClient } = require('mongodb')
const nconf = require('nconf')

const env = process.env.NODE_ENV || 'development'
nconf.file(path.join(__dirname, `env/${env}.json`))

const mode = process.env.MODE || 'MW'
console.log(`Server starting in MODE=${mode}`)

function launch(name, file) {
  const proc = spawn('node', [path.join(__dirname, file)], {
    stdio: 'inherit'
  })

  proc.on('exit', code => {
    console.log(`${name} process exited with code ${code}`)
  })
}

async function cleanStaleWorkers() {
  const uri = nconf.get('MONGODB_URI')
  const dbName = nconf.get('MONGODB_NAME')

  try {
    const client = new MongoClient(uri)
    await client.connect()
    const db = client.db(dbName)
    const result = await db.collection('workers').deleteMany({})
    console.log(`Cleaned up ${result.deletedCount} stale workers from DB`)
    await client.close()
  } catch (err) {
    console.error('Failed to clean stale workers:', err)
  }
}

async function startServer() {
  if (mode === 'MW') {
    await cleanStaleWorkers()
  }

  if (mode.includes('M')) {
    launch('Master', 'master.js')
  }

  if (mode === 'W') {
    launch('Worker', 'worker.js') // Always one in W mode
  } else if (mode === 'MW') {
    const count = parseInt(nconf.get('WORKER_INSTANCES') || 1)
    for (let i = 0; i < count; i++) {
      launch(`Worker ${i + 1}`, 'worker.js')
    }
  }
  
}

startServer()