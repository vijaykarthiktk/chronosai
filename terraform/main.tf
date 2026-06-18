# ==========================================
# CHRONOSAI CORE IaC - NETWORK INFRASTRUCTURE
# ==========================================

# 1. Virtual Private Cloud (VPC)
resource "aws_vpc" "chronos_vpc" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "chronosai-prod-vpc"
    Environment = "production"
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
    Name        = "chronosai-public-subnet-${count.index}"
    Environment = "production"
  }
}

# 3. Private Subnets (routing to NAT Gateway)
resource "aws_subnet" "private_subnet" {
  count             = 3
  vpc_id            = aws_vpc.chronos_vpc.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 4)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name        = "chronosai-private-subnet-${count.index}"
    Environment = "production"
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
# SECURITY GROUPS & IAM ROLES (ECS / RDS SECURITY)
# ==========================================

# Generate a unique suffix to prevent IAM role naming collisions
resource "random_string" "role_suffix" {
  length  = 6
  special = false
  upper   = false
  numeric = true
}

# Security Group for Load Balancer (ALB)
resource "aws_security_group" "alb_sg" {
  name        = "chronosai-alb-sg"
  description = "Access rules for public web load balancer"
  vpc_id      = aws_vpc.chronos_vpc.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "chronosai-alb-sg"
    Environment = "production"
  }
}

# Security Group for ECS Fargate Tasks
resource "aws_security_group" "ecs_tasks_sg" {
  name        = "chronosai-ecs-tasks-sg"
  description = "Access rules for ECS Fargate container application"
  vpc_id      = aws_vpc.chronos_vpc.id

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb_sg.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "chronosai-ecs-tasks-sg"
    Environment = "production"
  }
}

# Security Group for RDS PostgreSQL
resource "aws_security_group" "rds_sg" {
  name        = "chronosai-rds-sg"
  description = "Access rules for RDS database tier"
  vpc_id      = aws_vpc.chronos_vpc.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks_sg.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "chronosai-rds-sg"
    Environment = "production"
  }
}

# ECS Task Execution Role
resource "aws_iam_role" "ecs_execution_role" {
  name = "chronosai-ecs-execution-role-${random_string.role_suffix.result}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_policy" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
  role       = aws_iam_role.ecs_execution_role.name
}

# ECS Task Role (For application container environment integration)
resource "aws_iam_role" "ecs_task_role" {
  name = "chronosai-ecs-task-role-${random_string.role_suffix.result}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}


# ==========================================
# AMAZON RDS (POSTGRESQL MULTI-AZ DB SUBNETS)
# ==========================================

resource "aws_db_subnet_group" "db_subnet_group" {
  name       = "chronosai-db-subnet-group"
  subnet_ids = aws_subnet.private_subnet[*].id

  tags = {
    Name        = "chronosai-db-subnet-group"
    Environment = "production"
  }
}

resource "aws_db_instance" "postgres" {
  identifier            = "chronosai-db"
  engine                = "postgres"
  engine_version        = "15.4"
  instance_class        = "db.t3.micro"
  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"

  db_name  = var.db_name
  username = var.db_user
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.db_subnet_group.name
  vpc_security_group_ids = [aws_security_group.rds_sg.id]
  publicly_accessible    = false
  skip_final_snapshot    = true

  tags = {
    Name        = "chronosai-rds-postgres"
    Environment = "production"
  }
}


# ==========================================
# APPLICATION LOAD BALANCER & TARGET GROUPS
# ==========================================

resource "aws_lb" "chronos_alb" {
  name               = "chronosai-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb_sg.id]
  subnets            = aws_subnet.public_subnet[*].id

  tags = {
    Name        = "chronosai-alb"
    Environment = "production"
  }
}

resource "aws_lb_target_group" "chronos_tg" {
  name        = "chronosai-tg"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.chronos_vpc.id
  target_type = "ip"

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Name        = "chronosai-target-group"
    Environment = "production"
  }
}

resource "aws_lb_listener" "http_listener" {
  load_balancer_arn = aws_lb.chronos_alb.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.chronos_tg.arn
  }
}


# ==========================================
# AMAZON ECS (FARGATE CLUSTER & SERVICES)
# ==========================================

# ECS Log Group for CloudWatch Telemetry
resource "aws_cloudwatch_log_group" "ecs_log_group" {
  name              = "/ecs/chronosai-app"
  retention_in_days = 7

  tags = {
    Name        = "chronosai-ecs-log-group"
    Environment = "production"
  }
}

# ECS Cluster
resource "aws_ecs_cluster" "chronos_cluster" {
  name = "chronosai-ecs-cluster"

  tags = {
    Name        = "chronosai-ecs-cluster"
    Environment = "production"
  }
}

# ECS Task Definition
resource "aws_ecs_task_definition" "chronos_task" {
  family                   = "chronosai-app"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name      = "chronosai-app"
      image     = var.container_image
      essential = true

      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
        }
      ]

      environment = [
        { name = "PORT", value = "3000" },
        { name = "NODE_ENV", value = "production" },
        { name = "DB_HOST", value = split(":", aws_db_instance.postgres.endpoint)[0] },
        { name = "DB_NAME", value = var.db_name },
        { name = "DB_USER", value = var.db_user },
        { name = "DB_PASSWORD", value = var.db_password }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_log_group.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])

  tags = {
    Name        = "chronosai-task-def"
    Environment = "production"
  }
}

# ECS Service
resource "aws_ecs_service" "chronos_service" {
  name            = "chronosai-service"
  cluster         = aws_ecs_cluster.chronos_cluster.id
  task_definition = aws_ecs_task_definition.chronos_task.arn
  desired_count   = 3
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private_subnet[*].id
    security_groups  = [aws_security_group.ecs_tasks_sg.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.chronos_tg.arn
    container_name   = "chronosai-app"
    container_port   = 3000
  }

  depends_on = [
    aws_lb_listener.http_listener,
    aws_db_instance.postgres
  ]

  tags = {
    Name        = "chronosai-ecs-service"
    Environment = "production"
  }
}


# ==========================================
# SERVICE AUTOSCALING (SCALING POLICIES)
# ==========================================

resource "aws_appautoscaling_target" "ecs_target" {
  max_capacity       = 8
  min_capacity       = 2
  resource_id        = "service/${aws_ecs_cluster.chronos_cluster.name}/${aws_ecs_service.chronos_service.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_policy_cpu" {
  name               = "chronosai-cpu-autoscaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs_target.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_target.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_target.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    target_value       = 70.0
    scale_in_cooldown  = 60
    scale_out_cooldown = 60
  }
}
