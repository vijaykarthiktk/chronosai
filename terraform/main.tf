# ==========================================
# CHRONOSAI CORE IaC - NETWORK INFRASTRUCTURE
# ==========================================

# 1. Virtual Private Cloud (VPC)
resource "aws_vpc" "chronos_vpc" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name                                        = "chronosai-prod-vpc"
    Environment                                 = "production"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }
}

# Availability Zones query
data "aws_availability_zones" "available" {
  state = "available"
}

# 2. Public Subnets (routing to Internet Gateway)
resource "aws_subnet" "public_subnet" {
  count                   = 3
  vpc_id                  = aws_vpc.chronos_vpc.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name                                        = "chronosai-public-subnet-${count.index}"
    Environment                                 = "production"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
    "kubernetes.io/role/elb"                    = "1"
  }
}

# 3. Private Subnets (routing to NAT Gateway)
resource "aws_subnet" "private_subnet" {
  count             = 3
  vpc_id            = aws_vpc.chronos_vpc.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 4)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name                                        = "chronosai-private-subnet-${count.index}"
    Environment                                 = "production"
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
    "kubernetes.io/role/internal-elb"           = "1"
  }
}

# 4. Internet Gateway (IGW)
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.chronos_vpc.id

  tags = {
    Name        = "chronosai-prod-igw"
    Environment = "production"
  }
}

# 5. Elastic IP for NAT Gateway
resource "aws_eip" "nat_eip" {
  domain = "vpc"
  tags = {
    Name = "chronosai-nat-eip"
  }
}

# 6. NAT Gateway for Private Subnets
resource "aws_nat_gateway" "nat_gw" {
  allocation_id = aws_eip.nat_eip.id
  subnet_id     = aws_subnet.public_subnet[0].id

  tags = {
    Name = "chronosai-prod-nat-gw"
  }
  depends_on = [aws_internet_gateway.igw]
}

# 7. Route Tables
resource "aws_route_table" "public_rt" {
  vpc_id = aws_vpc.chronos_vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }

  tags = {
    Name = "chronosai-public-rt"
  }
}

resource "aws_route_table" "private_rt" {
  vpc_id = aws_vpc.chronos_vpc.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.nat_gw.id
  }

  tags = {
    Name = "chronosai-private-rt"
  }
}

# 8. Route Table Associations
resource "aws_route_table_association" "public_assoc" {
  count          = 3
  subnet_id      = aws_subnet.public_subnet[count.index].id
  route_table_id = aws_route_table.public_rt.id
}

resource "aws_route_table_association" "private_assoc" {
  count          = 3
  subnet_id      = aws_subnet.private_subnet[count.index].id
  route_table_id = aws_route_table.private_rt.id
}


# ==========================================
# SECURITY GROUPS & IAM ROLES (EKS SECURITY)
# ==========================================

# 9. IAM Role for EKS Cluster Control Plane
resource "aws_iam_role" "eks_cluster_role" {
  name = "chronosai-eks-cluster-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "eks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
  role       = aws_iam_role.eks_cluster_role.name
}

# 10. IAM Role for EKS Worker Nodes
resource "aws_iam_role" "eks_node_role" {
  name = "chronosai-eks-node-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "eks_worker_node_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.eks_node_role.name
}

resource "aws_iam_role_policy_attachment" "eks_cni_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.eks_node_role.name
}

resource "aws_iam_role_policy_attachment" "eks_registry_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = aws_iam_role.eks_node_role.name
}


# ==========================================
# EKS CLUSTER & NODE GROUP PROVISIONING
# ==========================================

# 11. Security Group for EKS Cluster Control Plane
resource "aws_security_group" "eks_cluster_sg" {
  name        = "chronosai-eks-cluster-sg"
  description = "Cluster control plane communication security rules"
  vpc_id      = aws_vpc.chronos_vpc.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "chronosai-cluster-sg"
  }
}

# 12. AWS EKS Cluster Resource
resource "aws_eks_cluster" "chronosai_eks" {
  name     = var.cluster_name
  role_arn = aws_iam_role.eks_cluster_role.arn
  version  = "1.30"

  vpc_config {
    security_group_ids      = [aws_security_group.eks_cluster_sg.id]
    subnet_ids              = concat(aws_subnet.public_subnet[*].id, aws_subnet.private_subnet[*].id)
    endpoint_private_access = true
    endpoint_public_access  = true
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_cluster_policy
  ]
}

# 13. Managed Node Group for Application Pod Execution
resource "aws_eks_node_group" "node_group" {
  cluster_name    = aws_eks_cluster.chronosai_eks.name
  node_group_name = "chronosai-worker-nodes"
  node_role_arn   = aws_iam_role.eks_node_role.arn
  subnet_ids      = aws_subnet.private_subnet[*].id

  scaling_config {
    desired_size = var.node_group_desired
    max_size     = var.node_group_max
    min_size     = var.node_group_min
  }

  instance_types = var.eks_node_instance_types

  update_config {
    max_unavailable = 1
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_worker_node_policy,
    aws_iam_role_policy_attachment.eks_cni_policy,
    aws_iam_role_policy_attachment.eks_registry_policy
  ]

  tags = {
    "k8s.io/cluster-autoscaler/enabled"                 = "true"
    "k8s.io/cluster-autoscaler/${var.cluster_name}"     = "owned"
  }
}
