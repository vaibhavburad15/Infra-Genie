
from __future__ import annotations

import json
import logging
import mimetypes
import re
import shutil
import subprocess
import time
import urllib.request
import urllib.error
from concurrent.futures import Future, ThreadPoolExecutor
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
        "documentdb":    _deploy_documentdb,
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
    """EC2 adapter — the server is configured by Ansible.

    Terraform created the machine; this writes the Ansible inventory and the
    app environment, waits for SSH and runs the built-in `deploy` playbook as
    a recorded AnsibleRun (visible on the Ansible page). Workspaces without an
    Ansible project (legacy / LLM-generated EC2) only record the endpoint.
    """
    from ansible_engine import has_ansible, parse_recap, write_inventory, write_secrets

    logger.info("[ADAPTER] ec2_deploy | deployment_id=%s", deployment.id)
    outputs = deployment.deployment_outputs or {}
    instance_ip = (
        outputs.get("instance_public_ip")
        or outputs.get("public_ip")
        or outputs.get("app_public_ip")
        or outputs.get("ec2_public_ip")
    )
    if has_ansible(workspace):
        if not instance_ip:
            raise RuntimeError("Terraform outputs have no instance_public_ip, so Ansible has no server to configure.")
        from models import AnsibleRun
        from tasks import _get_sync_session, create_ansible_run, execute_ansible_run

        write_inventory(workspace, str(instance_ip))
        write_secrets(workspace, _server_app_env(workspace, outputs))
        _wait_for_ssh(str(instance_ip))
        run_id = create_ansible_run(
            str(deployment.id), "deploy", org_id=deployment.org_id,
            user_id=deployment.approved_by, trigger="deployment",
        )
        if execute_ansible_run(run_id) != 0:
            db = _get_sync_session()
            try:
                run = db.query(AnsibleRun).filter(AnsibleRun.id == run_id).one()
                failed = [line for line in (run.log or "").splitlines()
                          if line.startswith(("fatal:", "failed:", "ERROR!"))]
                recap = parse_recap(run.log or "")
            finally:
                db.close()
            raise RuntimeError(
                "Ansible could not configure the server. "
                + (" | ".join(failed[-3:]) or "See the run log on the Ansible page.")
                + (f" | recap: {recap}" if recap else "")
            )
    return {
        "outputs": {
            "endpoint": f"http://{instance_ip}" if instance_ip else None,
            "instance_ip": instance_ip,
        }
    }


def _server_app_env(workspace: Path, outputs: Dict[str, Any]) -> Dict[str, str]:
    """App environment for a server deployment: connection strings built from
    the RDS / DocumentDB endpoints and the credentials the platform put in
    terraform.tfvars."""
    from terraform_templates import MONGO_ENV_NAMES, MONGO_URI_OPTIONS

    if not (outputs.get("db_endpoint") or outputs.get("mongodb_endpoint")):
        return {}
    tfvars = (workspace / "terraform" / "terraform.tfvars").read_text(encoding="utf-8")
    values = {k: json.loads(v) for k, v in re.findall(r'^(\w+)\s*=\s*(".*")\s*$', tfvars, re.MULTILINE)}
    app_env: Dict[str, str] = {}
    if outputs.get("db_endpoint"):
        main_tf = (workspace / "terraform" / "main.tf").read_text(encoding="utf-8")
        mysql = re.search(r'\bengine\s*=\s*"mysql"', main_tf) is not None
        scheme, port = ("mysql", 3306) if mysql else ("postgresql", 5432)
        app_env["DATABASE_URL"] = (
            f"{scheme}://{values.get('db_username', '')}:{values.get('db_password', '')}"
            f"@{outputs['db_endpoint']}:{port}/{values.get('db_name', '')}"
        )
    if outputs.get("mongodb_endpoint"):
        uri = (
            f"mongodb://{values.get('docdb_username', '')}:{values.get('docdb_password', '')}"
            f"@{outputs['mongodb_endpoint']}:27017/{values.get('docdb_name', '')}?{MONGO_URI_OPTIONS}"
        )
        app_env.update({name: uri for name in MONGO_ENV_NAMES})
    return app_env


