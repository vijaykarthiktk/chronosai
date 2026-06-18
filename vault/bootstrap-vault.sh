#!/usr/bin/env bash
# ==============================================================================
# ChronosAI Vault Bootstrap & Secrets Configuration Script
# ==============================================================================
set -euo pipefail

export VAULT_ADDR="http://127.0.0.1:8200"

echo "Initializing HashiCorp Vault..."
# In dev server mode Vault starts initialized and unsealed, but for normal servers we run:
# vault operator init -key-shares=5 -key-threshold=3 > /vault/keys.txt

# Log in using root token (configured in docker-compose)
echo "Authenticating operator credentials..."
vault login token="myroottoken"

echo "Enabling KV-v2 Secret Engine..."
if ! vault secrets list | grep -q "^secret/"; then
  vault secrets enable -path=secret kv-v2
fi

echo "Writing database and API integration secrets..."
vault kv put secret/chronosai/database \
  db_username="postgres" \
  db_password="SuperSecurePassword123" \
  jwt_signing_key="HS256-vault-managed-token-key-chronosai-platform-2026"

echo "Enabling Kubernetes Authentication Engine..."
if ! vault auth list | grep -q "^kubernetes/"; then
  vault auth enable kubernetes
fi

# Configure Vault Kubernetes authentication settings
# In production EKS, this uses the EKS service account token, certificate, and API server URL
echo "Configuring Kubernetes authentication integrations..."
# vault write auth/kubernetes/config \
#     kubernetes_host="https://kubernetes.default.svc" \
#     kubernetes_ca_cert=@/var/run/secrets/kubernetes.io/serviceaccount/ca.crt

echo "Writing ChronosAI access policy..."
vault policy write chronosai-read - <<EOF
path "secret/data/chronosai/*" {
  capabilities = ["read"]
}
EOF

echo "Binding policy to Kubernetes Service Account role..."
# vault write auth/kubernetes/role/chronosai-app \
#     bound_service_account_names=chronosai-sa \
#     bound_service_account_namespaces=chronosai \
#     policies=chronosai-read \
#     ttl=24h

echo "Vault bootstrapping completed successfully."
