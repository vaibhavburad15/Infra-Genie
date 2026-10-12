
from __future__ import annotations

import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Resolution ids understood by POST /api/deployments/{id}/resolve
RESOLVE_RETRY_PLAN = "retry_plan"            # regenerate the plan from scratch
RESOLVE_REPLAN = "replan"                    # re-run terraform plan on the existing workspace
RESOLVE_RDS_VERSION = "rds_engine_version"   # patch engine_version, then re-plan
RESOLVE_S3_WEBSITE = "s3_website_hosting"    # serve the static site from S3 website hosting
RESOLVE_DB_USERNAME = "rds_master_username"  # replace a reserved database username, then re-plan

_STAGE_TITLES = {
    "artifact_generation": "Terraform generation failed",
    "planning": "Terraform plan failed",
    "apply": "Infrastructure creation failed",
    "app_deploy": "Application deployment failed",
    "verification": "Health verification failed",
}


def terraform_error_block(text: str) -> str:
    """Return the `Error:` section(s) of Terraform output without the progress noise."""
    blocks = re.findall(r"(Error: .*?)(?=\n\s*\nError: |\Z)", text or "", re.DOTALL)
    cleaned = []
    for block in blocks:
        lines = [line.rstrip() for line in block.strip().splitlines()]
        # Drop the "with aws_x.y, on main.tf line N" source pointer lines'
        # trailing code excerpt; keep the message and the resource address.
        cleaned.append("\n".join(lines[:12]))
    return "\n\n".join(cleaned)[:4000]


def _failure(stage: str, title: str, detail: str, suggestion: str,
             resolutions: Optional[list[dict[str, Any]]] = None, raw: str = "") -> dict[str, Any]:
    return {
        "stage": stage,
        "title": title,
        "detail": detail.strip()[:4000],
        "suggestion": suggestion,
        "resolutions": resolutions or [],
        "raw": (raw or "")[-12000:],
    }


def _available_engine_majors(env: Optional[dict[str, str]], region: str, engine: str) -> list[str]:
    """Major versions RDS offers for `engine` in `region`, newest first."""
    if not env:
        return []
    try:
        import boto3
        rds = boto3.Session(
            aws_access_key_id=env.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=env.get("AWS_SECRET_ACCESS_KEY"),
            aws_session_token=env.get("AWS_SESSION_TOKEN") or None,
            region_name=region,
        ).client("rds")
        majors: set[str] = set()
        for page in rds.get_paginator("describe_db_engine_versions").paginate(Engine=engine):
            for version in page.get("DBEngineVersions", []):
                number = version.get("EngineVersion", "")
                if engine.startswith("postgres"):
                    majors.add(number.split(".")[0])
                else:
                    majors.add(".".join(number.split(".")[:2]))
        return sorted(majors, key=lambda v: [int(p) for p in v.split(".") if p.isdigit()], reverse=True)
    except Exception as exc:  # best effort: the failure is still reported without options
        logger.warning("[ERRORS] engine_version_lookup_failed | engine=%s | error=%s", engine, exc)
        return []