def _wait_for_ssh(host: str, timeout: int = 300) -> None:
    """Wait until the new server accepts TCP connections on port 22."""
    import socket

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, 22), timeout=5):
                return
        except OSError:
            time.sleep(5)
    raise RuntimeError(
        f"The server {host} did not accept SSH within {timeout}s. If the worker's public IP "
        "changed since the plan was created, re-run the plan to update the SSH rule."
    )


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

    Terraform creates the ECR repository and the ECS service, whose task
    definition points at `<repository_url>:latest`. This adapter builds the
    application image from the project source, pushes it to that repository,
    rolls the service onto it and waits until the service is stable.
    """
    logger.info("[ADAPTER] ecs_fargate_deploy | deployment_id=%s", deployment.id)
    outputs = deployment.deployment_outputs or {}

    cluster = outputs.get("ecs_cluster_name") or outputs.get("cluster_name")
    service = outputs.get("ecs_service_name") or outputs.get("service_name")
    repository_url = outputs.get("ecr_repository_url") or outputs.get("repository_url")
    if not (cluster and service and repository_url):
        raise RuntimeError(
            "Terraform outputs are missing ecs_cluster_name, ecs_service_name or "
            "ecr_repository_url, so the application image cannot be deployed. "
            f"Outputs present: {sorted(outputs)}"
        )
    region = deployment.region or env.get("AWS_REGION", "us-east-1")
    alb_dns = (
        outputs.get("alb_dns_name")
        or outputs.get("load_balancer_dns")
        or outputs.get("endpoint")
    )

    # The image is normally built while Terraform applies (see
    # start_artifact_prebuild); build it now only if that did not happen.
    prebuild = _PREBUILDS.pop(str(deployment.id), None)
    local_ref = (
        prebuild.result(timeout=_BUILD_TIMEOUT) if prebuild
        else _build_image(_build_inputs(deployment, project, workspace))
    )
    _push_image(
        local_ref=local_ref,
        repository_url=repository_url,
        tags=["latest", str(deployment.id).replace("-", "")[:12]],
        region=region,
        env=env,
    )
    _roll_ecs_service(cluster, service, region, env)

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
        raise RuntimeError(
            "Terraform outputs are missing s3_bucket_name, so the site cannot be uploaded. "
            f"Outputs present: {sorted(outputs)}"
        )

    # Frontend-only sites are built while Terraform applies (see
    # start_artifact_prebuild). With a backend, the build has to wait for the
    # backend's public URL, which only exists after apply.
    prebuild = _PREBUILDS.pop(str(deployment.id), None)
    if prebuild:
        build_dir = Path(prebuild.result(timeout=_BUILD_TIMEOUT))
    else:
        inputs = _build_inputs(deployment, project, workspace)
        if outputs.get("api_url"):
            inputs["build_env"] = {name: str(outputs["api_url"]) for name in _API_URL_ENV_NAMES}
        build_dir = Path(_build_static_site(inputs))
    uploaded = _upload_static_site(build_dir, bucket, region, env)
    if cf_id:
        _boto3_session(env, region).client("cloudfront").create_invalidation(
            DistributionId=cf_id,
            InvalidationBatch={"Paths": {"Quantity": 1, "Items": ["/*"]},
                               "CallerReference": f"{deployment.id}-{int(time.time())}"},
        )
    logger.info("[ADAPTER] s3_cf_deploy_done | bucket=%s | files=%d", bucket, uploaded)

    endpoint = outputs.get("frontend_url") or (
        f"https://{cf_url}" if cf_url and not cf_url.startswith("http") else cf_url
    )
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


def _deploy_documentdb(
    *,
    deployment: Any,
    project: Any,
    account: Any,
    workspace: Path,
    env: Dict[str, str],
    component: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """DocumentDB adapter — provisioned entirely by Terraform; record the endpoint."""
    logger.info("[ADAPTER] documentdb_deploy | deployment_id=%s", deployment.id)
    outputs = deployment.deployment_outputs or {}
    return {"outputs": {"mongodb_endpoint": outputs.get("mongodb_endpoint")}}


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

# ── Container image helpers ───────────────────────────────────────────────────

_PYTHON_TECH = ("fastapi", "flask", "django", "python")
_NODE_TECH = ("express", "next", "nest", "node", "react", "vue", "typescript", "javascript")
_SKIP_DIRS = {"node_modules", ".git", "venv", ".venv", "__pycache__", "dist", "build"}


def _boto3_session(env: Dict[str, str], region: str):
    import boto3
    return boto3.Session(
        aws_access_key_id=env.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=env.get("AWS_SECRET_ACCESS_KEY"),
        aws_session_token=env.get("AWS_SESSION_TOKEN") or None,
        region_name=region,
    )


def _project_source_dir(source: str) -> Path:
    """Fresh copy of the project source (git URL re-cloned, zip re-extracted)."""
    from tasks import clone_repo, _extract_zip

    if source.startswith(("http://", "https://", "git@", "ssh://")):
        return clone_repo(source)
    if source.endswith(".zip"):
        return _extract_zip(Path(source))
    raise RuntimeError(f"Project source '{source}' cannot be built into a container image.")


def _select_dockerfile(source_dir: Path, apps: list, workspace: Path) -> tuple[Path, Path]:
    """Pick the repository Dockerfile that matches the primary application.

    Repositories often keep one Dockerfile per service (backend/, frontend/).
    Score each by whether its directory holds the manifest for the detected
    stack and by conventional directory names. Falls back to the generated
    workspace Dockerfile built from the repository root.
    """
    primary = next((a for a in apps if isinstance(a, dict)), {}) or {}
    tech = f"{primary.get('tech', '')} {primary.get('name', '')}".lower()
    app_type = str(primary.get("type") or "").lower()
    wants_python = any(t in tech for t in _PYTHON_TECH)
    wants_node = not wants_python and any(t in tech for t in _NODE_TECH)

    candidates = []
    for dockerfile in source_dir.rglob("Dockerfile"):
        rel = dockerfile.relative_to(source_dir)
        if len(rel.parts) > 4 or any(part in _SKIP_DIRS for part in rel.parts):
            continue
        folder = dockerfile.parent
        folder_name = folder.name.lower() if folder != source_dir else ""
        score = 1 if folder == source_dir else 0
        if wants_python and any((folder / m).exists() for m in ("requirements.txt", "pyproject.toml")):
            score += 3
        if wants_node and (folder / "package.json").exists():
            score += 3
        if app_type in ("backend", "worker") and folder_name in ("backend", "api", "server"):
            score += 2
        if app_type in ("frontend", "static") and folder_name in ("frontend", "web", "client"):
            score += 2
        candidates.append((score, -len(rel.parts), dockerfile))

    if candidates:
        dockerfile = max(candidates, key=lambda c: (c[0], c[1]))[2]
        logger.info("[ADAPTER] dockerfile_selected | path=%s", dockerfile.relative_to(source_dir))
        return dockerfile, dockerfile.parent

    port = int(primary.get("port") or (8000 if wants_python else 3000))
    synthesized = _synthesize_dockerfile(source_dir, wants_python, wants_node, app_type, port)
    if synthesized:
        target = workspace / "docker" / "Dockerfile.synthesized"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(synthesized, encoding="utf-8")
        logger.info("[ADAPTER] dockerfile_selected | path=<synthesized from repository layout>")
        return target, source_dir

    generated = workspace / "docker" / "Dockerfile"
    if generated.exists():
        logger.info("[ADAPTER] dockerfile_selected | path=<generated workspace Dockerfile>")
        return generated, source_dir
    raise RuntimeError(
        "No Dockerfile found in the repository and none was generated, so the "
        "application image cannot be built."
    )


def _repo_files(source_dir: Path, pattern: str):
    for path in source_dir.rglob(pattern):
        rel = path.relative_to(source_dir)
        if len(rel.parts) <= 4 and not any(part in _SKIP_DIRS for part in rel.parts):
            yield path


def _synthesize_dockerfile(
    source_dir: Path, wants_python: bool, wants_node: bool, app_type: str, port: int,
) -> Optional[str]:
    """Write a Dockerfile from the repository layout for common stacks.

    Deterministic and built from the repository root as context, so paths
    are relative to it. Returns None when the layout is not recognized.
    """
    if wants_python:
        apps = []
        for py in _repo_files(source_dir, "*.py"):
            try:
                text = py.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            match = re.search(r"^(\w+)\s*=\s*(FastAPI|Flask)\(", text, re.MULTILINE)
            if match:
                apps.append((len(py.relative_to(source_dir).parts), py, match.group(1), match.group(2)))
        if not apps:
            return None
        _, app_file, variable, framework = min(apps, key=lambda a: a[0])
        app_dir = app_file.parent.relative_to(source_dir).as_posix()
        requirements = next(
            (p for p in (app_file.parent / "requirements.txt", source_dir / "requirements.txt") if p.exists()),
            None,
        )
        install = (
            f"RUN pip install --no-cache-dir -r /app/{requirements.relative_to(source_dir).as_posix()}"
            if requirements else "RUN pip install --no-cache-dir fastapi uvicorn"
        )
        server = "uvicorn" if framework == "FastAPI" else "gunicorn"
        command = (
            f'["uvicorn", "{app_file.stem}:{variable}", "--host", "0.0.0.0", "--port", "{port}"]'
            if server == "uvicorn"
            else f'["gunicorn", "-b", "0.0.0.0:{port}", "{app_file.stem}:{variable}"]'
        )
        return (
            "FROM python:3.11-slim\n"
            "ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1\n"
            "WORKDIR /app\n"
            "COPY . /app\n"
            f"{install}\n"
            f"RUN pip install --no-cache-dir {server}\n"
            f"WORKDIR /app/{app_dir}\n"
            f"ENV PORT={port}\n"
            f"EXPOSE {port}\n"
            f"CMD {command}\n"
        ).replace("WORKDIR /app/.\n", "WORKDIR /app\n")

    if wants_node:
        preferred = ("backend", "api", "server") if app_type in ("backend", "worker") else ("frontend", "web", "client")
        manifests = []
        for manifest in _repo_files(source_dir, "package.json"):
            try:
                scripts = json.loads(manifest.read_text(encoding="utf-8")).get("scripts") or {}
            except (OSError, ValueError):
                continue
            if "start" not in scripts:
                continue
            bonus = 0 if manifest.parent.name.lower() in preferred else 1
            manifests.append((bonus, len(manifest.relative_to(source_dir).parts), manifest))
        if not manifests:
            return None
        manifest = min(manifests)[2]
        app_dir = manifest.parent.relative_to(source_dir).as_posix()
        return (
            "FROM node:20-slim\n"
            "WORKDIR /app\n"
            "COPY . /app\n"
            f"WORKDIR /app/{app_dir}\n"
            "RUN npm ci --omit=dev || npm install --omit=dev\n"
            f"ENV PORT={port} NODE_ENV=production\n"
            f"EXPOSE {port}\n"
            'CMD ["npm", "start"]\n'
        ).replace("WORKDIR /app/.\n", "WORKDIR /app\n")
    return None


def _run(cmd: list, *, timeout: int, input_text: Optional[str] = None, what: str) -> str:
    try:
        result = subprocess.run(
            cmd, input=input_text, capture_output=True, text=True,
            timeout=timeout, check=False,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"{cmd[0]} is not installed on the worker ({what}).") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"{what} timed out after {timeout}s.") from exc
    if result.returncode != 0:
        tail = (result.stderr or result.stdout or "").strip()[-2000:]
        raise RuntimeError(f"{what} failed: {tail}")
    return result.stdout


_BUILD_TIMEOUT = 1800
_BUILD_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="image-build")
_PREBUILDS: Dict[str, "Future[str]"] = {}


def _build_inputs(deployment: Any, project: Any, workspace: Path) -> Dict[str, Any]:
    """Plain values needed to build the image, read on the calling thread
    (ORM objects must not be touched from the build thread)."""
    return {
        "deployment_id": str(deployment.id),
        "source": str(project.file_path or project.github_url or ""),
        "apps": list((deployment.artifacts or {}).get("discovered_apps") or []),
        "workspace": workspace,
    }


def _build_image(inputs: Dict[str, Any]) -> str:
    """Fetch the source, pick/synthesize a Dockerfile and build a local image."""
    source_dir = _project_source_dir(inputs["source"])
    dockerfile, context_dir = _select_dockerfile(source_dir, inputs["apps"], inputs["workspace"])
    local_ref = f"infragenie-build:{inputs['deployment_id'].replace('-', '')[:12]}"
    logger.info("[ADAPTER] image_build_start | ref=%s", local_ref)
    _run(["docker", "build", "--platform", "linux/amd64", "-f", str(dockerfile),
          "-t", local_ref, str(context_dir)], timeout=_BUILD_TIMEOUT, what="docker build")
    logger.info("[ADAPTER] image_build_done | ref=%s", local_ref)
    return local_ref


def start_artifact_prebuild(deployment: Any, project: Any, workspace: Path) -> None:
    """Build the deployable artifact in the background so it runs in parallel
    with `terraform apply` (minutes for ALB/RDS/CloudFront): a container image
    for ECS, the static site for S3 + CloudFront."""
    targets = {
        str(c.get("target")) for c in (deployment.strategy_json or {}).get("components") or []
        if isinstance(c, dict)
    }
    if "ecs_fargate" in targets:
        build = _build_image  # a frontend, if any, is built after apply (needs the API URL)
    elif "s3_cloudfront" in targets:
        build = _build_static_site
    else:
        return
    _PREBUILDS[str(deployment.id)] = _BUILD_POOL.submit(
        build, _build_inputs(deployment, project, workspace)
    )


def discard_image_prebuild(deployment_id: Any) -> None:
    _PREBUILDS.pop(str(deployment_id), None)


# Env names frontends commonly read the backend URL from at build time.
_API_URL_ENV_NAMES = (
    "VITE_API_URL", "VITE_API_BASE_URL", "VITE_BACKEND_URL",
    "REACT_APP_API_URL", "REACT_APP_BACKEND_URL",
    "NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_BACKEND_URL",
)

_STATIC_BUILD_DOCKERFILE = """FROM node:20-slim AS build
WORKDIR /app
COPY . .
{env}RUN (npm ci || npm install) && npm run build
RUN mkdir /site && for d in dist build out; do \
      if [ -f "$d/index.html" ]; then cp -r "$d"/. /site/; break; fi; \
    done && test -f /site/index.html
