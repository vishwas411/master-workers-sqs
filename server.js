// server.js - Launch mode controller
const { spawn } = require('child_process')
const path = require('path')
const nconf = require('nconf')

const env = process.env.NODE_ENV || 'development'
nconf.file(path.join(__dirname, `env/${env}.json`))

const mode = nconf.get('MODE') || 'MW'
console.log(`Server starting in MODE=${mode}`)

function launch(name, file) {
  const proc = spawn('node', [path.join(__dirname, file)], { stdio: 'inherit' })
  proc.on('exit', code => {
    console.log(`${name} process exited with code ${code}`)
  })
}

if (mode.includes('M')) {
  launch('Master', 'master.js')
}

if (mode.includes('W')) {
  launch('Worker', 'worker.js')
}
