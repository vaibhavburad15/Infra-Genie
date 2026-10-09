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
        missing_binary                      — terraform CLI not on PATH
        path_traversal                      — deployment ID tried to escape the artifact dir
        invalid_artifact                    — LLM-generated Terraform failed safety validation
        terraform_artifact_missing_resources — Terraform has no resource blocks (provider only)
        init_failed                         — terraform init returned non-zero
        validate_failed                     — terraform validate returned non-zero
        plan_failed                         — terraform plan returned non-zero
        show_failed                         — terraform show failed to produce usable JSON
        fmt_failed                          — terraform fmt returned non-zero
        assume_role_failed                  — STS AssumeRole failed
        workspace_error                     — general workspace / filesystem error
        timeout                             — terraform command exceeded its timeout
        unknown                             — unexpected error

    Optional fields (all default to empty string):
        stage        — pipeline stage where the error occurred
        user_message — human-readable sentence suitable for the UI
        suggestion   — recommended action for the user
    """

    def __init__(
        self,
        message: str,
        error_kind: str = "unknown",
        stage: str = "",
        user_message: str = "",
        suggestion: str = "",
    ) -> None:
        super().__init__(message)
        self.error_kind = error_kind
        self.stage = stage
        self.user_message = user_message or message
        self.suggestion = suggestion


@dataclass
class TerraformPlanResult:
    workspace: Path
    summary: dict[str, Any]
    display: str
    fingerprint: str
    plan_created_at: datetime   # UTC timestamp when terraform plan completed


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
    """Remove an optional outer HCL code fence without changing artifact content."""
    text = str(value or "").strip()
    # Strip opening code fence with optional language tag
    text = re.sub(r"^```(?:hcl|terraform|tf)?\s*\n?", "", text, flags=re.IGNORECASE)
    # Strip closing code fence
    text = re.sub(r"\n?```\s*$", "", text)
    return text.strip()


# ---------------------------------------------------------------------------
# Patterns for non-HCL contamination detection
# ---------------------------------------------------------------------------

# Box-drawing / directory-tree characters — never valid in HCL
_TREE_CHARS = re.compile(r"[├└│─╭╰╮╯]")

# A line that is unambiguously a Markdown heading (## Heading) or bold bullet
_MD_HEADING = re.compile(r"^\s*#{1,6}\s+\S")

# Markdown code fence opener/closer
_MD_FENCE = re.compile(r"^\s*```")

# A line starts an HCL block or is a top-level assignment / comment
_HCL_LINE = re.compile(
    r"^\s*(?:terraform|provider|resource|variable|output|locals|data)\s*[\"\{]"
    r"|^\s*[\w_]+\s*="   # assignment
    r"|^\s*\}"            # closing brace
    r"|^\s*\{"            # opening brace
    r"|^\s*#[^!]"         # HCL comment (but not shebang)
    r"|^\s*$",            # blank line
)


def _extract_hcl_only(source: str) -> str:
    """Remove every line that cannot be part of valid HCL/Terraform.

    The LLM sometimes wraps real Terraform in a README-style response:

        provider "aws" { region = "ap-south-1" }
        # mb
        ## Overview
        This is a full-stack web application...
        ## Project Structure
        ```
        mb/
        ├── server.js
        ...
        ```
        resource "aws_instance" "app" { ... }

    This function extracts ONLY the HCL blocks, discarding all prose,
    markdown headings, directory trees, and code-fenced non-HCL content.

    Algorithm:
    1. Walk every line tracking brace depth.
    2. Outside any open brace block:
       - Accept lines that start HCL keywords, assignments, comments, blanks.
       - Reject lines that are markdown headings, tree chars, or plain prose.
       - When we hit a ``` fence, skip until the matching closing fence.
    3. Inside an open brace block (depth > 0): keep every line because we
       cannot safely remove content without breaking brace matching — but
       strip tree characters from those lines to handle inline contamination.
    """
    lines = source.splitlines()
    kept: list[str] = []
    depth = 0
    in_fence = False

    for line in lines:
        # Track markdown code fences outside HCL blocks
        if depth == 0 and _MD_FENCE.match(line):
            in_fence = not in_fence
            # Never write a markdown fence into .tf output
            continue
        if in_fence:
            continue  # skip everything inside a ``` ... ``` block

        # Directory trees are documentation, even if malformed HCL above left
        # the brace counter inside a block. Drop the entire line: stripping only
        # the box-drawing glyphs leaves paths such as `server/` or `app.ts`,
        # which are still invalid Terraform syntax.
        if _TREE_CHARS.search(line):
            continue

        # Count brace depth changes in this line
        opens  = line.count("{")
        closes = line.count("}")

        if depth > 0:
            # Inside an HCL block — keep lines because removing arbitrary
            # content could break brace matching.
            kept.append(line)
            depth += opens - closes
            if depth < 0:
                depth = 0
        else:
            # Outside any block — apply strict line-level filtering
            stripped = line.strip()

            # Always discard markdown headings
            if _MD_HEADING.match(line):
                continue

            # Discard plain prose lines (non-empty, not matching HCL patterns)
            if stripped and not _HCL_LINE.match(line):
                continue

            # Accept the line
            kept.append(line)
            depth += opens - closes
            if depth < 0:
                depth = 0

    result = "\n".join(kept).strip()
    # Collapse runs of 3+ blank lines down to 2 (cosmetic)
    result = re.sub(r"\n{3,}", "\n\n", result)
    return result


def _check_hcl_contamination(source: str, file_label: str = "main.tf") -> None:
    """Raise TerraformError for an empty Terraform file or missing HCL blocks.

    Strict contamination checks run in _check_generated_hcl before this helper.
    This remains separate for legacy callers and regression coverage.
    """
    # 1. Residual tree characters — extraction missed something
    tree_lines = [ln for ln in source.splitlines() if _TREE_CHARS.search(ln)]
    if tree_lines:
        sample = tree_lines[0].strip()[:80]
        raise TerraformError(
            f"The generated Terraform file ({file_label}) still contains "
            f"directory-tree characters after cleanup (e.g. '{sample}'). "
            "The AI model produced an unusable artifact. "
            "Re-run project analysis to regenerate clean Terraform artifacts.",
            error_kind="invalid_artifact",
        )

    # 2. No HCL keywords at all
    _HCL_KEYWORD = re.compile(
        r"\b(?:terraform|provider|resource|variable|output|locals|data)\s*[\"{]",
        re.IGNORECASE,
    )
    if not source.strip() or not _HCL_KEYWORD.search(source):
        raise TerraformError(
            f"The generated Terraform file ({file_label}) contains no recognisable "
            "HCL blocks after cleanup (terraform, provider, resource, etc.). "
            "The AI model may have returned a non-Terraform response. "
            "Re-run project analysis to regenerate clean Terraform artifacts.",
            error_kind="invalid_artifact",
        )


def _strip_non_hcl_lines(source: str) -> str:
    """Legacy shim — delegates to _extract_hcl_only.

    Kept so existing tests that import this name continue to work.
    """
    return _extract_hcl_only(source)


# Matches any Terraform resource block: resource "aws_..." "name" {
# aws_ resource type names may contain letters, digits, and underscores
# e.g. aws_s3_bucket, aws_iam_role, aws_db_instance, aws_lb_target_group
_RESOURCE_BLOCK = re.compile(
    r'^\s*resource\s+"aws_[\w]+"\s+"[^"]+"\s*\{',
    re.IGNORECASE | re.MULTILINE,
)


def _require_resource_blocks(source: str) -> None:
    """Raise TerraformError when the Terraform source has no resource blocks.

    A provider-only .tf file (e.g. just `provider "aws" { region = "..." }`)
    is technically valid HCL but produces no infrastructure and signals that
    the LLM returned documentation instead of Terraform code.

    This check runs BEFORE any Terraform CLI commands so the user gets a
    clear artifact-generation error rather than a misleading terraform fmt /
    terraform plan error.

    Raises:
        TerraformError(error_kind='terraform_artifact_missing_resources')
    """
    if _RESOURCE_BLOCK.search(source):
        return  # at least one resource block — OK

    # Count what we did find to build a helpful message
    has_provider = bool(re.search(r'\bprovider\s+"aws"', source, re.IGNORECASE))
    found_desc = "a provider block only" if has_provider else "no Terraform blocks at all"

    resource_count = len(_RESOURCE_BLOCK.findall(source))

    logger.error(
        "[DEPLOYMENT] terraform_generation_failed | error_kind=terraform_artifact_missing_resources"
        " | resource_count=%d | has_provider=%s",
        resource_count, has_provider,
    )

    raise TerraformError(
        f"Terraform artifact generation produced no infrastructure resources "
        f"(found {found_desc}).",
        error_kind="terraform_artifact_missing_resources",
        stage="artifact_generation",
        user_message=(
            "The AI generated a Terraform configuration without any AWS infrastructure "
            "resources. Only a provider block was produced."
        ),
        suggestion=(
            "Regenerate the deployment plan. The Terraform generator must produce "
            "resource blocks such as aws_instance, aws_security_group, aws_vpc, "
            "aws_subnet, aws_lb, or aws_db_instance based on the deployment architecture."
        ),
    )


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


_TF_FILENAME = re.compile(r"^[A-Za-z0-9_-]+\.tf$")
_RESOURCE_DECLARATION = re.compile(
    r'^\s*resource\s+"(aws_[\w]+)"\s+"([A-Za-z0-9_-]+)"\s*\{',
    re.IGNORECASE | re.MULTILINE,
)
_APP_SOURCE_LINE = re.compile(
    r"^\s*(?:import\s+|export\s+(?:default|const|function|class)\b|"
    r"(?:const|let|var)\s+[A-Za-z_$]|function\s+[A-Za-z_$]|"
    r"npm\s+(?:install|run|start)\b|yarn\s+(?:install|run|start)\b|"
    r"pnpm\s+(?:install|run|start)\b|console\.log\s*\(|"
    r"<(!doctype|html|script)\b|(?:server|client|src)/[^\s]+\.(?:js|jsx|ts|tsx)\b)",
    re.IGNORECASE,
)
_SUPPORTING_RESOURCE_TYPES = {
    "aws_s3_bucket_public_access_block",
    "aws_s3_bucket_versioning",
    "aws_s3_bucket_server_side_encryption_configuration",
    "aws_s3_bucket_ownership_controls",
    "aws_s3_bucket_acl",
    "aws_s3_bucket_policy",
    "aws_iam_role_policy_attachment",
    "aws_security_group_rule",
}


def _resource_block_body(source: str, match: re.Match[str]) -> str:
    """Return a resource body while ignoring braces inside quoted strings/comments."""
    opening = source.find("{", match.start(), match.end())
    if opening < 0:
        return ""
    depth = 0
    in_string = False
    escaped = False
    in_line_comment = False
    for index in range(opening, len(source)):
        char = source[index]
        next_char = source[index + 1] if index + 1 < len(source) else ""
        if in_line_comment:
            if char == "\n":
                in_line_comment = False
            continue
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "#" or (char == "/" and next_char == "/"):
            in_line_comment = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[opening + 1:index]
    return source[opening + 1:]


def _check_hcl_delimiters(filename: str, source: str) -> None:
    """Catch incomplete HCL blocks and expressions before any Terraform command."""
    stack: list[tuple[str, int]] = []
    matching = {"}": "{", "]": "[", ")": "("}
    heredoc: str | None = None
    block_comment = False

    for line_number, line in enumerate(source.splitlines(), start=1):
        if heredoc:
            if re.match(rf"^\s*{re.escape(heredoc)}\s*$", line):
                heredoc = None
            continue
        in_string = False
        escaped = False
        index = 0
        while index < len(line):
            char = line[index]
            next_two = line[index:index + 2]
            if block_comment:
                if next_two == "*/":
                    block_comment = False
                    index += 2
                    continue
                index += 1
                continue
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                index += 1
                continue
            if next_two == "/*":
                block_comment = True
                index += 2
                continue
            if char == "#" or next_two == "//":
                break
            if char == '"':
                in_string = True
                index += 1
                continue
            if next_two in ("<<",):
                marker_match = re.match(r"<<-?([A-Za-z_][A-Za-z0-9_]*)", line[index:])
                if marker_match:
                    heredoc = marker_match.group(1)
                    break
            if char in "{[(":
                stack.append((char, line_number))
            elif char in "}])":
                if not stack or stack[-1][0] != matching[char]:
                    raise TerraformError(
                        f"Generated Terraform file {filename} has an unmatched '{char}' "
                        f"on line {line_number}.",
                        error_kind="invalid_artifact", stage="artifact_generation",
                    )
                stack.pop()
            index += 1
        if in_string:
            raise TerraformError(
                f"Generated Terraform file {filename} has an unterminated string "
                f"on line {line_number}.",
                error_kind="invalid_artifact", stage="artifact_generation",
            )

    if heredoc:
        raise TerraformError(
            f"Generated Terraform file {filename} has an unterminated heredoc.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )
    if stack:
        opening, line_number = stack[-1]
        raise TerraformError(
            f"Generated Terraform file {filename} has an unclosed '{opening}' "
            f"from line {line_number}.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )
    if block_comment:
        raise TerraformError(
            f"Generated Terraform file {filename} has an unterminated block comment.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )


def _terraform_file_map(artifact: Any) -> tuple[dict[str, str], list[dict[str, Any]] | None]:
    """Normalize structured Terraform artifacts without discarding content."""
    specifications = None
    if isinstance(artifact, str):
        files = {"main.tf": artifact}
    elif isinstance(artifact, dict):
        files = artifact.get("files")
        specifications = artifact.get("resource_specifications")
        if files is None and isinstance(artifact.get("terraform"), str):
            files = {"main.tf": artifact["terraform"]}
        if not isinstance(files, dict):
            raise TerraformError(
                "Terraform generation did not return a files object.",
                error_kind="invalid_artifact", stage="artifact_generation",
            )
    else:
        raise TerraformError(
            "Terraform generation returned an unsupported artifact format.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )

    normalized: dict[str, str] = {}
    for filename, content in files.items():
        if not isinstance(filename, str) or not _TF_FILENAME.fullmatch(filename):
            raise TerraformError(
                f"Terraform generation returned an invalid file path: {filename!r}.",
                error_kind="invalid_artifact", stage="artifact_generation",
            )
        if not isinstance(content, str):
            raise TerraformError(
                f"Terraform file {filename} does not contain text.",
                error_kind="invalid_artifact", stage="artifact_generation",
            )
        normalized[filename] = _artifact_text(content)
    if "main.tf" not in normalized:
        raise TerraformError(
            "Terraform generation did not include main.tf.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )
    if specifications is not None and not isinstance(specifications, list):
        raise TerraformError(
            "Terraform resource_specifications must be a JSON array.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )
    return normalized, specifications


def _check_generated_hcl(filename: str, source: str) -> None:
    """Reject contamination instead of cleaning prose into a different artifact."""
    tree_lines = [line for line in source.splitlines() if _TREE_CHARS.search(line)]
    if tree_lines:
        raise TerraformError(
            f"Generated Terraform file {filename} contains a project directory tree.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )
    if "```" in source or "~~~" in source:
        raise TerraformError(
            f"Generated Terraform file {filename} contains Markdown code fences.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )
    if any(_MD_HEADING.match(line) for line in source.splitlines()):
        raise TerraformError(
            f"Generated Terraform file {filename} contains Markdown headings or README content.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )
    readme_heading = re.compile(
        r"^\s*#\s+(?:README|Overview|Project Overview|Project Structure|"
        r"Getting Started|Tech Stack)\b", re.IGNORECASE,
    )
    if any(readme_heading.match(line) for line in source.splitlines()):
        raise TerraformError(
            f"Generated Terraform file {filename} contains README content.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )
    if any(_APP_SOURCE_LINE.match(line) for line in source.splitlines()):
        raise TerraformError(
            f"Generated Terraform file {filename} contains unrelated application code.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )

    # Compare with the legacy extractor only as a detector. Its output is never
    # written: any prose or directory listing it would remove makes generation
    # invalid and is fed back to the model for a retry.
    extracted = _extract_hcl_only(source)
    compact_source = re.sub(r"\n{3,}", "\n\n", source).strip()
    if extracted != compact_source:
        raise TerraformError(
            f"Generated Terraform file {filename} contains non-HCL text, README content, "
            "or application source code.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )
    if not source.strip():
        raise TerraformError(
            f"Generated Terraform file {filename} is empty.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )


def validate_terraform_artifact(
    artifact: Any,
    *,
    region: str,
    required_components: list[str] | None = None,
) -> dict[str, Any]:
    """Validate generated files and resource specs before writing or CLI use.

    There is no fixed infrastructure resource count: generated AWS resource
    declarations must match the response's specifications, and the specs must
    cover the application components derived from project discovery.
    """
    files, specifications = _terraform_file_map(artifact)
    for filename, source in files.items():
        _check_hcl_delimiters(filename, source)
        _check_generated_hcl(filename, source)

    main_source = files["main.tf"]
    _check_hcl_contamination(main_source, file_label="main.tf")
    _require_resource_blocks(main_source)
    all_source = "\n\n".join(files.values())
    _validate_generated_terraform(all_source)

    if not re.search(r'\bprovider\s+"aws"\s*\{', all_source, re.IGNORECASE):
        raise TerraformError(
            "Terraform generation must include one AWS provider block.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )
    if not re.search(r'\bsource\s*=\s*"hashicorp/aws"', all_source, re.IGNORECASE):
        raise TerraformError(
            "Terraform generation must declare the official hashicorp/aws provider source.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )
    all_source = _force_aws_region(all_source, region)
    other_regions = {
        value for value in re.findall(r'\bregion\s*=\s*"([^"]+)"', all_source)
        if value != region
    }
    if other_regions:
        raise TerraformError(
            "Generated Terraform targets a region other than the deployment region.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )

    if not specifications:
        raise TerraformError(
            "Terraform generation must include resource_specifications that describe "
            "the AWS resources and application components being deployed.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )
    declared = {(kind.lower(), name) for kind, name in _RESOURCE_DECLARATION.findall(all_source)}
    specified: set[tuple[str, str]] = set()
    covered_components: set[str] = set()
    for index, item in enumerate(specifications):
        if not isinstance(item, dict):
            raise TerraformError(
                f"resource_specifications[{index}] must be an object.",
                error_kind="invalid_artifact", stage="artifact_generation",
            )
        kind, name = item.get("type"), item.get("name")
        components = item.get("components")
        if (not isinstance(kind, str) or not kind.startswith("aws_")
                or not isinstance(name, str) or not isinstance(components, list)
                or any(not isinstance(component, str) for component in components)):
            raise TerraformError(
                f"resource_specifications[{index}] needs AWS type, name, and components fields.",
                error_kind="invalid_artifact", stage="artifact_generation",
            )
        pair = (kind.lower(), name)
        if pair in specified:
            raise TerraformError(
                f"Terraform resource {kind}.{name} is specified more than once.",
                error_kind="invalid_artifact", stage="artifact_generation",
            )
        specified.add(pair)
        covered_components.update(component.casefold() for component in components)

    missing = sorted(specified - declared)
    if missing:
        raise TerraformError(
            "Terraform resource specifications list resources missing from HCL: "
            f"{missing}. Add those exact resource blocks or correct the specifications.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )

    # AWS often represents one architectural component with a primary resource
    # and linked controls (for example an S3 bucket public-access block). Permit
    # only recognized support resources that directly reference a specified
    # primary resource. Unrelated or undocumented resources still fail.
    undocumented = sorted(declared - specified)
    for kind, name in undocumented:
        match = next((
            item for item in _RESOURCE_DECLARATION.finditer(all_source)
            if item.group(1).lower() == kind and item.group(2) == name
        ), None)
        body = _resource_block_body(all_source, match) if match else ""
        referenced = {
            (resource_type.lower(), resource_name)
            for resource_type, resource_name in re.findall(
                r'\b(aws_[\w]+)\.([A-Za-z0-9_-]+)\.[A-Za-z_]\w*', body
            )
        }
        if kind not in _SUPPORTING_RESOURCE_TYPES or not (referenced & specified):
            raise TerraformError(
                "Terraform HCL contains an AWS resource that is not covered by the "
                "architecture resource specifications: "
                f"{kind}.{name}. Add its exact type/name to resource_specifications "
                "or remove the resource if it is not required.",
                error_kind="invalid_artifact", stage="artifact_generation",
            )
    missing_components = sorted(
        component for component in (required_components or [])
        if component.casefold() not in covered_components
    )
    if missing_components:
        raise TerraformError(
            "Terraform resource specifications do not cover required application "
            f"components: {', '.join(missing_components)}.",
            error_kind="invalid_artifact", stage="artifact_generation",
        )

    # Keep provider region changes local to the file that owns the provider.
    provider_file = next(
        filename for filename, source in files.items()
        if re.search(r'\bprovider\s+"aws"\s*\{', source, re.IGNORECASE)
    )
    files[provider_file] = _force_aws_region(files[provider_file], region)
    return {"files": files, "resource_specifications": specifications}


async def generate_terraform_artifacts(
    context: dict[str, Any],
    *,
    max_attempts: int = 3,
    generate_once=None,
) -> dict[str, Any]:
    """Run the Terraform agent with validation feedback, stopping after 3 tries."""
    from agents import terraform_agent

    agent = generate_once or terraform_agent
    errors: list[str] = []
    for attempt in range(1, max_attempts + 1):
        agent_state = {
            **context,
            "terraform_generation_errors": list(errors),
        }
        try:
            response = await agent(agent_state)
            artifact = response.get("terraform_artifacts") if isinstance(response, dict) else response
            validated = validate_terraform_artifact(
                artifact,
                region=str((context.get("deployment") or {}).get("region") or ""),
                required_components=context.get("required_application_components") or [],
            )
            logger.info("[DEPLOYMENT] terraform_artifact_generated | attempt=%d", attempt)
            return validated
        except TerraformError as exc:
            errors.append(str(exc))
            logger.warning(
                "[DEPLOYMENT] terraform_artifact_generation_retry | attempt=%d | error=%s",
                attempt, str(exc)[:500],
            )
        except Exception as exc:
            errors.append(f"Generation response could not be parsed: {exc}")
            logger.warning(
                "[DEPLOYMENT] terraform_artifact_generation_retry | attempt=%d | error=%s",
                attempt, str(exc)[:500],
            )

    summary = "; ".join(dict.fromkeys(errors)) or "No usable Terraform response was returned."
    raise TerraformError(
        f"Terraform artifact generation failed after {max_attempts} attempts. Last validation errors: {summary}",
        error_kind="invalid_artifact",
        stage="artifact_generation",
        user_message=(
            f"Terraform artifact generation failed after {max_attempts} attempts: {summary}. "
            "The deployment plan was not started."
        ),
        suggestion="Review the project architecture and deployment requirements, then regenerate the Terraform artifacts.",
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


def build_terraform_generation_context(
    *, project: Any, deployment: Any, account: Any, artifacts: dict[str, Any],
) -> dict[str, Any]:
    """Build the exact project, architecture, requirements, and AWS context for Terraform.

    AWS discovery is reduced to deployment-relevant inventory fields. IAM role
    trust policies and other credential-adjacent discovery details are never
    sent to the model.
    """
    discovery = account.discovery_result or {}
    source_summary = project.detailed_analysis or artifacts.get("detailed_analysis") or {}
    analysis = project.analysis_result or artifacts.get("analysis") or {}
    applications = artifacts.get("discovered_apps") or []
    architecture = artifacts.get("architecture") or {}
    requirements = artifacts.get("deployment_requirements") or {}
    required_components = requirements.get("application_components")
    if not isinstance(required_components, list):
        required_components = [
            str(app.get("name")) for app in applications
            if isinstance(app, dict) and app.get("name")
            and app.get("type") in {"backend", "frontend", "worker", "static"}
        ]

    def records(key: str, fields: tuple[str, ...], limit: int = 40) -> list[dict[str, Any]]:
        result = []
        for item in discovery.get(key) or []:
            if not isinstance(item, dict):
                continue
            selected = {field: item[field] for field in fields if field in item}
            result.append(selected)
            if len(result) >= limit:
                break
        return result

    safe_discovery = {
        "account_id": account.account_id,
        "region": discovery.get("region"),
        "discovered_at": discovery.get("discovered_at"),
        "summary": discovery.get("summary") or {},
        "vpcs": records("vpcs", ("vpc_id", "is_default", "cidr", "state", "name")),
        "subnets": records("subnets", (
            "subnet_id", "vpc_id", "availability_zone", "cidr",
            "map_public_ip_on_launch", "available_ip_count", "state", "name",
        )),
        "route_tables": records("route_tables", ("route_table_id", "vpc_id", "routes", "associations")),
        "internet_gateways": records("internet_gateways", ("igw_id", "attachments", "name")),
        "nat_gateways": records("nat_gateways", ("nat_gateway_id", "vpc_id", "subnet_id", "state")),
        "security_groups": records("security_groups", (
            "group_id", "group_name", "vpc_id", "description",
        )),
        "ec2_instances": records("ec2_instances", (
            "instance_id", "instance_type", "state", "vpc_id", "subnet_id",
        )),
        "load_balancers": records("load_balancers", (
            "name", "type", "state", "vpc_id", "scheme",
        )),
        "eks_clusters": records("eks_clusters", (
            "cluster_name", "kubernetes_version", "status", "vpc_id", "subnet_ids",
        )),
        "rds_instances": records("rds_instances", (
            "db_identifier", "engine", "db_class", "status", "vpc_id",
        )),
        "ecr_repositories": records("ecr_repositories", ("name", "uri")),
    }
    return {
        "project_name": project.name,
        "project_id": str(project.id),
        "source_code_summary": source_summary,
        "analysis": analysis,
        "architecture": architecture,
        "strategy": artifacts.get("strategy") or analysis.get("recommended_strategy"),
        "discovered_apps": applications,
        "required_application_components": required_components,
        "deployment": {
            "environment": deployment.environment,
            "region": deployment.region or account.region,
        },
        "aws_discovery": safe_discovery,
    }


def generate_workspace(
    *,
    deployment_id: str | UUID,
    project_name: str,
    artifacts: dict[str, Any],
    account_id: str,
    region: str,
    discovery_ran_at: str | None,
    discovery_result: dict[str, Any],
    required_components: list[str] | None = None,
) -> Path:
    workspace = deployment_workspace(deployment_id)
    terraform_dir = workspace / "terraform"
    docker_dir = workspace / "docker"

    # Validate the complete, structured response before creating a workspace.
    # Generation errors must stop before fmt/init/validate/plan can be invoked.
    terraform_artifact = validate_terraform_artifact(
        artifacts.get("terraform"),
        region=region,
        required_components=required_components,
    )
    terraform_files = terraform_artifact["files"]
    terraform_source = "\n\n".join(terraform_files.values())

    terraform_dir.mkdir(parents=True, exist_ok=True)
    docker_dir.mkdir(parents=True, exist_ok=True)

    logger.info(
        "[DEPLOYMENT] workspace_created | deployment_id=%s | workspace=%s",
        deployment_id, workspace,
    )

    for filename, content in terraform_files.items():
        (terraform_dir / filename).write_text(content.rstrip() + "\n", encoding="utf-8")
    terraform_variables = _terraform_variable_values(
        terraform_source, project_name, region, discovery_result
    )
    tfvars_lines = [
        f"{name} = {json.dumps(value)}" for name, value in sorted(terraform_variables.items())
    ]
    if tfvars_lines:
        (terraform_dir / "terraform.tfvars").write_text(
            "\n".join(tfvars_lines) + "\n", encoding="utf-8"
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
            "terraform_files": sorted(terraform_files),
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
