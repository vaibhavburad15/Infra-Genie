"""Terraform workspace generation and reviewed-plan execution helpers.

LLM-generated Terraform is treated as input data. The worker writes it into a
deployment-specific workspace, rejects constructs that can execute arbitrary
commands or load non-AWS providers, then lets Terraform produce the resource
actions shown to the user before any apply is possible.

Security invariants
───────────────────
• AWS credentials (access key, secret key, session token) are NEVER logged,
  stored in the workspace, or returned in any API response.
• The deployment workspace is strictly scoped under settings.resolved_artifact_dir.
  Path traversal is prevented by verifying the resolved path is a child of the
  base directory.
• Subprocess calls use argument arrays (never shell=True or string concatenation).
• Terraform init runs with -backend=false so no remote state is configured or
  modified during the planning phase.
• terraform apply is NOT called anywhere in the planning workflow.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

from config import settings

logger = logging.getLogger(__name__)


class TerraformError(RuntimeError):
    """Raised for all Terraform / workspace errors.

    ``error_kind`` is a machine-readable category so callers can map to useful
    frontend messages without parsing the raw error text.

    Valid error_kind values:
        missing_binary      — terraform CLI not on PATH
        path_traversal      — deployment ID tried to escape the artifact dir
        invalid_artifact    — LLM-generated Terraform failed safety validation
        init_failed         — terraform init returned non-zero
        validate_failed     — terraform validate returned non-zero
        plan_failed         — terraform plan returned non-zero
        show_failed         — terraform show failed to produce usable JSON
        fmt_failed          — terraform fmt returned non-zero
        assume_role_failed  — STS AssumeRole failed
        workspace_error     — general workspace / filesystem error
        timeout             — terraform command exceeded its timeout
        unknown             — unexpected error
    """

    def __init__(self, message: str, error_kind: str = "unknown") -> None:
        super().__init__(message)
        self.error_kind = error_kind


@dataclass
class TerraformPlanResult:
    workspace: Path
    summary: dict[str, Any]
    display: str
    fingerprint: str


def deployment_workspace(deployment_id: str | UUID) -> Path:
    """Return a deployment workspace whose resolved path stays under artifacts.

    Raises TerraformError(error_kind='path_traversal') if the resolved path
    escapes the artifact directory — prevents directory traversal attacks.
    """
    try:
        safe_id = str(UUID(str(deployment_id)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise TerraformError("Invalid deployment identifier", error_kind="path_traversal") from exc
    root = (settings.resolved_artifact_dir / "deployments").resolve()
    target = (root / safe_id).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise TerraformError(
            "Deployment workspace escaped the artifact directory",
            error_kind="path_traversal",
        ) from exc
    return target


def _artifact_text(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"^```(?:hcl|terraform)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _validate_generated_terraform(source: str) -> None:
    if not source or source.startswith("[Unavailable"):
        raise TerraformError(
            "The project has no usable Terraform artifact. Re-run project analysis.",
            error_kind="invalid_artifact",
        )
    unsafe_patterns = (
        (r"\bprovisioner\s+\"", "Terraform provisioners are not allowed in generated artifacts."),
        (r"\bdata\s+\"external\"", "External data sources are not allowed in generated artifacts."),
        (r"\bresource\s+\"local_file\"", "Local file resources are not allowed in generated artifacts."),
        (r"\bmodule\s+\"", "Terraform modules must be reviewed and added explicitly."),
        (r"\bbackend\s+\"", "Custom Terraform backends are not allowed for generated workspaces."),
        (r"\b(?:endpoints|assume_role)\s*\{", "Custom AWS provider endpoints and role chaining are not allowed."),
        (r"\b(?:access_key|secret_key|token|profile|shared_credentials_files?|shared_config_files?|custom_ca_bundle|http_proxy|https_proxy|skip_credentials_validation|skip_metadata_api_check|skip_requesting_account_id)\s*=", "Generated Terraform cannot override the worker's temporary AWS credentials or provider settings."),
        (r"\b(?:file|filebase64|templatefile|fileset)\s*\(", "Terraform functions that read worker-local files are not allowed."),
    )
    for pattern, message in unsafe_patterns:
        if re.search(pattern, source, re.IGNORECASE):
            raise TerraformError(message, error_kind="invalid_artifact")
    providers = re.findall(r"\bprovider\s+\"([^\"]+)\"", source)
    unsupported = sorted({name for name in providers if name != "aws"})
    if unsupported:
        raise TerraformError(
            "Only the AWS Terraform provider is allowed in generated artifacts.",
            error_kind="invalid_artifact",
        )
    resource_types = re.findall(r'\b(?:resource|data)\s+"([^"]+)"', source)
    unsupported_types = sorted({name for name in resource_types if not name.startswith("aws_")})
    if unsupported_types:
        raise TerraformError(
            "Only AWS resources and data sources are allowed in generated artifacts.",
            error_kind="invalid_artifact",
        )
    provider_sources = re.findall(r'\bsource\s*=\s*"([^"]+)"', source)
    if any(name != "hashicorp/aws" for name in provider_sources):
        raise TerraformError(
            "Generated Terraform may only install the official hashicorp/aws provider.",
            error_kind="invalid_artifact",
        )


def _force_aws_region(source: str, region: str) -> str:
    """Pin the generated AWS provider to the connected account's selected region."""
    provider_matches = list(re.finditer(r'provider\s+"aws"\s*\{', source, re.IGNORECASE))
    if not provider_matches:
        return f'provider "aws" {{\n  region = "{region}"\n}}\n\n' + source
    if len(provider_matches) > 1:
        raise TerraformError(
            "Use one AWS provider configuration per deployment workspace.",
            error_kind="invalid_artifact",
        )

    opening = provider_matches[0].end() - 1
    depth = 0
    closing = None
    for index in range(opening, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                closing = index
                break
    if closing is None:
        raise TerraformError(
            "The generated AWS provider block is incomplete.",
            error_kind="invalid_artifact",
        )
    body = source[opening + 1:closing]
    if re.search(r"\balias\s*=", body):
        raise TerraformError(
            "Provider aliases are not allowed in generated Terraform.",
            error_kind="invalid_artifact",
        )
    if re.search(r"\bregion\s*=", body):
        body = re.sub(
            r"\bregion\s*=\s*[^\r\n}]+",
            f'region = "{region}" ',
            body,
            count=1,
        )
    else:
        body = f'\n  region = "{region}"' + body
    return source[:opening + 1] + body + source[closing:]


def _dockerfile_from_artifact(value: Any) -> str | None:
    text = str(value or "")
    match = re.search(
        r"===\s*Dockerfile\s*===\s*(.*?)(?=\n\s*===\s*[^=]+\s*===|\Z)",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return None
    content = re.sub(r"^```(?:dockerfile|docker)?\s*", "", match.group(1).strip(), flags=re.IGNORECASE)
    return re.sub(r"\s*```$", "", content).strip() or None


def _terraform_variable_values(source: str, project_name: str, region: str,
                              discovery: dict[str, Any]) -> dict[str, Any]:
    project_slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", project_name).strip("-").lower() or "app"
    subnets = discovery.get("subnets") or []
    public_subnets = [s for s in subnets if s.get("map_public_ip_on_launch")]
    selected_subnets = public_subnets or subnets
    selected_vpcs = discovery.get("vpcs") or []
    default_vpc = next((v for v in selected_vpcs if v.get("is_default")), None)
    defaults: dict[str, Any] = {
        "region": region,
        "aws_region": region,
        "project": project_slug,
        "project_name": project_slug,
        "app_name": project_slug,
        "name": project_slug,
        "instance_type": "t3.micro",
        "ec2_instance_type": "t3.micro",
        "instance_count": 1,
        "desired_count": 1,
        "min_size": 1,
        "max_size": 1,
        "vpc_id": (default_vpc or (selected_vpcs[0] if selected_vpcs else {})).get("vpc_id"),
        "subnet_id": (selected_subnets[0] if selected_subnets else {}).get("subnet_id"),
        "subnet_ids": [s.get("subnet_id") for s in selected_subnets[:2] if s.get("subnet_id")],
        "public_subnet_ids": [s.get("subnet_id") for s in selected_subnets[:2] if s.get("subnet_id")],
        "availability_zone": (selected_subnets[0] if selected_subnets else {}).get("availability_zone"),
    }
    values: dict[str, Any] = {}
    for match in re.finditer(r'\bvariable\s+"([^"]+)"\s*\{(.*?)\n\}', source, re.DOTALL):
        name, body = match.group(1), match.group(2)
        if re.search(r"\bdefault\s*=", body):
            continue
        if name in defaults and defaults[name] is not None:
            values[name] = defaults[name]
    return values


def generate_workspace(
    *,
    deployment_id: str | UUID,
    project_name: str,
    artifacts: dict[str, Any],
    account_id: str,
    region: str,
    discovery_ran_at: str | None,
    discovery_result: dict[str, Any],
) -> Path:
    workspace = deployment_workspace(deployment_id)
    terraform_dir = workspace / "terraform"
    docker_dir = workspace / "docker"
    terraform_dir.mkdir(parents=True, exist_ok=True)
    docker_dir.mkdir(parents=True, exist_ok=True)

    logger.info(
        "[DEPLOYMENT] workspace_created | deployment_id=%s | workspace=%s",
        deployment_id, workspace,
    )

    terraform_source = _artifact_text(artifacts.get("terraform"))
    _validate_generated_terraform(terraform_source)
    terraform_source = _force_aws_region(terraform_source, region)
    other_regions = {
        value for value in re.findall(r'\bregion\s*=\s*"([^"]+)"', terraform_source)
        if value != region
    }
    if other_regions:
        raise TerraformError(
            "Generated Terraform targets a region other than the connected account's selected region.",
            error_kind="invalid_artifact",
        )

    (terraform_dir / "main.tf").write_text(terraform_source + "\n", encoding="utf-8")
    (terraform_dir / "variables.tf").write_text(
        "# Add reviewed Terraform input variables here.\n", encoding="utf-8"
    )
    (terraform_dir / "outputs.tf").write_text(
        "# Terraform outputs are captured after an approved apply.\n", encoding="utf-8"
    )
    terraform_variables = _terraform_variable_values(
        terraform_source, project_name, region, discovery_result
    )
    tfvars_lines = [
        f"{name} = {json.dumps(value)}" for name, value in sorted(terraform_variables.items())
    ]
    (terraform_dir / "terraform.tfvars").write_text(
        "# Values inferred from project analysis and the selected AWS discovery snapshot.\n"
        + ("\n".join(tfvars_lines) + "\n" if tfvars_lines else ""),
        encoding="utf-8",
    )

    dockerfile = _dockerfile_from_artifact(artifacts.get("docker"))
    if dockerfile:
        (docker_dir / "Dockerfile").write_text(dockerfile + "\n", encoding="utf-8")

    plan_document = {
        "deployment_id": str(deployment_id),
        "provider": "aws",
        "account_id": account_id,
        "region": region,
        "project": project_name,
        "discovery_ran_at": discovery_ran_at,
        "discovery_summary": discovery_result.get("summary", {}),
        "discovered_vpc_ids": [v.get("vpc_id") for v in discovery_result.get("vpcs", []) if v.get("vpc_id")],
        "discovered_subnet_ids": [s.get("subnet_id") for s in discovery_result.get("subnets", []) if s.get("subnet_id")],
        "resources": [],
        "artifacts": {
            "terraform": True,
            "docker": bool(dockerfile),
            "kubernetes": bool(artifacts.get("kubernetes")),
        },
    }
    (workspace / "deployment-plan.json").write_text(
        json.dumps(plan_document, indent=2), encoding="utf-8"
    )
    logger.info(
        "[DEPLOYMENT] workspace_populated | deployment_id=%s | terraform_dir=%s | "
        "has_docker=%s | tfvars_count=%d",
        deployment_id, terraform_dir, bool(dockerfile), len(terraform_variables),
    )
    return workspace


def _terraform_command(args: list[str], cwd: Path, env: dict[str, str], timeout: int) -> str:
    """Run a terraform sub-command and return its combined stdout+stderr.

    Security notes:
    - Uses an argument array (never shell=True) — no shell injection possible.
    - The env dict must be built by assume_role_environment() which strips any
      credential keys from the output before logging.
    - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN are present
      in env only for the subprocess; they are never logged here.
    """
    executable = shutil.which("terraform")
    if not executable:
        raise TerraformError(
            "Terraform CLI is not installed or is not available on the worker PATH.",
            error_kind="missing_binary",
        )
    cmd_label = f"terraform {' '.join(args[:2])}"
    logger.info("[TERRAFORM] running | cmd=%s | cwd=%s", cmd_label, cwd)
    try:
        result = subprocess.run(
            [executable, *args],
            cwd=str(cwd),
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        logger.error("[TERRAFORM] timeout | cmd=%s | timeout_seconds=%d", cmd_label, timeout)
        raise TerraformError(
            f"Terraform command timed out after {timeout}s: {cmd_label}",
            error_kind="timeout",
        ) from exc
    except OSError as exc:
        logger.error("[TERRAFORM] os_error | cmd=%s | error=%s", cmd_label, exc)
        raise TerraformError(
            f"Could not start Terraform: {exc}",
            error_kind="missing_binary",
        ) from exc
    output = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
    if result.returncode:
        # Determine error kind from the sub-command
        sub_cmd = args[0] if args else ""
        kind_map = {
            "init": "init_failed",
            "validate": "validate_failed",
            "plan": "plan_failed",
            "show": "show_failed",
            "fmt": "fmt_failed",
        }
        error_kind = kind_map.get(sub_cmd, "unknown")
        logger.error(
            "[TERRAFORM] failed | cmd=%s | exit_code=%d | error_kind=%s",
            cmd_label, result.returncode, error_kind,
        )
        raise TerraformError(
            output[-12000:] or f"{cmd_label} failed (exit {result.returncode})",
            error_kind=error_kind,
        )
    logger.info("[TERRAFORM] success | cmd=%s", cmd_label)
    return output


def assume_role_environment(cloud_account: Any) -> dict[str, str]:
    """Obtain temporary AWS credentials via STS AssumeRole and return a safe
    subprocess environment dict.

    The returned dict includes AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and
    AWS_SESSION_TOKEN but these values are NEVER logged. Only masked prefixes
    are written to logs via the AWSSTSService layer.
    """
    if not cloud_account.role_arn:
        raise TerraformError(
            "The connected AWS account has no role ARN.",
            error_kind="assume_role_failed",
        )
    logger.info(
        "[DEPLOYMENT] assume_role | account_id=%s | region=%s",
        cloud_account.account_id, cloud_account.region,
    )
    from aws_connection import AWSSTSService

    sts = AWSSTSService()
    try:
        session = sts.assume_role(
            role_arn=cloud_account.role_arn,
            external_id=cloud_account.external_id,
            session_name="InfraGenieTerraform",
            duration_seconds=3600,
        )
        identity = sts.get_caller_identity(session)
    except Exception as exc:
        raise TerraformError(
            f"AWS role assumption failed: {exc}",
            error_kind="assume_role_failed",
        ) from exc

    if identity.get("Account") != cloud_account.account_id:
        raise TerraformError(
            "Assumed AWS role identity does not match the connected account.",
            error_kind="assume_role_failed",
        )
    credentials = session.get_credentials().get_frozen_credentials()
    env = os.environ.copy()
    # Pass credentials to subprocess ONLY. They are never returned to callers
    # or written to any log statement in this function.
    env.update({
        "AWS_ACCESS_KEY_ID": credentials.access_key,
        "AWS_SECRET_ACCESS_KEY": credentials.secret_key,
        "AWS_SESSION_TOKEN": credentials.token or "",
        "AWS_REGION": cloud_account.region,
        "AWS_DEFAULT_REGION": cloud_account.region,
        "AWS_EC2_METADATA_DISABLED": "true",
    })
    logger.info(
        "[DEPLOYMENT] assume_role_success | account_id=%s",
        cloud_account.account_id,
    )
    return env


@dataclass
class TerraformPlanResult:
    workspace: Path
    summary: dict[str, Any]
    display: str
    fingerprint: str
    plan_created_at: datetime   # UTC timestamp when terraform plan completed


def run_terraform_plan(workspace: Path, env: dict[str, str]) -> TerraformPlanResult:
    """Run the full Terraform planning pipeline:
        1. terraform fmt -recursive
        2. terraform init -input=false -no-color -backend=false
        3. terraform validate -no-color
        4. terraform plan -input=false -no-color -lock=false -out=deployment.tfplan
        5. terraform show -no-color deployment.tfplan  (human-readable display)
        6. terraform show -json deployment.tfplan      (machine-readable summary)

    Returns a TerraformPlanResult on success.
    Raises TerraformError with an appropriate error_kind on any failure.

    IMPORTANT: terraform apply is NOT called here.
    """
    terraform_dir = workspace / "terraform"
    deployment_id = workspace.name  # used only for log correlation

    logger.info(
        "[DEPLOYMENT] terraform_fmt_started | deployment_id=%s", deployment_id
    )
    _terraform_command(["fmt", "-recursive"], terraform_dir, env, 120)
    logger.info(
        "[DEPLOYMENT] terraform_fmt_completed | deployment_id=%s", deployment_id
    )

    logger.info(
        "[DEPLOYMENT] terraform_init_started | deployment_id=%s", deployment_id
    )
    _terraform_command(["init", "-input=false", "-no-color", "-backend=false"], terraform_dir, env, 900)
    logger.info(
        "[DEPLOYMENT] terraform_init_completed | deployment_id=%s", deployment_id
    )

    logger.info(
        "[DEPLOYMENT] terraform_validate_started | deployment_id=%s", deployment_id
    )
    _terraform_command(["validate", "-no-color"], terraform_dir, env, 180)
    logger.info(
        "[DEPLOYMENT] terraform_validate_completed | deployment_id=%s", deployment_id
    )

    logger.info(
        "[DEPLOYMENT] terraform_plan_started | deployment_id=%s", deployment_id
    )
    _terraform_command(
        ["plan", "-input=false", "-no-color", "-lock=false", "-out=deployment.tfplan"],
        terraform_dir,
        env,
        900,
    )
    plan_created_at = datetime.now(timezone.utc).replace(tzinfo=None)  # naive UTC
    logger.info(
        "[DEPLOYMENT] terraform_plan_completed | deployment_id=%s | plan_created_at=%s",
        deployment_id, plan_created_at.isoformat(),
    )

    display = _terraform_command(
        ["show", "-no-color", "deployment.tfplan"], terraform_dir, env, 180
    )
    raw_json = _terraform_command(
        ["show", "-json", "deployment.tfplan"], terraform_dir, env, 180
    )
    try:
        plan = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise TerraformError(
            "Terraform returned an unreadable machine plan.",
            error_kind="show_failed",
        ) from exc

    resources = []
    create = modify = destroy = replace = 0
    for item in plan.get("resource_changes") or []:
        actions = item.get("change", {}).get("actions") or []
        if not actions or actions == ["no-op"] or actions == ["read"]:
            continue
        action_set = set(actions)
        if "create" in action_set and "delete" in action_set:
            action = "replace"
            replace += 1
        elif "create" in action_set:
            action = "create"
            create += 1
        elif "delete" in action_set:
            action = "destroy"
            destroy += 1
        else:
            action = "modify"
            modify += 1
        resources.append({
            "address": item.get("address", "unknown"),
            "type": item.get("type", "unknown"),
            "name": item.get("name", "unknown"),
            "action": action,
            "actions": actions,
        })

    summary = {
        "resources": resources,
        "create": create,
        "modify": modify,
        "destroy": destroy,
        "replace": replace,
        "has_destructive_changes": bool(destroy or replace),
        "estimated_cost": None,
    }
    fingerprint = hashlib.sha256(
        json.dumps(plan, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    ).hexdigest()

    document_path = workspace / "deployment-plan.json"
    try:
        document = json.loads(document_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        document = {}
    document["resources"] = resources
    document["summary"] = {k: v for k, v in summary.items() if k != "resources"}
    document["plan_created_at"] = plan_created_at.isoformat() + "Z"
    document_path.write_text(json.dumps(document, indent=2), encoding="utf-8")

    logger.info(
        "[DEPLOYMENT] plan_ready | deployment_id=%s | create=%d | modify=%d | "
        "destroy=%d | replace=%d | fingerprint=%s",
        deployment_id, create, modify, destroy, replace, fingerprint[:16],
    )
    return TerraformPlanResult(workspace, summary, display[-50000:], fingerprint, plan_created_at)


def apply_plan(workspace: Path, env: dict[str, str], plan_name: str = "deployment.tfplan") -> dict[str, Any]:
    terraform_dir = workspace / "terraform"
    _terraform_command(
        ["apply", "-input=false", "-no-color", "-auto-approve", plan_name],
        terraform_dir,
        env,
        1800,
    )
    raw_outputs = _terraform_command(["output", "-json"], terraform_dir, env, 120)
    try:
        output_data = json.loads(raw_outputs)
    except json.JSONDecodeError:
        output_data = {}
    outputs = {
        name: ("<sensitive>" if value.get("sensitive") else value.get("value"))
        for name, value in output_data.items()
    }
    return {"outputs": outputs}
