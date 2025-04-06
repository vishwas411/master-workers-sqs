const { spawn } = require('child_process')
const path = require('path')
const nconf = require('nconf')

// Load config from JSON files only
const env = process.env.NODE_ENV || 'development'
nconf.file(path.join(__dirname, `env/${env}.json`))

console.log(`Server started. Launching Master Process...`)

const master = spawn('node', [path.join(__dirname, 'master.js')], {
  stdio: 'inherit'
})

master.on('exit', (code) => {
  console.log(`Master process exited with code ${code}`)
})
