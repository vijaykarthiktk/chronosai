# ChronosAI Deployment Architecture Specification

This document maps out the cloud deployment topography and AWS multi-AZ resource allocations for Project ChronosAI.

## Deployment Topography Diagram

The network layout below shows the cluster and tasks distribution across Availability Zones:

```mermaid
graph TD
    subgraph Cloud_AWS ["AWS Cloud (us-east-2 Region)"]
        subgraph VPC ["Virtual Private Cloud (10.160.0.0/16)"]
            
            subgraph AZ_A ["Availability Zone A (us-east-2a)"]
                PubSub_A[Public Subnet A - 10.160.0.0/24]
                PriSub_A[Private Subnet A - 10.160.4.0/24]
                
                NAT_GW[NAT Gateway] -->|Direct traffic out| PubSub_A
                Task_A[ECS Fargate Task A] -->|Runs in private subnet| PriSub_A
            end

            subgraph AZ_B ["Availability Zone B (us-east-2b)"]
                PubSub_B[Public Subnet B - 10.160.1.0/24]
                PriSub_B[Private Subnet B - 10.160.5.0/24]
                
                Task_B[ECS Fargate Task B] -->|Runs in private subnet| PriSub_B
                RDS_DB[RDS PostgreSQL Instance] -->|Private DB Subnet Group| PriSub_B
            end

            subgraph AZ_C ["Availability Zone C (us-east-2c)"]
                PubSub_C[Public Subnet C - 10.160.2.0/24]
                PriSub_C[Private Subnet C - 10.160.6.0/24]
                
                Task_C[ECS Fargate Task C] -->|Runs in private subnet| PriSub_C
            end
            
            IGW[Internet Gateway] <-->|Public ingress/egress| VPC
        end
    end

    subgraph UserSpace ["Access Gateways"]
        DNS[Route 53 DNS] -->|Route traffic| ALB[AWS Application Load Balancer]
        ALB -->|Forward port 80 to port 3000| PubSub_A
        ALB -->|Forward port 80 to port 3000| PubSub_B
        ALB -->|Forward port 80 to port 3000| PubSub_C
    end
```

## Resilience Details

1. **High Availability Network (HA)**: ECS Fargate Tasks are spread across three Availability Zones. If an entire availability zone suffers an outage, the Application Load Balancer (ALB) automatically routes traffic to remaining healthy tasks in the other zones.
2. **Auto Scaling**: Tasks scale dynamically (2-8 instances) based on CPU load targeting, responding to traffic surges in real-time.
3. **Database Security**: The Amazon RDS PostgreSQL database instance is isolated in a private database subnet group with access restricted entirely to ECS tasks.
