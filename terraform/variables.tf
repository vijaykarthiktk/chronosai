variable "aws_region" {
  description = "Target deployment region for ChronosAI High Availability Cluster"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "VPC CIDR block specification"
  type        = string
  default     = "10.160.0.0/16"
}

variable "cluster_name" {
  description = "EKS Cluster identifier"
  type        = string
  default     = "chronosai-production-cluster"
}

variable "eks_node_instance_types" {
  description = "Instance sizing list for EKS Node Group"
  type        = list(string)
  default     = ["t3.medium"]
}

variable "node_group_min" {
  description = "Minimum active worker node threshold"
  type        = number
  default     = 2
}

variable "node_group_max" {
  description = "Maximum active worker node threshold for traffic surges"
  type        = number
  default     = 8
}

variable "node_group_desired" {
  description = "Target initial active worker node count"
  type        = number
  default     = 3
}
