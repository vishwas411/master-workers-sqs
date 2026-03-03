#!/bin/bash

echo "🛑 Stopping Master-Workers infrastructure services..."

podman pod stop masterworkers-pod 2>/dev/null || true
podman pod rm masterworkers-pod 2>/dev/null || true

echo "✅ All services stopped and cleaned up!"
echo "💾 Data volumes preserved for next startup"
