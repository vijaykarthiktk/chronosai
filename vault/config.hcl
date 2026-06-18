# Vault primary configuration file
storage "file" {
  path = "/vault/data"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = 1 # Disabled for demonstration; enabled with certificates in production EKS
}

# Enable web interface dashboard UI
ui = true

api_addr = "http://127.0.0.1:8200"
disable_mlock = true
