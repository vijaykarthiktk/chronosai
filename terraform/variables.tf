variable "aws_region" {
  description = "Target deployment region for ChronosAI High Availability Cluster"
  type        = string
  default     = "us-east-2"
}

variable "vpc_cidr" {
  description = "VPC CIDR block specification"
  type        = string
  default     = "10.160.0.0/16"
}

variable "container_image" {
  description = "Docker image to run on ECS Fargate"
  type        = string
  default     = "ghcr.io/vijaykarthiktk/chronosai-analytics:latest"
}

variable "db_name" {
  description = "RDS Database Name"
  type        = string
  default     = "chronosai_forecasting"
}

variable "db_user" {
  description = "RDS Database Admin User"
  type        = string
  default     = "postgres"
}

variable "db_password" {
  description = "RDS Database Admin Password"
  type        = string
  default     = "SuperSecurePassword123"
}
