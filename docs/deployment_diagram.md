# ChronosAI Deployment Architecture Specification

This document maps out the cloud deployment topography and AWS multi-AZ resource allocations for Project ChronosAI.

## Deployment Topography Diagram

The network layout below shows the cluster and nodes distribution across Availability Zones:

```mermaid
graph TD
    subgraph Cloud_AWS ["AWS Cloud (us-east-1 Region)"]
        subgraph VPC ["Virtual Private Cloud (10.160.0.0/16)"]
            
            subgraph AZ_A ["Availability Zone A (us-east-1a)"]
                PubSub_A[Public Subnet A - 10.160.0.0/24]
                PriSub_A[Private Subnet A - 10.160.4.0/24]
                
                NAT_GW[NAT Gateway] -->|Direct traffic out| PubSub_A
                Node_A[EKS EC2 Worker Node A] -->|Deploy pods| PriSub_A
            end

            subgraph AZ_B ["Availability Zone B (us-east-1b)"]
                PubSub_B[Public Subnet B - 10.160.1.0/24]
                PriSub_B[Private Subnet B - 10.160.5.0/24]
                
                Node_B[EKS EC2 Worker Node B] -->|Deploy pods| PriSub_B
            end

            subgraph AZ_C ["Availability Zone C (us-east-1c)"]
                PubSub_C[Public Subnet C - 10.160.2.0/24]
                PriSub_C[Private Subnet C - 10.160.6.0/24]
                
                Node_C[EKS EC2 Worker Node C] -->|Deploy pods| PriSub_C
            end
            
            IGW[Internet Gateway] <-->|Public ingress/egress| VPC
        end
    end

    subgraph UserSpace ["Access Gateways"]
        DNS[Route 53 latency DNS] -->|Route to Active Subnet ALB| ALB[AWS Application Load Balancer]
        ALB -->|Forward to public nodes| PubSub_A
    end
```

## Resilience Details

1. **High Availability Network (HA)**: Nodes and subnets are spread across three Availability Zones. If an entire availability zone suffers an outage, the EKS cluster remains operational with remaining nodes in other zones.
2. **Auto Scaling Groups**: In AWS, nodes are managed under an Auto Scaling Group constrained to standard min/max scales (2-8 instances) that respond to workload demands.
3. **Internal Load Balancing**: The Kubernetes ingress controller provisions public application load balancers that distribute incoming requests across private cluster worker pods.
