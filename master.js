const { fork } = require('child_process')
const path = require('path')
const nconf = require('nconf')

nconf.file(path.join(__dirname, `env/${process.env.NODE_ENV || 'development'}.json`))

const NUM_WORKERS = nconf.get('NUM_WORKERS')

console.log(`Master Process started. Spawning ${NUM_WORKERS} workers...`)

for (let i = 0; i < NUM_WORKERS; i++) {
  const worker = fork(path.join(__dirname, 'worker.js'))

  worker.on('exit', (code) => {
    console.log(`Worker ${worker.pid} exited with code ${code}`)
  })

  worker.on('message', (msg) => {
    console.log(`Message from Worker ${worker.pid}:`, msg)
  })
}
