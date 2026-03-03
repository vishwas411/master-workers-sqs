const { MongoClient } = require('mongodb')
const nconf = require('nconf')

nconf.env().file({ file: `./env/${process.env.NODE_ENV || 'unittest'}.json` })

const MONGO_URI = nconf.get('MONGODB_URI')
const DB_NAME = nconf.get('MONGODB_NAME')

let mongoClient = null

beforeAll(async () => {
  console.log('Setting up test environment...')
  console.log(`Using database: ${DB_NAME}`)
  
  mongoClient = new MongoClient(MONGO_URI)
  await mongoClient.connect()
  
  if (!DB_NAME.includes('test')) {
    throw new Error(`SAFETY CHECK FAILED: Database name '${DB_NAME}' doesn't contain 'test'`)
  }
  
  console.log('Test setup complete')
})

beforeEach(async () => {
  if (mongoClient) {
    const db = mongoClient.db(DB_NAME)
    const collections = ['queues', 'assignments', 'jobs', 'workers']
    for (const collectionName of collections) {
      try {
        await db.collection(collectionName).deleteMany({})
      } catch (err) {
        // Collection might not exist, that's ok
      }
    }
  }
})

afterAll(async () => {
  if (mongoClient) {
    const db = mongoClient.db(DB_NAME)
    await db.dropDatabase()
    await mongoClient.close()
    console.log('Test cleanup complete')
  }
})

global.getTestDb = async () => {
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGO_URI)
    await mongoClient.connect()
  }
  return mongoClient.db(DB_NAME)
}

global.waitFor = (condition, timeout = 5000, interval = 100) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    
    const check = async () => {
      try {
        const result = await condition()
        if (result) {
          resolve(result)
        } else if (Date.now() - startTime > timeout) {
          reject(new Error(`Condition not met within ${timeout}ms`))
        } else {
          setTimeout(check, interval)
        }
      } catch (error) {
        reject(error)
      }
    }
    
    check()
  })
}
