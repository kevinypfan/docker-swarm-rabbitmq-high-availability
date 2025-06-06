# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a RabbitMQ High Availability testing project with three main deployment configurations:
- **consul/**: Uses Consul for service discovery and cluster coordination
- **etcd/**: Uses etcd for distributed consensus and cluster management  
- **unified/**: Consolidated application (recommended) that combines producer/consumer functionality

The project tests RabbitMQ clustering, failover scenarios, and monitoring with Docker Swarm deployment.

## Commands

### Starting/Stopping Services
```bash
# Start the entire HA environment (uses consul configuration)
./start.sh

# Stop the entire HA environment  
./stop.sh

# Deploy specific configurations
cd consul && docker stack deploy -c docker-compose.yml rabbitmq-ha
cd etcd && docker stack deploy -c docker-compose.yml rabbitmq-ha
```

### Unified Application (Recommended)
```bash
cd unified

# Build Docker image
./build.sh [version]

# Run tests
./test.sh

# Install dependencies and run locally
npm install
npm run start:consumer    # Consumer mode
npm run start:producer    # Producer mode  
npm run start:both        # Mixed mode

# Deploy with Docker Compose
docker stack deploy -c docker-compose.yml rabbitmq-ha
```

### Monitoring and Debugging
```bash
# Check service status
docker service ls
docker service logs -f rabbitmq-ha_rabbitmq
docker service logs -f rabbitmq-ha_consumer
docker service logs -f rabbitmq-ha_producer

# Scale services
docker service scale rabbitmq-ha_consumer=5
docker service scale rabbitmq-ha_producer=3

# Check RabbitMQ cluster status
docker exec -it $(docker ps -q -f name=rabbitmq-ha_rabbitmq) rabbitmqctl cluster_status

# Check service discovery (Consul)
curl http://localhost:3001/v1/catalog/service/rabbitmq
```

## Architecture

### Deployment Configurations
1. **Consul-based**: Uses Consul for service discovery, supports autoheal strategies
2. **etcd-based**: Uses etcd for distributed coordination, requires node labeling
3. **Unified**: Single Docker image that can run as producer, consumer, or both

### Service Components
- **RabbitMQ**: 3-node cluster with quorum queues for HA
- **Traefik**: Load balancer and reverse proxy  
- **Prometheus**: Metrics collection
- **Grafana**: Monitoring dashboards
- **Consul/etcd**: Service discovery and coordination

### Unified Application Modes
The unified application supports multiple modes via `MODE` environment variable:
- `consumer`: Only consumes messages
- `producer`: Only produces messages + REST API
- `both`: Mixed mode for testing

### Key Environment Variables
- `RABBITMQ_URL`: Comma-separated list of RabbitMQ hosts for HA
- `MODE`: Application mode (consumer/producer/both)
- `QUEUE_NAME`, `EXCHANGE_NAME`, `ROUTING_KEY`: RabbitMQ configuration
- `AUTO_SEND`, `AUTO_SEND_INTERVAL`: Producer auto-send settings

### Access Points
- RabbitMQ Management: http://rabbitmq.swarm-test (admin/test1234)
- Producer API: http://producer.swarm-test  
- Traefik Dashboard: http://localhost:8080
- Grafana: http://localhost:3000
- Prometheus: http://localhost:3002
- Consul: http://localhost:3001

### Testing Scenarios
The project supports testing:
- Basic message flow and processing
- Node failure and recovery
- Load testing and scaling
- Network partition handling
- Cluster formation and split-brain scenarios