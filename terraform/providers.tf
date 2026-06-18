terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
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
