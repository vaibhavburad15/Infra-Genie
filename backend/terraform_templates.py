"""Vetted Terraform for standard deployment shapes.

Generating Terraform with the LLM takes minutes and can produce configurations
that fail at apply time. For the common shapes this module renders a
known-good configuration instantly from the generation context:

  * static frontend           -> S3 + CloudFront (or S3 website hosting)
  * containerized backend     -> ECS Fargate behind an ALB, optional RDS / Redis
  * frontend + backend        -> both of the above; the frontend is built
                                 against the backend's public URL

Other shapes still go through the LLM generator. The output has the same
structure as the LLM agent's response ({"files": {...},
"resource_specifications": [...]}) and passes the same validation.

Static hosting modes (context["static_hosting"]):
  * "cloudfront" (default) — private bucket behind CloudFront, HTTPS.
  * "s3_website" — public S3 website endpoint, HTTP only. For accounts where
    AWS has not yet enabled CloudFront.

Apply-time choices made for speed:
  * ECS service starts at desired_count = 0; the deploy step scales it to 1
    after the image is pushed, so ECS never cycles failing tasks while the
    repository is still empty.
  * Short target-group health checks and deregistration delay.
  * RDS without Multi-AZ, Performance Insights or enhanced monitoring; no
    automated backups outside production (skips the initial backup).
  * CloudFront `wait_for_deployment = false`: Terraform returns as soon as
    the distribution is accepted instead of waiting for edge propagation.
"""
from __future__ import annotations

from typing import Any, Optional

_RDS_ENGINES = {
    "postgres": {"engine": "postgres", "version": "16", "port": 5432, "scheme": "postgresql"},
    "mysql": {"engine": "mysql", "version": "8.0", "port": 3306, "scheme": "mysql"},
}
# AWS managed CloudFront policies
_CACHING_OPTIMIZED = "658327ea-f89d-4fab-a63d-7e88639e58f6"
_CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
_ALL_VIEWER_EXCEPT_HOST = "b689b0a8-53d0-40ab-baf2-68738e2966ac"

STATIC_HOSTING_CLOUDFRONT = "cloudfront"
STATIC_HOSTING_S3_WEBSITE = "s3_website"


def _targets(context: dict[str, Any]) -> set[str]:
    strategy = context.get("strategy")
    if not isinstance(strategy, dict):
        return set()
    targets = {str(c.get("target")) for c in strategy.get("components") or [] if isinstance(c, dict)}
    targets.add(str(strategy.get("primary_target") or ""))
    return targets - {""}


def _components(context: dict[str, Any], fallback: str) -> list[str]:
    return [str(c) for c in context.get("required_application_components") or []] or [fallback]


def _spec(kind: str, name: str, components: list[str], purpose: str) -> dict[str, Any]:
    return {"type": kind, "name": name, "components": components, "purpose": purpose}


def _providers(region: str) -> str:
    return f'''terraform {{
  required_providers {{
    aws = {{
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }}
  }}
}}

provider "aws" {{
  region = "{region}"
}}
'''


def _outputs(outputs: dict[str, str]) -> str:
    return "".join(f'\noutput "{name}" {{\n  value = {expr}\n}}\n' for name, expr in outputs.items())