FROM scratch
COPY --from=build /site /
"""


def _frontend_dir(source_dir: Path) -> Path:
    """Directory of the package.json with a build script, preferring the
    conventional frontend folders, then the shallowest one."""
    candidates = []
    for manifest in _repo_files(source_dir, "package.json"):
        try:
            scripts = json.loads(manifest.read_text(encoding="utf-8")).get("scripts") or {}
        except (OSError, ValueError):
            continue
        if "build" in scripts:
            preferred = manifest.parent.name.lower() in ("frontend", "web", "client", "app")
            candidates.append((0 if preferred else 1, len(manifest.relative_to(source_dir).parts), manifest.parent))
    if not candidates:
        raise RuntimeError("No package.json with a \"build\" script was found, so the site cannot be built.")
    return min(candidates)[2]


def _build_static_site(inputs: Dict[str, Any]) -> str:
    """Build the site in a throwaway node container and export only its
    output folder (dist/, build/ or out/) to the workspace."""
    source_dir = _project_source_dir(inputs["source"])
    app_dir = _frontend_dir(source_dir)
    workspace: Path = inputs["workspace"]
    dockerfile = workspace / "docker" / "Dockerfile.static"
    dockerfile.parent.mkdir(parents=True, exist_ok=True)
    # Only set variables we were given: an empty value would override the
    # app's own .env defaults.
    env_lines = "".join(
        f"ENV {name}={json.dumps(value)}\n" for name, value in (inputs.get("build_env") or {}).items()
    )
    dockerfile.write_text(_STATIC_BUILD_DOCKERFILE.format(env=env_lines), encoding="utf-8")
    output = workspace / "site"
    shutil.rmtree(output, ignore_errors=True)
    logger.info("[ADAPTER] static_build_start | app_dir=%s", app_dir.relative_to(source_dir))
    _run(["docker", "build", "-f", str(dockerfile), "--output", f"type=local,dest={output}", str(app_dir)],
         timeout=_BUILD_TIMEOUT, what="static site build (npm run build)")
    if not (output / "index.html").exists():
        raise RuntimeError("The build finished but produced no index.html.")
    return str(output)


def _upload_static_site(build_dir: Path, bucket: str, region: str, env: Dict[str, str]) -> int:
    """Upload every file with its content type. index.html is never cached so
    new deploys show up immediately; fingerprinted assets are cached long."""
    s3 = _boto3_session(env, region).client("s3")
    count = 0
    for path in build_dir.rglob("*"):
        if not path.is_file():
            continue
        key = path.relative_to(build_dir).as_posix()
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if key.endswith(".html"):
            cache = "no-cache"
        elif key.startswith(("assets/", "static/", "_next/")):
            cache = "public, max-age=31536000, immutable"
        else:
            cache = "public, max-age=300"
        s3.upload_file(str(path), bucket, key,
                       ExtraArgs={"ContentType": content_type, "CacheControl": cache})
        count += 1
    return count


def _push_image(
    *,
    local_ref: str,
    repository_url: str,
    tags: list,
    region: str,
    env: Dict[str, str],
) -> None:
    import base64

    registry = repository_url.split("/", 1)[0]
    image_refs = [f"{repository_url}:{tag}" for tag in tags]
    for ref in image_refs:
        _run(["docker", "tag", local_ref, ref], timeout=60, what="docker tag")

    token = _boto3_session(env, region).client("ecr").get_authorization_token()
    username, password = base64.b64decode(
        token["authorizationData"][0]["authorizationToken"]
    ).decode().split(":", 1)
    _run(["docker", "login", "--username", username, "--password-stdin", registry],
         timeout=120, input_text=password, what="docker login to ECR")
    try:
        for ref in image_refs:
            logger.info("[ADAPTER] image_push | ref=%s", ref)
            _run(["docker", "push", ref], timeout=1800, what=f"docker push {ref}")
    finally:
        subprocess.run(["docker", "logout", registry], capture_output=True, check=False)


def _roll_ecs_service(cluster: str, service: str, region: str, env: Dict[str, str]) -> None:
    """Start a new deployment of the pushed image and wait for stability.

    On failure, raise with the service events and stopped-task reasons so the
    user sees why tasks did not start (image, health check, crash, ...).
    """
    from botocore.exceptions import WaiterError

    ecs = _boto3_session(env, region).client("ecs")
    current = ecs.describe_services(cluster=cluster, services=[service])["services"][0]
    # Services are created with desired_count = 0 until an image exists.
    ecs.update_service(
        cluster=cluster, service=service, forceNewDeployment=True,
        desiredCount=max(int(current.get("desiredCount") or 0), 1),
    )
    logger.info("[ADAPTER] ecs_rollout_started | cluster=%s | service=%s", cluster, service)
    try:
        ecs.get_waiter("services_stable").wait(
            cluster=cluster, services=[service],
            WaiterConfig={"Delay": 10, "MaxAttempts": 72},  # up to 12 minutes
        )
    except WaiterError as exc:
        details = []
        try:
            svc = ecs.describe_services(cluster=cluster, services=[service])["services"][0]
            details.append(
                f"running={svc.get('runningCount')} desired={svc.get('desiredCount')}"
            )
            details += [e["message"] for e in svc.get("events", [])[:5]]
            stopped = ecs.list_tasks(cluster=cluster, serviceName=service,
                                     desiredStatus="STOPPED").get("taskArns", [])[:3]
            if stopped:
                for task in ecs.describe_tasks(cluster=cluster, tasks=stopped)["tasks"]:
                    reasons = [task.get("stoppedReason", "")] + [
                        f"{c.get('name')}: {c.get('reason') or 'exit ' + str(c.get('exitCode'))}"
                        for c in task.get("containers", [])
                    ]
                    details.append("stopped task: " + "; ".join(r for r in reasons if r))
        except Exception as diag_exc:  # diagnostics are best-effort
            details.append(f"(could not read service diagnostics: {diag_exc})")
        raise RuntimeError(
            f"ECS service {service} did not become stable: {exc}. " + " | ".join(details)
        ) from exc
    logger.info("[ADAPTER] ecs_rollout_stable | cluster=%s | service=%s", cluster, service)


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
        "documentdb":    ["mongodb_endpoint"],
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
