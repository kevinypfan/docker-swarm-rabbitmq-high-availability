#!/bin/bash

# RabbitMQ HA Client 建置和部署腳本

set -e

# 設定變數
IMAGE_NAME="kevinypfan/rabbitmq-tester"
VERSION=${1:-"latest"}
DOCKERFILE="Dockerfile"

echo "🏗️  Building RabbitMQ Tester..."
echo "📦 Image: ${IMAGE_NAME}:${VERSION}"

# 建置 Docker 映像
docker build -t "${IMAGE_NAME}:${VERSION}" -f ${DOCKERFILE} .

# 如果不是 latest，也標記為 latest
if [ "${VERSION}" != "latest" ]; then
    docker tag "${IMAGE_NAME}:${VERSION}" "${IMAGE_NAME}:latest"
fi

echo "✅ Build completed successfully!"
echo ""
echo "📋 Available commands:"
echo "   docker run -e MODE=consumer ${IMAGE_NAME}:${VERSION}"
echo "   docker run -e MODE=producer -p 3000:3000 ${IMAGE_NAME}:${VERSION}"
echo "   docker run -e MODE=both -p 3000:3000 ${IMAGE_NAME}:${VERSION}"
echo ""
echo "🚀 To push to Docker Hub:"
echo "   docker push ${IMAGE_NAME}:${VERSION}"
if [ "${VERSION}" != "latest" ]; then
    echo "   docker push ${IMAGE_NAME}:latest"
fi
