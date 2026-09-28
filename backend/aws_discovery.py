"""
aws_discovery.py — AWS Infrastructure Discovery Service for Infra Genie.

Architecture
────────────
AWSDiscoveryService is a DETERMINISTIC service — not an LLM agent.
It calls AWS read-only APIs directly, collects structured JSON, and returns
it as environment context for the Architecture / Deployment agents.

No resources are created or modified. All calls are read-only.

Resources discovered per region
────────────────────────────────
  VPCs              ec2.describe_vpcs()
  Subnets           ec2.describe_subnets()
  Route Tables      ec2.describe_route_tables()
  Internet Gateways ec2.describe_internet_gateways()
  NAT Gateways      ec2.describe_nat_gateways()
  Security Groups   ec2.describe_security_groups()
  EC2 Instances     ec2.describe_instances()
  Load Balancers    elbv2.describe_load_balancers()  (ALB / NLB)
  Classic ELBs      elb.describe_load_balancers()   (CLB)
  EKS Clusters      eks.list_clusters() + eks.describe_cluster()
  RDS Instances     rds.describe_db_instances()
  S3 Buckets        s3.list_buckets()  (global, not per-region)
  IAM Roles         iam.list_roles()   (global, not per-region)
  ECR Repos         ecr.describe_repositories()

SECURITY INVARIANTS
───────────────────
• No credentials are stored; a boto3.Session obtained from the existing
  AWSConnectionService.assume_role() flow is passed in.
• All API calls are read-only (Describe / List).
• Sensitive fields (e.g. IAM trust policies containing the External ID)
  are included in the structured output for use by the Deployment Agent
  but must NOT be forwarded to untrusted parties.
• IAM role listing is bounded to avoid huge payloads (max 100 roles,
  filtered to exclude AWS-managed roles).
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional
import uuid

import boto3
import botocore.exceptions
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from aws_connection import AWSConnectionError, aws_connection_service
from models import CloudAccount, CloudAccountStatus

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _tags_to_dict(tags: list[dict]) -> dict[str, str]:
    """Convert AWS tag list [{"Key": k, "Value": v}] → {k: v}."""
    return {t.get("Key", ""): t.get("Value", "") for t in (tags or [])}


def _name_tag(tags: list[dict]) -> str:
    """Extract the 'Name' tag value, or empty string."""
    return _tags_to_dict(tags).get("Name", "")


def _safe(fn, default=None):
    """Call fn(), return default on any exception (for optional enrichment calls)."""
    try:
        return fn()
    except Exception:
        return default


# ── AWSDiscoveryService ───────────────────────────────────────────────────────

class AWSDiscoveryService:
    """
    Deterministic AWS infrastructure scanner.

    Usage (called from discovery_routes.py):

        service = AWSDiscoveryService()
        result = await service.run_discovery(
            db=db,
            connection_id=connection_id,
            user_id=user_id,
        )
        # result is a DiscoveryResult dict stored in the DB

    All boto3 calls are synchronous and run in a thread pool via
    asyncio.to_thread() so the async FastAPI event loop is not blocked.
    """

    # ── Public async entry point ──────────────────────────────────────────────

    async def run_discovery(
        self,
        *,
        db: AsyncSession,
        connection_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> dict[str, Any]:
        """
        Full discovery run for a connected AWS account.

        1. Load cloud account record (verifies user owns it and it is CONNECTED).
        2. Assume the cross-account IAM role to get a boto3.Session.
        3. Run all discovery calls in a thread (non-blocking).
        4. Persist the result to cloud_accounts.discovery_result.
        5. Return the structured discovery dict.

        Raises:
            ValueError            — connection not found / not CONNECTED
            AWSConnectionError    — STS AssumeRole failed
        """
        # ── Load and validate connection ──────────────────────────────────────
        record = await self._get_connected_account(db, connection_id, user_id)

        logger.info(
            "[DISCOVERY] Starting | user=%s | account=%s | region=%s",
            user_id, record.account_id, record.region,
        )

        # ── Assume the cross-account role ─────────────────────────────────────
        # This reuses the exact same AssumeRole flow already proven during connect/verify.
        session = await asyncio.to_thread(
            aws_connection_service._sts.assume_role,
            role_arn=record.role_arn,
            external_id=record.external_id,
            session_name=f"InfraGenieDiscovery-{str(record.id)[:8]}",
        )

        # ── Run all discovery calls (blocking boto3) in a thread ──────────────
        result = await asyncio.to_thread(
            self._collect_all,
            session=session,
            account_id=record.account_id,
            region=record.region,
        )

        # ── Persist to DB ─────────────────────────────────────────────────────
        await self._save_discovery(db, record, result)

        logger.info(
            "[DISCOVERY] Complete | account=%s | vpcs=%d | ec2=%d | eks=%d | rds=%d | s3=%d",
            record.account_id,
            len(result.get("vpcs", [])),
            len(result.get("ec2_instances", [])),
            len(result.get("eks_clusters", [])),
            len(result.get("rds_instances", [])),
            len(result.get("s3_buckets", [])),
        )

        return result

    # ── Core collection (runs in thread) ─────────────────────────────────────

    def _collect_all(
        self,
        *,
        session: boto3.Session,
        account_id: str,
        region: str,
    ) -> dict[str, Any]:
        """
        Orchestrate all discovery calls and build the final structured dict.
        This runs entirely in a thread pool — NO async/await here.
        """
        result: dict[str, Any] = {
            "account_id": account_id,
            "region": region,
            "discovered_at": _utcnow_iso(),
            "vpcs": [],
            "subnets": [],
            "route_tables": [],
            "internet_gateways": [],
            "nat_gateways": [],
            "security_groups": [],
            "ec2_instances": [],
            "load_balancers": [],
            "eks_clusters": [],
            "rds_instances": [],
            "s3_buckets": [],
            "ecr_repositories": [],
            "iam_roles": [],
            "errors": [],
        }

        # ── EC2-scoped resources ──────────────────────────────────────────────
        ec2 = session.client("ec2", region_name=region)

        result["vpcs"]              = _safe(lambda: self._discover_vpcs(ec2), [])
        result["subnets"]           = _safe(lambda: self._discover_subnets(ec2), [])
        result["route_tables"]      = _safe(lambda: self._discover_route_tables(ec2), [])
        result["internet_gateways"] = _safe(lambda: self._discover_igws(ec2), [])
        result["nat_gateways"]      = _safe(lambda: self._discover_nat_gateways(ec2), [])
        result["security_groups"]   = _safe(lambda: self._discover_security_groups(ec2), [])
        result["ec2_instances"]     = _safe(lambda: self._discover_ec2_instances(ec2), [])

        # ── Load Balancers (ALB/NLB via elbv2 + Classic ELB) ─────────────────
        elbv2  = session.client("elbv2", region_name=region)
        elb    = session.client("elb",   region_name=region)
        result["load_balancers"] = _safe(lambda: self._discover_load_balancers(elbv2, elb), [])

        # ── EKS ───────────────────────────────────────────────────────────────
        eks = session.client("eks", region_name=region)
        result["eks_clusters"] = _safe(lambda: self._discover_eks_clusters(eks), [])

        # ── RDS ───────────────────────────────────────────────────────────────
        rds = session.client("rds", region_name=region)
        result["rds_instances"] = _safe(lambda: self._discover_rds_instances(rds), [])

        # ── S3 (global — not region-scoped) ───────────────────────────────────
        s3 = session.client("s3", region_name=region)
        result["s3_buckets"] = _safe(lambda: self._discover_s3_buckets(s3), [])

        # ── ECR ───────────────────────────────────────────────────────────────
        ecr = session.client("ecr", region_name=region)
        result["ecr_repositories"] = _safe(lambda: self._discover_ecr_repos(ecr), [])

        # ── IAM (global) ──────────────────────────────────────────────────────
        iam = session.client("iam", region_name=region)
        result["iam_roles"] = _safe(lambda: self._discover_iam_roles(iam), [])

        # ── Summary ───────────────────────────────────────────────────────────
        result["summary"] = self._build_summary(result)

        return result

    # ── VPCs ──────────────────────────────────────────────────────────────────

    def _discover_vpcs(self, ec2) -> list[dict]:
        resp = ec2.describe_vpcs()
        out = []
        for v in resp.get("Vpcs", []):
            out.append({
                "vpc_id":     v["VpcId"],
                "cidr":       v.get("CidrBlock", ""),
                "is_default": v.get("IsDefault", False),
                "state":      v.get("State", ""),
                "name":       _name_tag(v.get("Tags", [])),
                "tags":       _tags_to_dict(v.get("Tags", [])),
            })
        logger.debug("[DISCOVERY] VPCs found: %d", len(out))
        return out

    # ── Subnets ───────────────────────────────────────────────────────────────

    def _discover_subnets(self, ec2) -> list[dict]:
        paginator = ec2.get_paginator("describe_subnets")
        out = []
        for page in paginator.paginate():
            for s in page.get("Subnets", []):
                out.append({
                    "subnet_id":               s["SubnetId"],
                    "vpc_id":                  s.get("VpcId", ""),
                    "cidr":                    s.get("CidrBlock", ""),
                    "availability_zone":       s.get("AvailabilityZone", ""),
                    "available_ip_count":      s.get("AvailableIpAddressCount", 0),
                    "map_public_ip_on_launch": s.get("MapPublicIpOnLaunch", False),
                    "state":                   s.get("State", ""),
                    "name":                    _name_tag(s.get("Tags", [])),
                    "tags":                    _tags_to_dict(s.get("Tags", [])),
                })
        logger.debug("[DISCOVERY] Subnets found: %d", len(out))
        return out

    # ── Route Tables ──────────────────────────────────────────────────────────

    def _discover_route_tables(self, ec2) -> list[dict]:
        resp = ec2.describe_route_tables()
        out = []
        for rt in resp.get("RouteTables", []):
            routes = [
                {
                    "destination_cidr":     r.get("DestinationCidrBlock", ""),
                    "destination_ipv6_cidr": r.get("DestinationIpv6CidrBlock", ""),
                    "gateway_id":           r.get("GatewayId", ""),
                    "nat_gateway_id":       r.get("NatGatewayId", ""),
                    "instance_id":          r.get("InstanceId", ""),
                    "state":                r.get("State", ""),
                }
                for r in rt.get("Routes", [])
            ]
            associations = [
                {
                    "subnet_id":    a.get("SubnetId", ""),
                    "is_main":      a.get("Main", False),
                }
                for a in rt.get("Associations", [])
            ]
            out.append({
                "route_table_id": rt["RouteTableId"],
                "vpc_id":         rt.get("VpcId", ""),
                "name":           _name_tag(rt.get("Tags", [])),
                "routes":         routes,
                "associations":   associations,
            })
        logger.debug("[DISCOVERY] Route tables found: %d", len(out))
        return out

    # ── Internet Gateways ─────────────────────────────────────────────────────

    def _discover_igws(self, ec2) -> list[dict]:
        resp = ec2.describe_internet_gateways()
        out = []
        for igw in resp.get("InternetGateways", []):
            attachments = [
                {"vpc_id": a.get("VpcId", ""), "state": a.get("State", "")}
                for a in igw.get("Attachments", [])
            ]
            out.append({
                "igw_id":      igw["InternetGatewayId"],
                "name":        _name_tag(igw.get("Tags", [])),
                "attachments": attachments,
            })
        logger.debug("[DISCOVERY] Internet Gateways found: %d", len(out))
        return out

    # ── NAT Gateways ──────────────────────────────────────────────────────────

    def _discover_nat_gateways(self, ec2) -> list[dict]:
        resp = ec2.describe_nat_gateways(
            Filter=[{"Name": "state", "Values": ["available", "pending"]}]
        )
        out = []
        for nat in resp.get("NatGateways", []):
            addresses = [
                {
                    "public_ip":    a.get("PublicIp", ""),
                    "private_ip":   a.get("PrivateIp", ""),
                    "allocation_id": a.get("AllocationId", ""),
                }
                for a in nat.get("NatGatewayAddresses", [])
            ]
            out.append({
                "nat_gateway_id": nat["NatGatewayId"],
                "vpc_id":         nat.get("VpcId", ""),
                "subnet_id":      nat.get("SubnetId", ""),
                "state":          nat.get("State", ""),
                "type":           nat.get("ConnectivityType", "public"),
                "name":           _name_tag(nat.get("Tags", [])),
                "addresses":      addresses,
            })
        logger.debug("[DISCOVERY] NAT Gateways found: %d", len(out))
        return out

    # ── Security Groups ───────────────────────────────────────────────────────

    def _discover_security_groups(self, ec2) -> list[dict]:
        paginator = ec2.get_paginator("describe_security_groups")
        out = []
        for page in paginator.paginate():
            for sg in page.get("SecurityGroups", []):
                def _rules(rules: list) -> list[dict]:
                    result = []
                    for r in rules:
                        cidrs = [c.get("CidrIp", "") for c in r.get("IpRanges", [])]
                        result.append({
                            "protocol":    r.get("IpProtocol", ""),
                            "from_port":   r.get("FromPort"),
                            "to_port":     r.get("ToPort"),
                            "cidr_ranges": cidrs,
                        })
                    return result

                out.append({
                    "sg_id":       sg["GroupId"],
                    "name":        sg.get("GroupName", ""),
                    "description": sg.get("Description", ""),
                    "vpc_id":      sg.get("VpcId", ""),
                    "inbound":     _rules(sg.get("IpPermissions", [])),
                    "outbound":    _rules(sg.get("IpPermissionsEgress", [])),
                    "tags":        _tags_to_dict(sg.get("Tags", [])),
                })
        logger.debug("[DISCOVERY] Security Groups found: %d", len(out))
        return out

    # ── EC2 Instances ─────────────────────────────────────────────────────────

    def _discover_ec2_instances(self, ec2) -> list[dict]:
        paginator = ec2.get_paginator("describe_instances")
        out = []
        for page in paginator.paginate():
            for reservation in page.get("Reservations", []):
                for i in reservation.get("Instances", []):
                    # Skip terminated instances
                    state = i.get("State", {}).get("Name", "")
                    if state == "terminated":
                        continue

                    sgs = [
                        {"sg_id": g.get("GroupId", ""), "name": g.get("GroupName", "")}
                        for g in i.get("SecurityGroups", [])
                    ]
                    network_interfaces = [
                        {
                            "interface_id": ni.get("NetworkInterfaceId", ""),
                            "subnet_id":    ni.get("SubnetId", ""),
                            "private_ip":   ni.get("PrivateIpAddress", ""),
                            "public_ip":    ni.get("Association", {}).get("PublicIp", ""),
                        }
                        for ni in i.get("NetworkInterfaces", [])
                    ]

                    out.append({
                        "instance_id":    i["InstanceId"],
                        "instance_type":  i.get("InstanceType", ""),
                        "state":          state,
                        "ami_id":         i.get("ImageId", ""),
                        "vpc_id":         i.get("VpcId", ""),
                        "subnet_id":      i.get("SubnetId", ""),
                        "private_ip":     i.get("PrivateIpAddress", ""),
                        "public_ip":      i.get("PublicIpAddress", ""),
                        "key_name":       i.get("KeyName", ""),
                        "iam_profile":    (i.get("IamInstanceProfile") or {}).get("Arn", ""),
                        "launch_time":    i.get("LaunchTime", "").isoformat()
                            if hasattr(i.get("LaunchTime", ""), "isoformat") else "",
                        "security_groups": sgs,
                        "network_interfaces": network_interfaces,
                        "name":           _name_tag(i.get("Tags", [])),
                        "tags":           _tags_to_dict(i.get("Tags", [])),
                    })
        logger.debug("[DISCOVERY] EC2 instances found: %d", len(out))
        return out

    # ── Load Balancers (ALB / NLB + Classic) ─────────────────────────────────

    def _discover_load_balancers(self, elbv2, elb) -> list[dict]:
        out = []

        # ALB / NLB via elbv2
        try:
            paginator = elbv2.get_paginator("describe_load_balancers")
            for page in paginator.paginate():
                for lb in page.get("LoadBalancers", []):
                    azs = [
                        {"az": az.get("ZoneName", ""), "subnet_id": az.get("SubnetId", "")}
                        for az in lb.get("AvailabilityZones", [])
                    ]
                    out.append({
                        "lb_arn":             lb.get("LoadBalancerArn", ""),
                        "name":               lb.get("LoadBalancerName", ""),
                        "type":               lb.get("Type", ""),             # application | network | gateway
                        "scheme":             lb.get("Scheme", ""),           # internet-facing | internal
                        "state":              lb.get("State", {}).get("Code", ""),
                        "dns_name":           lb.get("DNSName", ""),
                        "vpc_id":             lb.get("VpcId", ""),
                        "availability_zones": azs,
                        "security_groups":    lb.get("SecurityGroups", []),
                        "ip_address_type":    lb.get("IpAddressType", ""),
                        "source":             "elbv2",
                    })
        except botocore.exceptions.ClientError as exc:
            logger.warning("[DISCOVERY] elbv2 describe_load_balancers failed: %s", exc)

        # Classic ELBs
        try:
            resp = elb.describe_load_balancers()
            for lb in resp.get("LoadBalancerDescriptions", []):
                out.append({
                    "lb_arn":             "",
                    "name":               lb.get("LoadBalancerName", ""),
                    "type":               "classic",
                    "scheme":             lb.get("Scheme", ""),
                    "state":              "active",
                    "dns_name":           lb.get("DNSName", ""),
                    "vpc_id":             lb.get("VPCId", ""),
                    "availability_zones": lb.get("AvailabilityZones", []),
                    "security_groups":    lb.get("SecurityGroups", []),
                    "ip_address_type":    "ipv4",
                    "source":             "classic-elb",
                })
        except botocore.exceptions.ClientError as exc:
            logger.warning("[DISCOVERY] classic ELB describe_load_balancers failed: %s", exc)

        logger.debug("[DISCOVERY] Load Balancers found: %d", len(out))
        return out

    # ── EKS Clusters ──────────────────────────────────────────────────────────

    def _discover_eks_clusters(self, eks) -> list[dict]:
        try:
            names = eks.list_clusters().get("clusters", [])
        except botocore.exceptions.ClientError as exc:
            logger.warning("[DISCOVERY] eks list_clusters failed: %s", exc)
            return []

        out = []
        for name in names:
            try:
                detail = eks.describe_cluster(name=name).get("cluster", {})
                resources_vpc = detail.get("resourcesVpcConfig", {})
                out.append({
                    "cluster_name":     detail.get("name", name),
                    "arn":              detail.get("arn", ""),
                    "status":           detail.get("status", ""),
                    "kubernetes_version": detail.get("version", ""),
                    "endpoint":         detail.get("endpoint", ""),
                    "role_arn":         detail.get("roleArn", ""),
                    "vpc_id":           resources_vpc.get("vpcId", ""),
                    "subnet_ids":       resources_vpc.get("subnetIds", []),
                    "security_group_ids": resources_vpc.get("securityGroupIds", []),
                    "cluster_sg_id":    resources_vpc.get("clusterSecurityGroupId", ""),
                    "endpoint_public_access":  resources_vpc.get("endpointPublicAccess", True),
                    "endpoint_private_access": resources_vpc.get("endpointPrivateAccess", False),
                    "logging_enabled":  bool(
                        detail.get("logging", {}).get("clusterLogging", [])
                    ),
                    "tags":             detail.get("tags", {}),
                })
            except botocore.exceptions.ClientError as exc:
                logger.warning("[DISCOVERY] eks describe_cluster(%s) failed: %s", name, exc)

        logger.debug("[DISCOVERY] EKS clusters found: %d", len(out))
        return out

    # ── RDS Instances ─────────────────────────────────────────────────────────

    def _discover_rds_instances(self, rds) -> list[dict]:
        paginator = rds.get_paginator("describe_db_instances")
        out = []
        for page in paginator.paginate():
            for db in page.get("DBInstances", []):
                vpc_sg = [
                    {"sg_id": g.get("VpcSecurityGroupId", ""), "status": g.get("Status", "")}
                    for g in db.get("VpcSecurityGroups", [])
                ]
                out.append({
                    "db_identifier":      db.get("DBInstanceIdentifier", ""),
                    "db_class":           db.get("DBInstanceClass", ""),
                    "engine":             db.get("Engine", ""),
                    "engine_version":     db.get("EngineVersion", ""),
                    "status":             db.get("DBInstanceStatus", ""),
                    "multi_az":           db.get("MultiAZ", False),
                    "storage_type":       db.get("StorageType", ""),
                    "allocated_storage":  db.get("AllocatedStorage", 0),  # GB
                    "endpoint_address":   (db.get("Endpoint") or {}).get("Address", ""),
                    "endpoint_port":      (db.get("Endpoint") or {}).get("Port", 0),
                    "vpc_id":             (db.get("DBSubnetGroup") or {}).get("VpcId", ""),
                    "subnet_group":       (db.get("DBSubnetGroup") or {}).get("DBSubnetGroupName", ""),
                    "publicly_accessible": db.get("PubliclyAccessible", False),
                    "storage_encrypted":  db.get("StorageEncrypted", False),
                    "vpc_security_groups": vpc_sg,
                    "tags":               _tags_to_dict(db.get("TagList", [])),
                })
        logger.debug("[DISCOVERY] RDS instances found: %d", len(out))
        return out

    # ── S3 Buckets (global) ───────────────────────────────────────────────────

    def _discover_s3_buckets(self, s3) -> list[dict]:
        try:
            resp = s3.list_buckets()
        except botocore.exceptions.ClientError as exc:
            logger.warning("[DISCOVERY] s3 list_buckets failed: %s", exc)
            return []

        out = []
        for bucket in resp.get("Buckets", []):
            name = bucket.get("Name", "")
            created = bucket.get("CreationDate", "")
            if hasattr(created, "isoformat"):
                created = created.isoformat()

            # Try to get bucket region (best-effort — may fail for cross-region)
            bucket_region = _safe(
                lambda n=name: s3.get_bucket_location(Bucket=n).get(
                    "LocationConstraint"
                ) or "us-east-1"
            )

            out.append({
                "name":        name,
                "created_at":  created,
                "region":      bucket_region,
            })

        logger.debug("[DISCOVERY] S3 buckets found: %d", len(out))
        return out

    # ── ECR Repositories ──────────────────────────────────────────────────────

    def _discover_ecr_repos(self, ecr) -> list[dict]:
        try:
            paginator = ecr.get_paginator("describe_repositories")
            out = []
            for page in paginator.paginate():
                for repo in page.get("repositories", []):
                    out.append({
                        "name":            repo.get("repositoryName", ""),
                        "arn":             repo.get("repositoryArn", ""),
                        "uri":             repo.get("repositoryUri", ""),
                        "image_tag_mutability": repo.get("imageTagMutability", ""),
                        "scan_on_push":    repo.get("imageScanningConfiguration", {}).get(
                            "scanOnPush", False
                        ),
                        "created_at":      repo.get("createdAt", "").isoformat()
                            if hasattr(repo.get("createdAt", ""), "isoformat") else "",
                    })
            logger.debug("[DISCOVERY] ECR repositories found: %d", len(out))
            return out
        except botocore.exceptions.ClientError as exc:
            logger.warning("[DISCOVERY] ecr describe_repositories failed: %s", exc)
            return []

    # ── IAM Roles (global, customer-managed only, bounded) ───────────────────

    def _discover_iam_roles(self, iam) -> list[dict]:
        """
        Returns up to 100 customer-managed IAM roles.
        AWS-managed roles (path starts with /aws-service-role/ or /aws-reserved/)
        are excluded to reduce noise and payload size.
        """
        try:
            paginator = iam.get_paginator("list_roles")
            out = []
            for page in paginator.paginate(MaxItems=200):
                for role in page.get("Roles", []):
                    path = role.get("Path", "/")
                    # Skip AWS-managed service-linked and reserved roles
                    if path.startswith("/aws-service-role/") or path.startswith("/aws-reserved/"):
                        continue
                    out.append({
                        "role_name":      role.get("RoleName", ""),
                        "role_arn":       role.get("Arn", ""),
                        "path":           path,
                        "description":    role.get("Description", ""),
                        "created_at":     role.get("CreateDate", "").isoformat()
                            if hasattr(role.get("CreateDate", ""), "isoformat") else "",
                        "max_session_duration": role.get("MaxSessionDuration", 3600),
                    })
                    if len(out) >= 100:
                        break
                if len(out) >= 100:
                    break

            logger.debug("[DISCOVERY] IAM roles found: %d", len(out))
            return out
        except botocore.exceptions.ClientError as exc:
            logger.warning("[DISCOVERY] iam list_roles failed: %s", exc)
            return []

    # ── Summary ───────────────────────────────────────────────────────────────

    def _build_summary(self, result: dict[str, Any]) -> dict[str, Any]:
        """
        Build a high-level counts summary for quick display in the UI.
        This is derived data — always re-computable from the full result.
        """
        ec2_by_state: dict[str, int] = {}
        for i in result.get("ec2_instances", []):
            state = i.get("state", "unknown")
            ec2_by_state[state] = ec2_by_state.get(state, 0) + 1

        rds_by_engine: dict[str, int] = {}
        for db in result.get("rds_instances", []):
            engine = db.get("engine", "unknown")
            rds_by_engine[engine] = rds_by_engine.get(engine, 0) + 1

        lb_by_type: dict[str, int] = {}
        for lb in result.get("load_balancers", []):
            lb_type = lb.get("type", "unknown")
            lb_by_type[lb_type] = lb_by_type.get(lb_type, 0) + 1

        return {
            "vpc_count":            len(result.get("vpcs", [])),
            "subnet_count":         len(result.get("subnets", [])),
            "security_group_count": len(result.get("security_groups", [])),
            "ec2_instance_count":   len(result.get("ec2_instances", [])),
            "ec2_by_state":         ec2_by_state,
            "load_balancer_count":  len(result.get("load_balancers", [])),
            "lb_by_type":           lb_by_type,
            "eks_cluster_count":    len(result.get("eks_clusters", [])),
            "rds_instance_count":   len(result.get("rds_instances", [])),
            "rds_by_engine":        rds_by_engine,
            "s3_bucket_count":      len(result.get("s3_buckets", [])),
            "ecr_repo_count":       len(result.get("ecr_repositories", [])),
            "iam_role_count":       len(result.get("iam_roles", [])),
            "nat_gateway_count":    len(result.get("nat_gateways", [])),
            "igw_count":            len(result.get("internet_gateways", [])),
        }

    # ── DB helpers ────────────────────────────────────────────────────────────

    async def _get_connected_account(
        self,
        db: AsyncSession,
        connection_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> CloudAccount:
        """
        Load a cloud account, enforce user ownership, and verify it is CONNECTED.
        Raises ValueError if not found, access denied, or not in CONNECTED state.
        """
        res = await db.execute(
            select(CloudAccount).where(
                CloudAccount.id == connection_id,
                CloudAccount.user_id == user_id,
            )
        )
        record = res.scalar_one_or_none()
        if record is None:
            raise ValueError("Cloud account connection not found.")
        if record.status != CloudAccountStatus.connected:
            raise ValueError(
                f"AWS account must be in CONNECTED status before discovery. "
                f"Current status: {record.status.value}. "
                "Please verify the connection first."
            )
        if not record.role_arn:
            raise ValueError("Cloud account has no role ARN. Please verify the connection first.")
        return record

    async def _save_discovery(
        self,
        db: AsyncSession,
        record: CloudAccount,
        result: dict[str, Any],
    ) -> None:
        """Persist discovery result to cloud_accounts.discovery_result."""
        await db.execute(
            text(
                "UPDATE cloud_accounts "
                "SET discovery_result = :result, "
                "    discovery_ran_at = NOW(), "
                "    updated_at = NOW() "
                "WHERE id = :id"
            ),
            {"result": json.dumps(result), "id": str(record.id)},
        )
        await db.commit()


# ── Module singleton (imported by discovery_routes.py) ───────────────────────

aws_discovery_service = AWSDiscoveryService()
