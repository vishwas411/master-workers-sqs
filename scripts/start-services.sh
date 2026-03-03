#!/bin/bash

echo "🚀 Starting Master-Workers infrastructure services..."

podman pod create --name masterworkers-pod -p 4566:4566 -p 27017:27017

echo "📦 Starting LocalStack (SQS)..."
podman run -d --pod masterworkers-pod --name localstack-sqs \
  -e SERVICES=sqs \
  -e DEBUG=1 \
  -e HOSTNAME_EXTERNAL=localhost \
  -e DATA_DIR=/var/lib/localstack/data \
  -v localstack_data:/var/lib/localstack \
  localstack/localstack:latest

echo "📦 Starting MongoDB..."
podman run -d --pod masterworkers-pod --name mongodb-masterworkers \
  -e MONGO_INITDB_DATABASE=masterworkers \
  -v mongodb_data:/data/db \
  mongo:7 mongod --bind_ip_all

echo "⏳ Waiting for services to initialize..."
sleep 5

echo "🔍 Checking LocalStack status..."
if curl -s http://localhost:4566/_localstack/health > /dev/null 2>&1; then
  echo "✅ LocalStack (SQS) is ready on port 4566"
else
  echo "❌ LocalStack not ready yet, may need more time"
fi

echo "🔍 Checking MongoDB status..."
if mongosh --eval "db.runCommand('ping')" masterworkers --quiet > /dev/null 2>&1; then
  echo "✅ MongoDB is ready on port 27017"
else
  echo "❌ MongoDB not ready yet, may need more time"
fi

echo ""
echo "🎯 Infrastructure services started!"
echo "   LocalStack: http://localhost:4566"
echo "   MongoDB:    mongodb://localhost:27017/masterworkers"
echo ""
echo "📊 Check status with: podman pod ps"
echo "🛑 Stop all with:     ./scripts/stop-services.sh"