def classify_failure(
    error: Any,
    *,
    stage: str,
    region: str = "",
    env: Optional[dict[str, str]] = None,
    has_workspace: bool = False,
) -> dict[str, Any]:
    """Build failure_details for an exception or raw error text."""
    text = str(getattr(error, "user_message", "") or error or "")
    raw = str(error or "")
    kind = getattr(error, "error_kind", "")
    retry = {
        "id": RESOLVE_RETRY_PLAN,
        "label": "Generate the plan again",
        "description": "Regenerates the Terraform configuration and runs a new plan.",
        "params": {},
        "recommended": True,
    }
    replan = {
        "id": RESOLVE_REPLAN,
        "label": "Re-run the plan",
        "description": "Keeps what was already created and plans the remaining changes for your approval.",
        "params": {},
        "recommended": True,
    }

    # ── AI model server ───────────────────────────────────────────────────────
    url = re.search(r"https?://[^\s,]+?(?=[.,]?\s|$)", text)
    if kind == "llm_unavailable" or "LLM service" in text or "LLM at " in text:
        server = url.group(0) if url else "the configured LLM_BASE_URL"
        if "Could not connect" in text or "Could not reach" in text:
            return _failure(
                stage, "AI model server is unreachable",
                f"Could not connect to the model server at {server}.",
                "Start (or restart) the vLLM server and make sure this machine can reach it, "
                "then generate the plan again.",
                [retry], raw,
            )
        if "did not respond" in text:
            return _failure(
                stage, "AI model server timed out", text,
                "The model server is busy or slow. Try again, or raise LLM_TIMEOUT.",
                [retry], raw,
            )
        if "HTTP 401" in text or "HTTP 403" in text:
            return _failure(
                stage, "AI model server rejected the API key", text,
                "Set LLM_API_KEY in .env to the server's key and restart the API and worker.",
                [retry], raw,
            )
        if "max_model_len" in text or "max_tokens" in text:
            limit = re.search(r"max_model_len=(\d+)", text)
            return _failure(
                stage, "AI model context window is too small",
                f"The model server allows only {limit.group(1) if limit else 'a few thousand'} tokens per request.",
                "Restart vLLM with a larger --max-model-len (for example 32768).",
                [retry], raw,
            )

    # ── RDS engine version no longer offered ──────────────────────────────────
    version = re.search(r"Cannot find version ([\w.]+) for (\w+)", raw)
    if version:
        requested, engine = version.group(1), version.group(2)
        resource = re.search(r"with (aws_db_instance\.[\w-]+)", raw)
        majors = _available_engine_majors(env, region, engine)
        label = "PostgreSQL" if engine.startswith("postgres") else engine.upper()
        # Recommend the previous major: a brand-new major can lag on support
        # for small instance classes and extensions.
        recommended = 1 if len(majors) > 1 else 0
        resolutions = [
            {
                "id": RESOLVE_RDS_VERSION,
                "label": f"Use {label} {major}" + (
                    " (recommended)" if index == recommended else " (newest)" if index == 0 else ""
                ),
                "description": (
                    f"Sets engine_version to \"{major}\" so AWS uses the newest {label} {major}.x "
                    "available, then re-plans. Resources already created are kept."
                ),
                "params": {"resource": resource.group(1) if resource else None, "version": major},
                "recommended": index == recommended,
            }
            for index, major in enumerate(majors[:3])
        ] if has_workspace else []
        return _failure(
            stage, f"{label} {requested} is not available in {region or 'this region'}",
            f"AWS no longer offers {label} {requested} for new databases"
            + (f" in {region}" if region else "") + "."
            + (f" Available major versions: {', '.join(majors[:6])}." if majors else ""),
            "Choose a supported version below. Everything created so far is kept, and only "
            "the database and what depends on it will be planned again.",
            resolutions or ([replan] if has_workspace else [retry]), raw,
        )

    # ── CloudFront not yet enabled for this AWS account ───────────────────────
    # Returned as AccessDenied, but no IAM change can fix it: AWS Support has
    # to verify the account first.
    if re.search(r"must be verified before you can add new CloudFront resources", raw):
        request_id = re.search(r"RequestID: ([\w-]+)", raw)
        resolutions = []
        if has_workspace:
            resolutions.append({
                "id": RESOLVE_S3_WEBSITE,
                "label": "Host on S3 website for now (HTTP only)",
                "description": (
                    "Serves the site from a public S3 website endpoint without CloudFront: "
                    "works now, but HTTP only and no CDN. Creates a new plan for your approval."
                ),
                "params": {},
                "recommended": True,
            })
            resolutions.append({**replan,
                                "label": "Re-run after AWS has verified the account",
                                "recommended": False})
        return _failure(
            stage, "Your AWS account must be verified before it can use CloudFront",
            "AWS blocks CloudFront for new or recently created accounts until AWS Support "
            "verifies them. This is an account restriction, not a missing IAM permission."
            + (f"\n\nAWS request ID: {request_id.group(1)}" if request_id else ""),
            "Open AWS Support Center (https://console.aws.amazon.com/support/home#/) > Create case > "
            "Account and billing, ask them to enable CloudFront for this account and include the "
            "request ID above. Until then you can host the site on S3 website hosting.",
            resolutions or [retry], raw,
        )

    # ── Reserved database username ────────────────────────────────────────────
    reserved = re.search(r"MasterUsername (\S+) cannot be used as it is a reserved word", raw)
    if reserved:
        return _failure(
            stage, f'Database username "{reserved.group(1)}" is reserved',
            f'AWS refused to create the database: "{reserved.group(1)}" is a reserved word for this '
            "database engine and cannot be the master username.",
            "Use a non-reserved username. Everything created so far is kept; only the database "
            "and what depends on it will be planned again.",
            [{
                "id": RESOLVE_DB_USERNAME,
                "label": 'Use username "appadmin" and re-plan',
                "description": "Sets the database master username to appadmin, then creates a new plan for your approval.",
                "params": {"username": "appadmin"},
                "recommended": True,
            }] if has_workspace else [retry],
            raw,
        )

    # ── Permissions ───────────────────────────────────────────────────────────
    denied = re.search(
        r"(?:AccessDenied|UnauthorizedOperation|not authorized to perform)[^\n]*?"
        r"(?:perform: |action )?([a-z0-9-]+:[A-Za-z0-9*]+)", raw)
    if denied or "AccessDenied" in raw:
        action = denied.group(1) if denied else "the required action"
        return _failure(
            stage, "The connected AWS role is missing a permission",
            f"AWS denied {action}.\n\n" + terraform_error_block(raw),
            f"Add {action} to the IAM role used by the connected account, then re-run.",
            [replan] if has_workspace else [retry], raw,
        )

    # ── Name already taken ────────────────────────────────────────────────────
    if re.search(r"already exists|AlreadyExists|DuplicateName", raw):
        return _failure(
            stage, "An AWS resource with the same name already exists",
            terraform_error_block(raw) or text,
            "Another deployment (or a manual resource) already uses this name. Generate a new "
            "plan: new plans use a unique per-deployment name prefix.",
            [retry], raw,
        )

    # ── Terraform CLI failures ────────────────────────────────────────────────
    block = terraform_error_block(raw)
    if block:
        return _failure(
            stage, _STAGE_TITLES.get(stage, "Deployment failed"), block,
            "Fix the cause above, then re-run. Resources that were already created are kept "
            "in the Terraform state and will not be created twice."
            if stage == "apply" else "Generate the plan again to let the generator fix this.",
            [replan] if (has_workspace and stage == "apply") else [retry], raw,
        )

    # ── Anything else: show the message as-is ─────────────────────────────────
    return _failure(
        stage, _STAGE_TITLES.get(stage, "Deployment failed"), text or raw or "Unknown error.",
        getattr(error, "suggestion", "") or "Review the details, then try again.",
        [replan] if (has_workspace and stage == "apply") else [retry], raw,
    )


def summary_message(failure: dict[str, Any]) -> str:
    """Plain-text error_message kept for older clients: headline + actual error."""
    parts = [failure.get("title", ""), failure.get("detail", ""), failure.get("suggestion", "")]
    return "\n\n".join(p for p in parts if p)[:12000]