def render(context: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Template for the context's strategy, or None to use the LLM generator."""
    targets = _targets(context)
    if not context.get("resource_name_prefix"):
        return None
    if targets == {"s3_cloudfront"}:
        return render_static_site(context)
    vpcs = (context.get("aws_discovery") or {}).get("vpcs") or []
    if "ec2" in targets and targets <= {"ec2", "rds", "documentdb"} and any(v.get("is_default") for v in vpcs):
        return render_ec2(context)
    if template_applies(context):
        return render_ecs_fargate(context)
    return None


def template_applies(context: dict[str, Any]) -> bool:
    """ECS Fargate (+ ECR, RDS, static frontend) in an account with a default VPC."""
    targets = _targets(context)
    vpcs = (context.get("aws_discovery") or {}).get("vpcs") or []
    return (
        "ecs_fargate" in targets
        and targets <= {"ecs_fargate", "ecr", "rds", "documentdb", "s3_cloudfront"}
        and any(v.get("is_default") for v in vpcs)
        and bool(context.get("resource_name_prefix"))
    )


# ── Static site ───────────────────────────────────────────────────────────────

def _site_block(prefix: str, hosting: str, components: list[str]) -> tuple[str, list, dict, str]:
    """Bucket + hosting resources. Returns (hcl, specs, outputs, site_url_expr).

    Both modes use the same bucket address and name prefix, so switching
    modes keeps the existing bucket and only swaps the hosting resources.
    """
    hcl = f'''resource "aws_s3_bucket" "site" {{
  bucket_prefix = "{prefix}-site-"
  force_destroy = true
}}

resource "aws_s3_bucket_ownership_controls" "site" {{
  bucket = aws_s3_bucket.site.id
  rule {{
    object_ownership = "BucketOwnerEnforced"
  }}
}}
'''
    specs = [
        _spec("aws_s3_bucket", "site", components, "Static site files"),
        _spec("aws_s3_bucket_ownership_controls", "site", components, "Disable ACLs"),
        _spec("aws_s3_bucket_public_access_block", "site", components, "Bucket public access settings"),
        _spec("aws_s3_bucket_policy", "site", components, "Read access for the site"),
    ]
    outputs = {"s3_bucket_name": "aws_s3_bucket.site.bucket"}

    if hosting == STATIC_HOSTING_S3_WEBSITE:
        hcl += '''
resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_website_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  index_document {
    suffix = "index.html"
  }
  error_document {
    key = "index.html"
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket     = aws_s3_bucket.site.id
  depends_on = [aws_s3_bucket_public_access_block.site]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicRead"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site.arn}/*"
    }]
  })
}
'''
        specs.append(_spec("aws_s3_bucket_website_configuration", "site", components, "S3 website hosting"))
        site_url = "http://${aws_s3_bucket_website_configuration.site.website_endpoint}"
        outputs["website_url"] = f'"{site_url}"'
        return hcl, specs, outputs, site_url

    hcl += f'''
resource "aws_s3_bucket_public_access_block" "site" {{
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}}

resource "aws_cloudfront_origin_access_control" "site" {{
  name                              = "{prefix}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}}

resource "aws_cloudfront_distribution" "site" {{
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200"
  wait_for_deployment = false
  comment             = "{prefix} static site"

  origin {{
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-site"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }}

  default_cache_behavior {{
    target_origin_id       = "s3-site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = "{_CACHING_OPTIMIZED}"
  }}

  custom_error_response {{
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }}

  custom_error_response {{
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }}

  restrictions {{
    geo_restriction {{
      restriction_type = "none"
    }}
  }}

  viewer_certificate {{
    cloudfront_default_certificate = true
  }}
}}

resource "aws_s3_bucket_policy" "site" {{
  bucket     = aws_s3_bucket.site.id
  depends_on = [aws_s3_bucket_public_access_block.site]
  policy = jsonencode({{
    Version = "2012-10-17"
    Statement = [{{
      Sid       = "AllowCloudFrontRead"
      Effect    = "Allow"
      Principal = {{ Service = "cloudfront.amazonaws.com" }}
      Action    = "s3:GetObject"
      Resource  = "${{aws_s3_bucket.site.arn}}/*"
      Condition = {{
        StringEquals = {{ "AWS:SourceArn" = aws_cloudfront_distribution.site.arn }}
      }}
    }}]
  }})
}}
'''
    specs += [
        _spec("aws_cloudfront_origin_access_control", "site", components, "CloudFront access to the bucket"),
        _spec("aws_cloudfront_distribution", "site", components, "HTTPS CDN in front of the bucket"),
    ]
    outputs["cloudfront_distribution_id"] = "aws_cloudfront_distribution.site.id"
    outputs["cloudfront_domain_name"] = "aws_cloudfront_distribution.site.domain_name"
    return hcl, specs, outputs, "https://${aws_cloudfront_distribution.site.domain_name}"


def render_static_site(context: dict[str, Any]) -> dict[str, Any]:
    prefix = context["resource_name_prefix"]
    hosting = context.get("static_hosting") or STATIC_HOSTING_CLOUDFRONT
    hcl, specs, outputs, site_url = _site_block(prefix, hosting, _components(context, "frontend"))
    outputs["frontend_url"] = f'"{site_url}"'
    region = (context.get("deployment") or {}).get("region")
    return {
        "files": {"main.tf": hcl + _outputs(outputs), "providers.tf": _providers(region)},
        "resource_specifications": specs,
    }


# ── Shared: managed database ──────────────────────────────────────────────────

def _database_block(prefix: str, database: dict[str, Any], production: bool,
                    client_sg: str) -> tuple[str, list, dict]:
    """RDS instance reachable only from security group `client_sg`."""
    hcl = f'''
variable "db_username" {{
  type = string
}}

variable "db_password" {{
  type      = string
  sensitive = true
}}

variable "db_name" {{
  type = string
}}

resource "aws_db_subnet_group" "db" {{
  name       = "{prefix}-db"
  subnet_ids = data.aws_subnets.default.ids
}}

resource "aws_security_group" "db" {{
  name        = "{prefix}-db"
  description = "Database, reachable only from the application"
  vpc_id      = data.aws_vpc.default.id

  ingress {{
    from_port       = {database["port"]}
    to_port         = {database["port"]}
    protocol        = "tcp"
    security_groups = [aws_security_group.{client_sg}.id]
  }}
}}

resource "aws_db_instance" "db" {{
  identifier                   = "{prefix}-db"
  engine                       = "{database["engine"]}"
  engine_version               = "{database["version"]}"
  instance_class               = "db.t4g.micro"
  allocated_storage            = 20
  storage_type                 = "gp3"
  db_name                      = var.db_name
  username                     = var.db_username
  password                     = var.db_password
  db_subnet_group_name         = aws_db_subnet_group.db.name
  vpc_security_group_ids       = [aws_security_group.db.id]
  publicly_accessible          = false
  multi_az                     = false
  backup_retention_period      = {1 if production else 0}
  performance_insights_enabled = false
  monitoring_interval          = 0
  apply_immediately            = true
  auto_minor_version_upgrade   = true
  skip_final_snapshot          = true
  deletion_protection          = false
}}
'''
    specs = [
        _spec("aws_db_subnet_group", "db", ["database"], "Database subnets"),
        _spec("aws_security_group", "db", ["database"], "Database ingress from the application"),
        _spec("aws_db_instance", "db", ["database"], f"Managed {database['engine']}"),
    ]
    return hcl, specs, {"db_endpoint": "aws_db_instance.db.address"}


# ── Shared: MongoDB (Amazon DocumentDB) ───────────────────────────────────────

# Env names apps commonly read their MongoDB connection string from.
MONGO_ENV_NAMES = ("MONGODB_URI", "MONGO_URI", "MONGO_URL", "MONGODB_URL")
# DocumentDB specifics: one replica set "rs0", no retryable writes, users live
# in the admin database. TLS is disabled by the cluster parameter group.
MONGO_URI_OPTIONS = "replicaSet=rs0&readPreference=secondaryPreferred&retryWrites=false&authSource=admin"


def _documentdb_block(prefix: str, production: bool, client_sg: str) -> tuple[str, list, dict, str]:
    """MongoDB-compatible DocumentDB cluster reachable only from `client_sg`.

    TLS is turned off (parameter group) so any MongoDB driver connects without
    AWS's CA bundle; the cluster is private and admits only the app's
    security group. Returns (hcl, specs, outputs, connection_uri_expression).
    """
    hcl = f'''
variable "docdb_username" {{
  type = string
}}

variable "docdb_password" {{
  type      = string
  sensitive = true
}}

variable "docdb_name" {{
  type = string
}}

resource "aws_docdb_subnet_group" "mongo" {{
  name       = "{prefix}-mongo"
  subnet_ids = data.aws_subnets.default.ids
}}

resource "aws_security_group" "mongo" {{
  name        = "{prefix}-mongo"
  description = "DocumentDB, reachable only from the application"
  vpc_id      = data.aws_vpc.default.id

  ingress {{
    from_port       = 27017
    to_port         = 27017
    protocol        = "tcp"
    security_groups = [aws_security_group.{client_sg}.id]
  }}
}}

resource "aws_docdb_cluster_parameter_group" "mongo" {{
  name   = "{prefix}-mongo"
  family = "docdb5.0"

  parameter {{
    name  = "tls"
    value = "disabled"
  }}
}}

resource "aws_docdb_cluster" "mongo" {{
  cluster_identifier              = "{prefix}-mongo"
  engine                          = "docdb"
  engine_version                  = "5.0.0"
  master_username                 = var.docdb_username
  master_password                 = var.docdb_password
  db_subnet_group_name            = aws_docdb_subnet_group.mongo.name
  vpc_security_group_ids          = [aws_security_group.mongo.id]
  db_cluster_parameter_group_name = aws_docdb_cluster_parameter_group.mongo.name
  storage_encrypted               = true
  backup_retention_period         = {7 if production else 1}
  skip_final_snapshot             = true
  deletion_protection             = false
  apply_immediately               = true
}}

resource "aws_docdb_cluster_instance" "mongo" {{
  identifier         = "{prefix}-mongo-1"
  cluster_identifier = aws_docdb_cluster.mongo.id
  instance_class     = "db.t4g.medium"
  apply_immediately  = true
}}
'''
    specs = [
        _spec("aws_docdb_subnet_group", "mongo", ["database"], "DocumentDB subnets"),
        _spec("aws_security_group", "mongo", ["database"], "DocumentDB ingress from the application"),
        _spec("aws_docdb_cluster_parameter_group", "mongo", ["database"], "DocumentDB settings (TLS off, private)"),
        _spec("aws_docdb_cluster", "mongo", ["database"], "MongoDB-compatible database cluster"),
        _spec("aws_docdb_cluster_instance", "mongo", ["database"], "DocumentDB instance"),
    ]
    uri = ("mongodb://${var.docdb_username}:${var.docdb_password}@${aws_docdb_cluster.mongo.endpoint}:27017/"
           "${var.docdb_name}?" + MONGO_URI_OPTIONS)
    return hcl, specs, {"mongodb_endpoint": "aws_docdb_cluster.mongo.endpoint"}, uri


# ── Server (EC2, configured by Ansible) ───────────────────────────────────────

def render_ec2(context: dict[str, Any]) -> dict[str, Any]:
    """One Ubuntu server for apps that are configured with Ansible.

    Terraform only creates the machine; ansible_engine installs the runtime,
    the app, systemd and nginx. SSH is opened only to the worker's IP
    (var.admin_cidr) with a per-deployment key (var.ssh_public_key); both
    are supplied by the platform in terraform.tfvars.
    """
    prefix = context["resource_name_prefix"]
    region = (context.get("deployment") or {}).get("region")
    services = set(context.get("required_data_services") or [])
    database = next((_RDS_ENGINES[s] for s in ("postgres", "mysql") if s in services), None)
    production = str((context.get("deployment") or {}).get("environment") or "") == "production"
    components = _components(context, "app")

    main_tf = f'''variable "ssh_public_key" {{
  type = string
}}

variable "admin_cidr" {{
  type = string
}}

data "aws_vpc" "default" {{
  default = true
}}

data "aws_subnets" "default" {{
  filter {{
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }}
  filter {{
    name   = "default-for-az"
    values = ["true"]
  }}
}}

data "aws_ssm_parameter" "ubuntu" {{
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}}

resource "aws_key_pair" "server" {{
  key_name   = "{prefix}-key"
  public_key = var.ssh_public_key
}}

resource "aws_security_group" "server" {{
  name        = "{prefix}-server"
  description = "HTTP from anywhere, SSH only from the InfraGenie worker"
  vpc_id      = data.aws_vpc.default.id

  ingress {{
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }}

  ingress {{
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }}

  egress {{
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }}
}}

resource "aws_instance" "server" {{
  ami                         = data.aws_ssm_parameter.ubuntu.value
  instance_type               = "t3.small"
  subnet_id                   = data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.server.id]
  key_name                    = aws_key_pair.server.key_name
  associate_public_ip_address = true

  root_block_device {{
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }}

  metadata_options {{
    http_tokens = "required"
  }}

  tags = {{
    Name = "{prefix}-server"
  }}

  lifecycle {{
    ignore_changes = [ami]
  }}
}}

resource "aws_eip" "server" {{
  instance = aws_instance.server.id
  domain   = "vpc"
}}
'''
    specs = [
        _spec("aws_key_pair", "server", components, "SSH key for Ansible"),
        _spec("aws_security_group", "server", components, "HTTP in, SSH from the worker only"),
        _spec("aws_instance", "server", components, "Application server"),
        _spec("aws_eip", "server", components, "Stable public IP"),
    ]
    outputs = {
        "instance_id": "aws_instance.server.id",
        "instance_public_ip": "aws_eip.server.public_ip",
    }
    if database:
        db_hcl, db_specs, db_outputs = _database_block(prefix, database, production, "server")
        main_tf += db_hcl
        specs += db_specs
        outputs.update(db_outputs)
    if "mongodb" in services:
        # The connection string is written to the app environment by Ansible.
        mongo_hcl, mongo_specs, mongo_outputs, _ = _documentdb_block(prefix, production, "server")
        main_tf += mongo_hcl
        specs += mongo_specs
        outputs.update(mongo_outputs)
    return {
        "files": {"main.tf": main_tf + _outputs(outputs), "providers.tf": _providers(region)},
        "resource_specifications": specs,
    }


# ── Containerized backend (+ optional frontend) ───────────────────────────────

def _api_front(prefix: str, components: list[str]) -> tuple[str, list, str]:
    """HTTPS CloudFront in front of the ALB (no caching), so an HTTPS frontend
    can call the API without mixed-content errors."""
    hcl = f'''
resource "aws_cloudfront_distribution" "api" {{
  enabled             = true
  price_class         = "PriceClass_200"
  wait_for_deployment = false
  comment             = "{prefix} API"

  origin {{
    domain_name = aws_lb.app.dns_name
    origin_id   = "alb"
    custom_origin_config {{
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }}
  }}

  default_cache_behavior {{
    target_origin_id         = "alb"
    viewer_protocol_policy   = "allow-all"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = "{_CACHING_DISABLED}"
    origin_request_policy_id = "{_ALL_VIEWER_EXCEPT_HOST}"
  }}

  restrictions {{
    geo_restriction {{
      restriction_type = "none"
    }}
  }}

  viewer_certificate {{
    cloudfront_default_certificate = true
  }}
}}
'''
    return (hcl, [_spec("aws_cloudfront_distribution", "api", components, "HTTPS endpoint for the API")],
            "https://${aws_cloudfront_distribution.api.domain_name}")


def render_ecs_fargate(context: dict[str, Any]) -> Optional[dict[str, Any]]:
    if not template_applies(context):
        return None
    prefix = context["resource_name_prefix"]
    region = (context.get("deployment") or {}).get("region")
    port = int(context.get("container_port") or 8000)
    health_path = str(context.get("health_check_path") or "/")
    services = set(context.get("required_data_services") or [])
    database = next((_RDS_ENGINES[s] for s in ("postgres", "mysql") if s in services), None)
    redis = "redis" in services
    production = str((context.get("deployment") or {}).get("environment") or "") == "production"
    components = _components(context, "app")
    with_frontend = "s3_cloudfront" in _targets(context)
    hosting = context.get("static_hosting") or STATIC_HOSTING_CLOUDFRONT

    site_hcl, site_specs, site_outputs, site_url = ("", [], {}, "")
    api_hcl, api_specs, api_url = "", [], "http://${aws_lb.app.dns_name}"
    if with_frontend:
        site_hcl, site_specs, site_outputs, site_url = _site_block(prefix, hosting, components)
        if hosting == STATIC_HOSTING_CLOUDFRONT:
            api_hcl, api_specs, api_url = _api_front(prefix, components)

    env_vars = [f'{{ name = "PORT", value = "{port}" }}']
    if with_frontend:
        # Common names backends read their allowed browser origin(s) from.
        env_vars += [
            f'{{ name = "{name}", value = "{site_url}" }}'
            for name in ("FRONTEND_URL", "ALLOWED_ORIGINS", "CORS_ORIGINS")
        ]
    if database:
        env_vars.append(
            '{ name = "DATABASE_URL", value = "' + database["scheme"]
            + '://${var.db_username}:${var.db_password}@${aws_db_instance.db.endpoint}/${var.db_name}" }'
        )
    if redis:
        env_vars.append(
            '{ name = "REDIS_URL", value = "redis://${aws_elasticache_cluster.cache.cache_nodes[0].address}:6379/0" }'
        )
    mongo = "mongodb" in services
    if mongo:
        mongo_hcl, mongo_specs, mongo_outputs, mongo_uri = _documentdb_block(prefix, production, "app")
        env_vars += [f'{{ name = "{name}", value = "{mongo_uri}" }}' for name in MONGO_ENV_NAMES]
    env_block = ",\n        ".join(env_vars)

    main_tf = f'''data "aws_vpc" "default" {{
  default = true
}}

data "aws_subnets" "default" {{
  filter {{
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }}
  filter {{
    name   = "default-for-az"
    values = ["true"]
  }}
}}

resource "aws_ecr_repository" "app" {{
  name                 = "{prefix}-app"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}}

resource "aws_cloudwatch_log_group" "app" {{
  name              = "/ecs/{prefix}"
  retention_in_days = 7
}}

resource "aws_iam_role" "execution" {{
  name = "{prefix}-ecs-exec"
  assume_role_policy = jsonencode({{
    Version = "2012-10-17"
    Statement = [{{
      Effect    = "Allow"
      Principal = {{ Service = "ecs-tasks.amazonaws.com" }}
      Action    = "sts:AssumeRole"
    }}]
  }})
}}

resource "aws_iam_role_policy_attachment" "execution" {{
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}}

resource "aws_security_group" "alb" {{
  name        = "{prefix}-alb"
  description = "Public HTTP to the load balancer"
  vpc_id      = data.aws_vpc.default.id

  ingress {{
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }}

  egress {{
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }}
}}

resource "aws_security_group" "app" {{
  name        = "{prefix}-app"
  description = "Application tasks, reachable only from the load balancer"
  vpc_id      = data.aws_vpc.default.id

  ingress {{
    from_port       = {port}
    to_port         = {port}
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }}

  egress {{
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }}
}}

resource "aws_lb" "app" {{
  name               = "{prefix}-alb"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.default.ids
}}

resource "aws_lb_target_group" "app" {{
  name                 = "{prefix}-tg"
  port                 = {port}
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = data.aws_vpc.default.id
  deregistration_delay = 10

  health_check {{
    path                = "{health_path}"
    matcher             = "200-499"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }}
}}

resource "aws_lb_listener" "http" {{
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {{
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }}
}}

resource "aws_ecs_cluster" "app" {{
  name = "{prefix}-cluster"
}}

resource "aws_ecs_task_definition" "app" {{
  family                   = "{prefix}-app"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn

  container_definitions = jsonencode([{{
    name         = "app"
    image        = "${{aws_ecr_repository.app.repository_url}}:latest"
    essential    = true
    portMappings = [{{ containerPort = {port}, protocol = "tcp" }}]
    environment = [
        {env_block}
    ]
    logConfiguration = {{
      logDriver = "awslogs"
      options = {{
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = "{region}"
        awslogs-stream-prefix = "app"
      }}
    }}
  }}])
}}

resource "aws_ecs_service" "app" {{
  name                               = "{prefix}-svc"
  cluster                            = aws_ecs_cluster.app.id
  task_definition                    = aws_ecs_task_definition.app.arn
  launch_type                        = "FARGATE"
  desired_count                      = 0
  health_check_grace_period_seconds  = 60
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200

  network_configuration {{
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true
  }}

  load_balancer {{
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = {port}
  }}

  lifecycle {{
    ignore_changes = [desired_count]
  }}

  depends_on = [aws_lb_listener.http]
}}
'''
    specs: list[dict[str, Any]] = [
        _spec("aws_ecr_repository", "app", ["registry"], "Container image registry"),
        _spec("aws_cloudwatch_log_group", "app", components, "Container logs"),
        _spec("aws_iam_role", "execution", components, "ECS task execution role"),
        _spec("aws_security_group", "alb", components, "Load balancer ingress"),
        _spec("aws_security_group", "app", components, "Task ingress from ALB"),
        _spec("aws_lb", "app", components, "Public load balancer"),
        _spec("aws_lb_target_group", "app", components, "ECS task targets"),
        _spec("aws_lb_listener", "http", components, "HTTP listener"),
        _spec("aws_ecs_cluster", "app", components, "ECS cluster"),
        _spec("aws_ecs_task_definition", "app", components, "Container definition"),
        _spec("aws_ecs_service", "app", components, "Runs the application"),
    ]
    outputs = {
        "ecs_cluster_name": "aws_ecs_cluster.app.name",
        "ecs_service_name": "aws_ecs_service.app.name",
        "alb_dns_name": "aws_lb.app.dns_name",
        "ecr_repository_url": "aws_ecr_repository.app.repository_url",
        "api_url": f'"{api_url}"',
    }

    if database:
        db_hcl, db_specs, db_outputs = _database_block(prefix, database, production, "app")
        main_tf += db_hcl
        specs += db_specs
        outputs.update(db_outputs)

    if redis:
        main_tf += f'''
resource "aws_elasticache_subnet_group" "cache" {{
  name       = "{prefix}-cache"
  subnet_ids = data.aws_subnets.default.ids
}}

resource "aws_security_group" "cache" {{
  name        = "{prefix}-cache"
  description = "Redis, reachable only from the application"
  vpc_id      = data.aws_vpc.default.id

  ingress {{
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }}
}}

resource "aws_elasticache_cluster" "cache" {{
  cluster_id         = "{prefix}-cache"
  engine             = "redis"
  node_type          = "cache.t4g.micro"
  num_cache_nodes    = 1
  port               = 6379
  subnet_group_name  = aws_elasticache_subnet_group.cache.name
  security_group_ids = [aws_security_group.cache.id]
  apply_immediately  = true
}}
'''
        specs += [
            _spec("aws_elasticache_subnet_group", "cache", ["cache"], "Cache subnets"),
            _spec("aws_security_group", "cache", ["cache"], "Cache ingress from app"),
            _spec("aws_elasticache_cluster", "cache", ["cache"], "Managed Redis"),
        ]
        outputs["redis_endpoint"] = "aws_elasticache_cluster.cache.cache_nodes[0].address"

    if mongo:
        main_tf += mongo_hcl
        specs += mongo_specs
        outputs.update(mongo_outputs)

    if with_frontend:
        main_tf += "\n" + site_hcl + api_hcl
        specs += site_specs + api_specs
        outputs.update(site_outputs)
        outputs["frontend_url"] = f'"{site_url}"'

    return {
        "files": {"main.tf": main_tf + _outputs(outputs), "providers.tf": _providers(region)},
        "resource_specifications": specs,
    }
