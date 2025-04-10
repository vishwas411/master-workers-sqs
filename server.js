const { spawn } = require('child_process')
const path = require('path')
const nconf = require('nconf')

const env = process.env.NODE_ENV || 'development'
nconf.file(path.join(__dirname, `env/${env}.json`))

console.log(`Server started. Launching Worker Process...`)

const workerProcess = spawn('node', [path.join(__dirname, 'worker.js')], {
  stdio: 'inherit'
})

workerProcess.on('exit', (code) => {
  console.log(`Worker process exited with code ${code}`)
})
