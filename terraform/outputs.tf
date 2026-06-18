output "vpc_id" {
  description = "Provisioned VPC ID"
  value       = aws_vpc.chronos_vpc.id
}

output "public_subnets" {
  description = "List of public subnet IDs"
  value       = aws_subnet.public_subnet[*].id
}

output "private_subnets" {
  description = "List of private subnet IDs"
  value       = aws_subnet.private_subnet[*].id
}

output "eks_cluster_name" {
  description = "EKS Cluster identity name"
  value       = aws_eks_cluster.chronosai_eks.name
}

output "eks_cluster_endpoint" {
  description = "Control plane Endpoint URL for API server communication"
  value       = aws_eks_cluster.chronosai_eks.endpoint
}

output "eks_cluster_security_group_id" {
  description = "EKS Security Group ID configured on control plane"
  value       = aws_security_group.eks_cluster_sg.id
}

output "eks_cluster_certificate_authority" {
  description = "Base64 encoded certificate data for cluster validation"
  value       = aws_eks_cluster.chronosai_eks.certificate_authority[0].data
}
