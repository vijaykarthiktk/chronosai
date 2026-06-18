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

## Step 5: Build & Push Docker Image to GitHub Container Registry (GHCR)

1.  Authenticate Docker to GitHub Container Registry (GHCR) using a GitHub Personal Access Token (PAT) with `write:packages` scope:
    ```bash
    echo <GITHUB_PAT> | docker login ghcr.io -u <GITHUB_USERNAME> --password-stdin
    ```
2.  Build and tag the production Docker image (usernames must be lowercase):
    ```bash
    # Build container from workspace root
    docker build -t ghcr.io/<github_username_lowercase>/chronosai-analytics:latest .
    
    # Push image to GHCR
    docker push ghcr.io/<github_username_lowercase>/chronosai-analytics:latest
    ```

---

## Step 6: Deploy the ChronosAI Application & HPA

1.  Open `kubernetes/deployment.yaml` and update the `image:` attribute with your GHCR image URL:
    ```yaml
    image: ghcr.io/<github_username_lowercase>/chronosai-analytics:latest
    ```
2.  Deploy the ConfigMap, ServiceMonitor, Application, Service, Ingress, and Horizontal Pod Autoscaler (HPA):
    ```bash
    kubectl apply -f kubernetes/configmap.yaml -n chronosai
    kubectl apply -f kubernetes/servicemonitor.yaml -n chronosai
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

---

## Step 8: Automate Deployment via GitHub Actions (CI/CD)

The platform is configured with a fully automated CI/CD workflow defined in [.github/workflows/deploy.yml](file:///Users/vijaykarthik/Programming/Sem-4/s-2/devops./.github/workflows/deploy.yml).

### 1. Configure Repository Secrets
Navigate to your GitHub repository settings under **Settings > Secrets and variables > Actions** and create the following repository secrets:

*   `AWS_ACCESS_KEY_ID`: Your AWS IAM User access key ID with EKS, ECR, VPC, and EC2 permissions.
*   `AWS_SECRET_ACCESS_KEY`: Your AWS IAM User secret access key.

### 2. Triggering the Workflow
*   **Automatic Trigger**: The workflow executes automatically on every `git push` to the `main` branch.
*   **Manual Trigger**: You can run the pipeline manually by navigating to the **Actions** tab in your GitHub repository, selecting **ChronosAI CI/CD - EKS Deployment**, and clicking **Run workflow**.

### 3. Pipeline Actions Workflow (Parallel Architecture)
1.  **Job 1 (IaC - `provision-infrastructure`)**: Configures credentials, sets up Terraform, and executes `terraform apply` to ensure the EKS cluster network, master control plane, and EC2 node groups match the target state.
2.  **Job 2 (Build & Push - `build-and-push`)**: Logs in to GHCR, builds the production Docker container, and pushes the unique commit tag and `latest` tags to GHCR in **parallel** with Job 1 to save execution time.
3.  **Job 3 (Kubernetes Deploy - `kubernetes-deploy`)**: Runs after both Job 1 and Job 2 complete successfully. Logs in to the newly provisioned EKS cluster, configures namespaces/secrets, injects the new image URL, deploys database and application resources, and monitors rollout statuses.

