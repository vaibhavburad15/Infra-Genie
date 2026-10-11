
from __future__ import annotations

import json
import logging
import subprocess
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# ── Timeouts ─────────────────────────────────────────────────────────────────
_HTTP_CHECK_TIMEOUT = 10        # seconds per individual HTTP probe
_TCP_CHECK_TIMEOUT  = 5         # seconds per individual TCP probe
_VERIFY_TOTAL       = 300       # seconds before giving up on all probes
_VERIFY_INTERVAL    = 15        # seconds between probe attempts


# ── Router ────────────────────────────────────────────────────────────────────

def run_application_deployment(
    *,
    deployment: Any,
    project: Any,
    account: Any,
    workspace: Path,
    env: Dict[str, str],
) -> Dict[str, Any]:
    """Dispatch to the correct target adapter's deploy() function.

    If no strategy is present (legacy deployment), performs a no-op and returns
    an empty outputs dict so the pipeline can continue to verification.
    """
    strategy_json = deployment.strategy_json or {}
    primary_target = strategy_json.get("primary_target", "ec2")

    logger.info(
        "[ADAPTER] app_deploy_start | deployment_id=%s | target=%s",
        deployment.id, primary_target,
    )

    adapter_map = {
        "ec2":           _deploy_ec2,
        "ecs_fargate":   _deploy_ecs_fargate,
        "s3_cloudfront": _deploy_s3_cloudfront,
        "rds":           _deploy_rds,
        "ecr":           _deploy_ecr,
    }

    # For multi-component strategies, deploy each active component in
    # dependency order.  Components with no deploy step (ecr, rds) are skipped.
    components = strategy_json.get("components", [])
    all_outputs: Dict[str, Any] = {}

    if components:
        # Build a simple dependency order (topological sort by dependency list)
        ordered = _topo_sort(components)
        for comp in ordered:
            target = comp.get("target", "")
            fn = adapter_map.get(target)
            if fn is None:
                logger.info(
                    "[ADAPTER] skip_component | name=%s | target=%s (no deploy fn)",
                    comp.get("name"), target,
                )
                continue
            result = fn(
                deployment=deployment,
                project=project,
                account=account,
                workspace=workspace,
                env=env,
                component=comp,
            )
            all_outputs[comp.get("name", target)] = result.get("outputs", {})
    else:
        # Legacy: no components — try primary target
        fn = adapter_map.get(primary_target)
        if fn:
            result = fn(
                deployment=deployment,
                project=project,
                account=account,
                workspace=workspace,
                env=env,
                component=None,
            )
            all_outputs["default"] = result.get("outputs", {})

    logger.info(
        "[ADAPTER] app_deploy_done | deployment_id=%s", deployment.id
    )
    return {"outputs": all_outputs}


def run_verification(
    *,
    deployment: Any,
    project: Any,
    workspace: Path,
) -> Dict[str, Any]:
    """Run health checks for all components that require them.

    Returns a dict with per-component check results.
    Raises RuntimeError if any required check fails within the timeout.
    """
    strategy_json = deployment.strategy_json or {}
    components = strategy_json.get("components", [])
    deployment_outputs = deployment.deployment_outputs or {}

    results: Dict[str, Any] = {}

    if not components:
        # Legacy: no strategy — basic workspace check only
        results["workspace"] = {"status": "ok", "detail": "no health checks configured"}
        return results

    for comp in components:
        if not comp.get("health_check_required", True):
            results[comp.get("name", "?")] = {"status": "skipped"}
            continue

        hc = comp.get("health_check") or {}
        target = comp.get("target", "")
        comp_name = comp.get("name", target)

        # Derive endpoint from Terraform outputs if available
        endpoint = _resolve_endpoint(comp_name, target, deployment_outputs)

        if not endpoint:
            results[comp_name] = {
                "status": "skipped",
                "detail": "No endpoint found in deployment outputs.",
            }
            logger.info(
                "[ADAPTER] verify_skipped | component=%s | reason=no_endpoint",
                comp_name,
            )
            continue

        protocol = hc.get("protocol", "http")
        check_path = hc.get("path", "/")
        port = hc.get("port")
        timeout_total = hc.get("timeout_seconds", _VERIFY_TOTAL)
        expected_status = hc.get("expected_status", 200)

        logger.info(
            "[ADAPTER] verify_start | component=%s | protocol=%s | endpoint=%s",
            comp_name, protocol, endpoint,
        )

        if protocol in ("http", "https"):
            result = _http_health_check(
                endpoint=endpoint,
                path=check_path,
                port=port,
                expected_status=expected_status,
                timeout_total=timeout_total,
            )
        elif protocol == "tcp":
            result = _tcp_health_check(
                host=endpoint,
                port=port or 5432,
                timeout_total=timeout_total,
            )
        else:
            result = {"status": "skipped", "detail": f"Protocol {protocol!r} not checked."}

        results[comp_name] = result

        if result.get("status") == "failed":
            raise RuntimeError(
                f"Health check failed for component '{comp_name}': "
                + result.get("detail", "unknown error")
            )

    return results


