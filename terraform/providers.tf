terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.20"
    }
  }

  # In actual deployment, we would configure an S3 backend for tfstate lock
  # backend "s3" {
  #   bucket         = "chronosai-terraform-state-prod"
  #   key            = "state/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "chronosai-tf-state-lock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region
}

provider "kubernetes" {
  host                   = aws_eks_cluster.chronosai_eks.endpoint
  cluster_ca_certificate = base64decode(aws_eks_cluster.chronosai_eks.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.cluster.token
}

data "aws_eks_cluster_auth" "cluster" {
  name = aws_eks_cluster.chronosai_eks.name
}
