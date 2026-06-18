# ChronosAI DevOps Ecosystem & Forecasting Platform

Project ChronosAI is an enterprise-grade, cloud-native DevOps ecosystem supporting global economic intelligence and forecasting. This repository houses the infrastructure automation, container configs, secret managers, and telemetry specifications alongside a working simulation dashboard app.

---

## Repository Structure

```
├── package.json               # Node application metadata and scripts
├── server.js                  # Express Web API with simulation engine
├── test.js                    # Dependency-free integration test suite
├── Dockerfile                 # Optimized multi-stage Docker build config
├── .dockerignore              # Ignore paths for docker building
├── docker-compose.yml         # DevOps stack orchestrations (Vault, Prometheus, ELK)
├── Jenkinsfile                # Declarative CI/CD pipeline definition
├── public/                    # Web application frontend assets
│   ├── index.html             # UI HTML layout
│   ├── style.css              # Premium glassmorphic styling
│   └── app.js                 # Chart.js telemetry rendering & events
├── terraform/                 # Infrastructure as Code (IaC) files
│   ├── providers.tf           # AWS provider declarations
│   ├── variables.tf           # Configuration variables
│   ├── main.tf                # VPC, subnets, NAT Gateway, ECS Fargate, RDS PostgreSQL, ALB, CloudWatch
│   └── outputs.tf             # Output specifications
├── kubernetes/                # Kubernetes manifests (Legacy - EKS / Local)
│   ├── deployment.yaml        # App pods replication & probes
│   ├── service.yaml           # AWS NLB network ingress configs
│   ├── ingress.yaml           # Ingress routing settings
│   ├── hpa.yaml               # Horizontal Pod Autoscaling (HPA) definition
│   └── configmap.yaml         # Config properties mapping
├── vault/                     # Secrets management settings
│   ├── config.hcl             # Vault configuration
│   └── bootstrap-vault.sh     # Vault bootstrap scripting
├── monitoring/                # Monitoring and logging configurations
│   ├── prometheus.yml         # Scraper configs
│   ├── grafana-dashboard.json # Grafana dashboard model
│   └── logstash.conf          # ELK logstash indexing pipeline
└── docs/                      # Technical documentation
    ├── architecture_diagram.md
    ├── deployment_diagram.md
    └── disaster_recovery_plan.md
```

---

## Quick Start (Run Locally)

The entire DevOps ecosystem (app, Prometheus, Grafana, Vault, and ELK stack) can be spun up locally with a single docker-compose invocation.

### Prerequisites
*   Node.js (>= 18.0.0)
*   Docker & Docker Compose

### 1. Launch the Stack
Initialize all services in background containers:
```bash
docker-compose up -d --build
```

### 2. Verify Services

Once running, access the following endpoints:

| Service | Access URL | Credentials |
| :--- | :--- | :--- |
| **ChronosAI Web Dashboard** | `http://localhost:3000` | N/A |
| **Prometheus Telemetry** | `http://localhost:9090` | N/A |
| **Grafana Dashboards** | `http://localhost:3001` | Username: `admin` / Password: `admin` |
| **HashiCorp Vault UI** | `http://localhost:8200` | Token: `myroottoken` |
| **Elasticsearch API** | `http://localhost:9200` | N/A |
| **Kibana Log Viewer** | `http://localhost:5601` | N/A |

### 3. Bootstrap Vault Secrets
Configure Vault KV engines, access policies, and test database credentials:
```bash
docker-compose exec vault /bin/sh -c "/vault/config/bootstrap-vault.sh"
```
*(Alternatively, execute `./vault/bootstrap-vault.sh` locally if Vault is installed on your host).*

---

## Automated Verification & Testing

Verify that all backend endpoints and simulations operate properly by running the integration test suite:
```bash
# 1. Install dependencies
npm install

# 2. Run test suite
npm test
```
The integration test suite spawns the application, checks for configuration schemas, fetches Prometheus outputs, reads Vault responses, and validates JSON states.

---

## Infrastructure Operations

### Provisioning ECS & RDS Infrastructure (Terraform)
Navigate to the terraform directory to manage state:
```bash
cd terraform
terraform init
terraform plan
terraform apply
```

### Telemetry & Monitoring (Amazon CloudWatch)
Once provisioned, view live streaming container logs, latency, and resource metrics in the Amazon CloudWatch console under the log group `/ecs/chronosai-app`.