# ── Target adapters ───────────────────────────────────────────────────────────

def _deploy_ec2(
    *,
    deployment: Any,
    project: Any,
    account: Any,
    workspace: Path,
    env: Dict[str, str],
    component: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """EC2 adapter — application is deployed via cloud-init / user-data.

    For EC2 targets the Terraform configuration bakes in the application
    startup via user_data, so there is no separate application-level deploy
    step required here.  This adapter just validates the workspace and
    records the instance endpoint from Terraform outputs.
    """
    logger.info("[ADAPTER] ec2_deploy | deployment_id=%s", deployment.id)
    outputs = deployment.deployment_outputs or {}
    instance_ip = (
        outputs.get("instance_public_ip")
        or outputs.get("public_ip")
        or outputs.get("app_public_ip")
        or outputs.get("ec2_public_ip")
    )
    return {
        "outputs": {
            "endpoint": f"http://{instance_ip}" if instance_ip else None,
            "instance_ip": instance_ip,
        }
    }


def _deploy_ecs_fargate(
    *,
    deployment: Any,
    project: Any,
    account: Any,
    workspace: Path,
    env: Dict[str, str],
    component: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """ECS Fargate adapter.

    For ECS the Terraform configuration creates the ECS service.  This adapter
    waits for the service to reach steady state using the AWS CLI, then
    returns the ALB/service endpoint.
    """
    logger.info("[ADAPTER] ecs_fargate_deploy | deployment_id=%s", deployment.id)
    outputs = deployment.deployment_outputs or {}

    cluster = (
        outputs.get("ecs_cluster_name")
        or outputs.get("cluster_name")
        or f"infragenie-{str(deployment.project_id)[:8]}"
    )
    service = (
        outputs.get("ecs_service_name")
        or outputs.get("service_name")
        or f"infragenie-{str(deployment.project_id)[:8]}-service"
    )
    region = deployment.region or env.get("AWS_REGION", "us-east-1")
    alb_dns = (
        outputs.get("alb_dns_name")
        or outputs.get("load_balancer_dns")
        or outputs.get("endpoint")
    )

    # Wait for ECS service stability (max 5 minutes via AWS CLI)
    _wait_ecs_service_stable(cluster, service, region, env)

    return {
        "outputs": {
            "endpoint": f"http://{alb_dns}" if alb_dns else None,
            "alb_dns": alb_dns,
            "ecs_cluster": cluster,
            "ecs_service": service,
        }
    }


def _deploy_s3_cloudfront(
    *,
    deployment: Any,
    project: Any,
    account: Any,
    workspace: Path,
    env: Dict[str, str],
    component: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """S3 + CloudFront adapter.

    1. Locate the static build output (dist/ or build/) in the project workspace.
    2. Sync files to the S3 bucket created by Terraform.
    3. Invalidate the CloudFront distribution cache.
    4. Return the CloudFront URL.
    """
    logger.info("[ADAPTER] s3_cf_deploy | deployment_id=%s", deployment.id)
    outputs = deployment.deployment_outputs or {}

    bucket = outputs.get("s3_bucket_name") or outputs.get("bucket_name")
    cf_id  = outputs.get("cloudfront_distribution_id") or outputs.get("distribution_id")
    cf_url = outputs.get("cloudfront_domain_name") or outputs.get("website_url")
    region = deployment.region or env.get("AWS_REGION", "us-east-1")

    if not bucket:
        logger.warning(
            "[ADAPTER] s3_cf_deploy no bucket output | deployment_id=%s", deployment.id
        )
        return {"outputs": {"endpoint": cf_url}}

    # Find the build artefact
    build_dir = _find_static_build(workspace, project)

    if build_dir and build_dir.exists():
        _sync_to_s3(build_dir=build_dir, bucket=bucket, region=region, env=env)
        if cf_id:
            _invalidate_cloudfront(distribution_id=cf_id, region=region, env=env)

    endpoint = f"https://{cf_url}" if cf_url and not cf_url.startswith("http") else cf_url
    return {
        "outputs": {
            "endpoint": endpoint,
            "cloudfront_url": endpoint,
            "s3_bucket": bucket,
            "cloudfront_distribution_id": cf_id,
        }
    }


def _deploy_rds(
    *,
    deployment: Any,
    project: Any,
    account: Any,
    workspace: Path,
    env: Dict[str, str],
    component: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """RDS adapter — no application-level deploy step required.

    RDS is provisioned entirely by Terraform.  Record the endpoint.
    """
    logger.info("[ADAPTER] rds_deploy | deployment_id=%s", deployment.id)
    outputs = deployment.deployment_outputs or {}
    endpoint = outputs.get("db_endpoint") or outputs.get("rds_endpoint")
    return {"outputs": {"db_endpoint": endpoint}}


def _deploy_ecr(
    *,
    deployment: Any,
    project: Any,
    account: Any,
    workspace: Path,
    env: Dict[str, str],
    component: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """ECR adapter — registry is provisioned by Terraform; no deploy step."""
    logger.info("[ADAPTER] ecr_deploy | deployment_id=%s", deployment.id)
    outputs = deployment.deployment_outputs or {}
    repo_url = outputs.get("ecr_repository_url") or outputs.get("repository_url")
    return {"outputs": {"ecr_repository_url": repo_url}}


# ── Health check helpers ──────────────────────────────────────────────────────

def _http_health_check(
    *,
    endpoint: str,
    path: str,
    port: Optional[int],
    expected_status: int,
    timeout_total: int,
) -> Dict[str, Any]:
    """Probe an HTTP endpoint with retries until timeout_total is exhausted."""
    if port:
        url = f"http://{endpoint}:{port}{path}"
    elif not endpoint.startswith("http"):
        url = f"http://{endpoint}{path}"
    else:
        url = endpoint.rstrip("/") + path

    deadline = time.monotonic() + timeout_total
    attempt = 0
    last_error = ""

    while time.monotonic() < deadline:
        attempt += 1
        try:
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=_HTTP_CHECK_TIMEOUT) as resp:
                status = resp.getcode()
                if status == expected_status:
                    logger.info(
                        "[ADAPTER] http_check_pass | url=%s | attempt=%d | status=%d",
                        url, attempt, status,
                    )
                    return {
                        "status": "passed",
                        "url": url,
                        "http_status": status,
                        "attempts": attempt,
                    }
                last_error = f"HTTP {status} (expected {expected_status})"
        except urllib.error.HTTPError as e:
            if e.code == expected_status:
                return {"status": "passed", "url": url, "http_status": e.code, "attempts": attempt}
            last_error = f"HTTP {e.code}"
        except Exception as exc:
            last_error = str(exc)

        remaining = deadline - time.monotonic()
        if remaining > _VERIFY_INTERVAL:
            time.sleep(_VERIFY_INTERVAL)
        else:
            time.sleep(max(0, remaining))

    logger.warning(
        "[ADAPTER] http_check_fail | url=%s | attempts=%d | last_error=%s",
        url, attempt, last_error,
    )
    return {
        "status": "failed",
        "url": url,
        "attempts": attempt,
        "detail": f"Health check did not pass within {timeout_total}s. Last error: {last_error}",
    }


def _tcp_health_check(
    *,
    host: str,
    port: int,
    timeout_total: int,
) -> Dict[str, Any]:
    """Probe a TCP port with retries until timeout_total is exhausted."""
    import socket
    deadline = time.monotonic() + timeout_total
    attempt = 0
    last_error = ""

    while time.monotonic() < deadline:
        attempt += 1
        try:
            with socket.create_connection((host, port), timeout=_TCP_CHECK_TIMEOUT):
                logger.info(
                    "[ADAPTER] tcp_check_pass | host=%s | port=%d | attempt=%d",
                    host, port, attempt,
                )
                return {"status": "passed", "host": host, "port": port, "attempts": attempt}
        except Exception as exc:
            last_error = str(exc)
        remaining = deadline - time.monotonic()
        if remaining > _VERIFY_INTERVAL:
            time.sleep(_VERIFY_INTERVAL)
        else:
            time.sleep(max(0, remaining))

    return {
        "status": "failed",
        "host": host,
        "port": port,
        "attempts": attempt,
        "detail": f"TCP probe failed within {timeout_total}s. Last error: {last_error}",
    }


# ── ECS wait helper ───────────────────────────────────────────────────────────

def _wait_ecs_service_stable(
    cluster: str,
    service: str,
    region: str,
    env: Dict[str, str],
) -> None:
    """Use the AWS CLI to wait for ECS service stability.

    Timeout: 5 minutes (300 seconds).  Failure is non-fatal — the deployment
    continues and verification will surface the actual service state.
    """
    try:
        result = subprocess.run(
            [
                "aws", "ecs", "wait", "services-stable",
                "--cluster", cluster,
                "--services", service,
                "--region", region,
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=330,
        )
        if result.returncode != 0:
            logger.warning(
                "[ADAPTER] ecs_wait_failed | cluster=%s | service=%s | stderr=%s",
                cluster, service, result.stderr[:500],
            )
    except subprocess.TimeoutExpired:
        logger.warning(
            "[ADAPTER] ecs_wait_timeout | cluster=%s | service=%s", cluster, service
        )
    except FileNotFoundError:
        # AWS CLI not installed — skip the wait
        logger.info("[ADAPTER] ecs_wait_skipped | reason=aws_cli_not_found")


# ── S3 sync helpers ───────────────────────────────────────────────────────────

def _find_static_build(workspace: Path, project: Any) -> Optional[Path]:
    """Locate the static build output directory."""
    from config import settings

    # Check the resolved upload dir for an extracted project
    project_root: Optional[Path] = None
    if project.file_path:
        zf = Path(str(project.file_path))
        if zf.suffix == ".zip":
            # Extracted to the clone dir
            extracted = settings.resolved_clone_dir / zf.stem
            if extracted.exists():
                project_root = extracted

    if project_root is None:
        return None

    # Common static build output directories
    for candidate in ("dist", "build", "out", "public", ".next/static", "_site"):
        p = project_root / candidate
        if p.exists() and p.is_dir():
            return p

    return None


def _sync_to_s3(
    *,
    build_dir: Path,
    bucket: str,
    region: str,
    env: Dict[str, str],
) -> None:
    """Sync static files to S3.  Credentials come from the env dict."""
    cmd = [
        "aws", "s3", "sync",
        str(build_dir),
        f"s3://{bucket}",
        "--delete",
        "--region", region,
    ]
    try:
        result = subprocess.run(
            cmd,
            env=env,
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.returncode != 0:
            raise RuntimeError(f"aws s3 sync failed: {result.stderr[:1000]}")
        logger.info(
            "[ADAPTER] s3_sync_done | bucket=%s | build_dir=%s", bucket, build_dir
        )
    except FileNotFoundError:
        raise RuntimeError(
            "AWS CLI is not installed on the worker. "
            "Install awscli and restart the worker."
        )


def _invalidate_cloudfront(
    *,
    distribution_id: str,
    region: str,
    env: Dict[str, str],
) -> None:
    """Create a CloudFront invalidation for /*."""
    try:
        result = subprocess.run(
            [
                "aws", "cloudfront", "create-invalidation",
                "--distribution-id", distribution_id,
                "--paths", "/*",
                "--region", region,
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            logger.warning(
                "[ADAPTER] cf_invalidate_failed | distribution=%s | stderr=%s",
                distribution_id, result.stderr[:500],
            )
        else:
            logger.info("[ADAPTER] cf_invalidate_done | distribution=%s", distribution_id)
    except FileNotFoundError:
        logger.info("[ADAPTER] cf_invalidate_skipped | reason=aws_cli_not_found")


# ── Endpoint resolver ─────────────────────────────────────────────────────────

def _resolve_endpoint(
    comp_name: str,
    target: str,
    deployment_outputs: Dict[str, Any],
) -> Optional[str]:
    """Find the health-check endpoint for a component from Terraform outputs.

    Checks the component outputs sub-dict first (multi-component), then
    falls back to flat top-level keys for single-component deployments.
    """
    # Multi-component: outputs are nested under component name
    comp_outputs = deployment_outputs.get(comp_name, {})
    if isinstance(comp_outputs, dict):
        for key in ("endpoint", "alb_dns", "cloudfront_url", "public_ip",
                    "instance_public_ip", "db_endpoint"):
            val = comp_outputs.get(key)
            if val:
                return str(val)

    # Single-component / flat outputs
    candidates: Dict[str, list] = {
        "ec2":           ["instance_public_ip", "public_ip", "app_public_ip"],
        "ecs_fargate":   ["alb_dns_name", "load_balancer_dns", "endpoint"],
        "s3_cloudfront": ["cloudfront_domain_name", "website_url", "endpoint"],
        "rds":           ["db_endpoint", "rds_endpoint"],
        "ecr":           [],
    }
    for key in candidates.get(target, []):
        val = deployment_outputs.get(key)
        if val:
            return str(val)

    return None


# ── Topological sort ──────────────────────────────────────────────────────────

def _topo_sort(components: list) -> list:
    """Order components so dependencies come before dependents.

    If there are cycles (which the strategy validator should have caught),
    falls back to original order.
    """
    by_name = {c.get("name"): c for c in components}
    visited: set = set()
    result: list = []

    def visit(name: str) -> None:
        if name in visited:
            return
        visited.add(name)
        comp = by_name.get(name)
        if comp:
            for dep in comp.get("dependencies", []):
                visit(dep)
            result.append(comp)

    for c in components:
        visit(c.get("name"))

    return result
