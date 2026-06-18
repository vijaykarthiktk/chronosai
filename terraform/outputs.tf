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

output "alb_dns_name" {
  description = "Public Application Load Balancer DNS URL"
  value       = aws_lb.chronos_alb.dns_name
}

output "rds_endpoint" {
  description = "Connection endpoint for RDS PostgreSQL Database instance"
  value       = aws_db_instance.postgres.endpoint
}

output "ecs_cluster_name" {
  description = "ECS cluster identifier name"
  value       = aws_ecs_cluster.chronos_cluster.name
}

output "ecs_service_name" {
  description = "ECS service identifier name"
  value       = aws_ecs_service.chronos_service.name
}
