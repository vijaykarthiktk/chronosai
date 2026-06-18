# AWS EKS Deployment Guide - ChronosAI Platform

This guide outlines the production deployment procedure for hosting the ChronosAI DevOps Ecosystem on Amazon Elastic Kubernetes Service (EKS).

---

## Prerequisites
Ensure the following CLI utilities are installed locally and authenticated to your AWS account:
*   [AWS CLI v2](https://aws.amazon.com/cli/) (authenticated via `aws configure` with AdministratorAccess)
*   [Terraform](https://www.terraform.io/) (>= 1.5.0)
*   [kubectl](https://kubernetes.io/docs/tasks/tools/) (matching EKS version 1.28)
*   [Helm v3](https://helm.sh/) (Kubernetes package manager)
*   [Docker](https://www.docker.com/) (for building container images)

---

## Step 1: Provision AWS EKS Infrastructure via Terraform

We use the provided Terraform code to provision a highly available network topology (VPC, private/public subnets across 3 Availability Zones, NAT Gateways) and an EKS cluster with autoscaling worker nodes.

1.  Navigate to the `terraform/` directory:
    ```bash
    cd terraform
    ```
2.  Initialize the Terraform workspace to download provider plugins:
    ```bash
    terraform init
    ```
3.  Generate and review the execution plan:
    ```bash
    terraform plan
    ```
4.  Apply the configuration to provision EKS resources (takes ~15-20 minutes):
    ```bash
    terraform apply -auto-approve
    ```
5.  Configure your local `kubectl` context to connect to the new EKS cluster:
    ```bash
    aws eks update-kubeconfig --region us-east-1 --name chronosai-production-cluster
    ```
6.  Verify connection to EKS cluster nodes:
    ```bash
    kubectl get nodes
    ```

---

## Step 2: Establish the Kubernetes Namespaces & Secrets

1.  Create the namespaces for application separation:
    ```bash
    kubectl create namespace chronosai
    ```
2.  Deploy the database secret key. The database credentials in this secret will match what is stored in Vault and what the PostgreSQL container initializes with:
    ```bash
    kubectl create secret generic chronosai-db-secrets \
      --from-literal=username="postgres" \
      --from-literal=password="SuperSecurePassword123" \
      -n chronosai
    ```

---

## Step 3: Deploy PostgreSQL Database on EKS

We deploy a localized PostgreSQL instance utilizing Persistent Volumes for storage.

1.  Apply the database configuration and volume mounts:
    ```bash
    kubectl apply -f kubernetes/postgres.yaml -n chronosai
    ```
2.  Verify the database pod status:
    ```bash
    kubectl get pods -l app=postgres -n chronosai
    ```

---

## Step 4: Deploy & Configure HashiCorp Vault on EKS

In production, Vault is deployed using Helm and configured with the Kubernetes authentication backend.

1.  Add the HashiCorp Helm repository:
    ```bash
    helm repo add hashicorp https://helm.releases.hashicorp.com
    helm repo update
    ```
2.  Install Vault in dev/unsealed mode for testing, or standard production mode:
    ```bash
    helm install vault hashicorp/vault \
      --set "server.dev.enabled=true" \
      --set "server.dev.token=myroottoken" \
      -n chronosai
    ```
3.  Wait for the Vault pod to be ready:
    ```bash
    kubectl wait --for=condition=Ready pod/vault-0 -n chronosai --timeout=90s
    ```
4.  Copy and run our bootstrap script inside the Vault container to set up KV secret engines and credentials:
    ```bash
    # Upload bootstrap script to EKS Vault container
    kubectl cp vault/bootstrap-vault.sh chronosai/vault-0:/tmp/bootstrap-vault.sh
    
    # Execute bootstrap scripts
    kubectl exec -it vault-0 -n chronosai -- /bin/bash /tmp/bootstrap-vault.sh
    ```

---

## Step 5: Build & Push Docker Image to Amazon ECR

1.  Create an Amazon Elastic Container Registry (ECR) repository for the application:
    ```bash
    aws ecr create-repository \
      --repository-name chronosai-analytics \
      --region us-east-1
    ```
2.  Authenticate Docker to your ECR registry (replace `<ACCOUNT_ID>` with your AWS Account ID):
    ```bash
    aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
    ```
3.  Build and tag the production Docker image:
    ```bash
    # Build container from workspace root
    docker build -t chronosai-analytics:latest .
    
    # Tag image to ECR structure
    docker tag chronosai-analytics:latest <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/chronosai-analytics:latest
    ```
4.  Push the image to Amazon ECR:
    ```bash
    docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/chronosai-analytics:latest
    ```

---

## Step 6: Deploy the ChronosAI Application & HPA

1.  Open `kubernetes/deployment.yaml` and update the `image:` attribute with your ECR image URL:
    ```yaml
    image: <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/chronosai-analytics:latest
    ```
2.  Deploy the ConfigMap, Application, Service, Ingress, and Horizontal Pod Autoscaler (HPA):
    ```bash
    kubectl apply -f kubernetes/configmap.yaml -n chronosai
    kubectl apply -f kubernetes/deployment.yaml -n chronosai
    kubectl apply -f kubernetes/service.yaml -n chronosai
    kubectl apply -f kubernetes/ingress.yaml -n chronosai
    kubectl apply -f kubernetes/hpa.yaml -n chronosai
    ```
3.  Verify the pods are running and fetching secrets from Vault:
    ```bash
    kubectl get pods -n chronosai -l app=chronosai
    ```

---

## Step 7: Set Up Monitoring & Observability (Prometheus & Grafana)

To scrape application metrics on EKS, we deploy the kube-prometheus-stack Helm chart.

1.  Add the Prometheus Community repository:
    ```bash
    helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
    helm repo update
    ```
2.  Install the monitoring stack:
    ```bash
    helm install prometheus prometheus-community/kube-prometheus-stack \
      --namespace monitoring \
      --create-namespace
    ```
3.  Configure a Kubernetes `ServiceMonitor` resource to instruct Prometheus to scrape the ChronosAI service metrics endpoint on `/api/sim-metrics`.
