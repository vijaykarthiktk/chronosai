# AWS ECS Fargate & RDS Deployment Guide - ChronosAI Platform

This guide outlines the production deployment procedure for hosting the ChronosAI DevOps Ecosystem on Amazon Elastic Container Service (ECS) using Fargate launch type, Amazon RDS PostgreSQL, and Amazon CloudWatch log collection.

---

## Infrastructure Architecture

The platform architecture comprises:
1. **Networking VPC**: A VPC with 3 public subnets (hosting the ALB) and 3 private subnets (hosting the ECS Fargate tasks and RDS database).
2. **Security**:
   - `alb_sg`: Public HTTP ingress (port 80) only.
   - `ecs_tasks_sg`: Restricted ingress (port 3000) allowed only from the ALB.
   - `rds_sg`: Restricted PostgreSQL database ingress (port 5432) allowed only from the ECS Fargate tasks.
3. **Managed Database**: Amazon RDS PostgreSQL instance running version 15.4.
4. **App Service**: Amazon ECS Fargate running the ChronosAI node container.
5. **Observability**: CloudWatch Log Group `/ecs/chronosai-app` collecting live console log streams from tasks.
6. **Autoscaling**: Target tracking scaling policy configured to keep average CPU utilization at 70%, dynamically scaling tasks between 2 and 8 replicas.

---

## Step 1: Provision Infrastructure via Terraform

1. Navigate to the `terraform/` directory:
   ```bash
   cd terraform
   ```
2. Initialize the workspace and providers:
   ```bash
   terraform init
   ```
3. Generate and review the execution plan:
   ```bash
   terraform plan
   ```
4. Apply the configuration to provision VPC, ECS, RDS, ALB, and CloudWatch log groups:
   ```bash
   terraform apply -auto-approve
   ```
5. Once complete, copy the ALB DNS URL output by Terraform:
   - Output: `alb_dns_name = "chronosai-alb-123456789.us-east-2.elb.amazonaws.com"`

---

## Step 2: Deployment via CI/CD (GitHub Actions)

The repository includes a fully-automated CI/CD pipeline defined in `.github/workflows/deploy.yml`.

### 1. Configure Repository Secrets
In your GitHub Repository, navigate to **Settings > Secrets and variables > Actions** and add:
- `AWS_ACCESS_KEY_ID`: IAM user access key with ECS, RDS, VPC, and CloudWatch access.
- `AWS_SECRET_ACCESS_KEY`: IAM user secret access key.

### 2. Deployment Pipeline Steps
Every push to the `main` branch triggers:
1. **Build & Push**: Builds the Docker container and pushes it to GitHub Container Registry (GHCR) as `ghcr.io/<repo-owner>/chronosai-analytics:latest` and tagged with the commit SHA.
2. **Terraform Apply**: Initializes Terraform and applies infrastructure updates, feeding the new container image SHA tag directly into the Task Definition.
3. **ECS Rollout**: Triggers a Fargate service update with `--force-new-deployment` to immediately fetch the new image and waits for Fargate tasks to report healthy statuses.

---

## Step 3: Monitor Telemetry via Amazon CloudWatch

1. Access the AWS Console and navigate to **CloudWatch > Logs > Log Groups**.
2. Click on the `/ecs/chronosai-app` log group.
3. Browse the live stream records to review application logs, requests, and self-healing cycles.
