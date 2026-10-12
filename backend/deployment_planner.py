
from __future__ import annotations

import asyncio
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


# Literal name attributes that must carry the per-deployment resource prefix.
# A unique prefix keeps a failed or parallel deployment from colliding with
# resources another deployment already created in the same account.
_PREFIXED_NAME_ATTRIBUTES = {
    "aws_lb": "name",
    "aws_lb_target_group": "name",
    "aws_security_group": "name",
    "aws_ecs_cluster": "name",
    "aws_ecs_service": "name",
    "aws_ecs_task_definition": "family",
    "aws_ecr_repository": "name",
    "aws_iam_role": "name",
    "aws_db_instance": "identifier",
    "aws_db_subnet_group": "name",
    "aws_elasticache_cluster": "cluster_id",
    "aws_elasticache_replication_group": "replication_group_id",
    "aws_elasticache_subnet_group": "name",
}
_AWS_NAME_LIMITS = {"aws_lb": 32, "aws_lb_target_group": 32, "aws_elasticache_cluster": 50}


def _resources_by_type(source: str) -> dict[str, list[tuple[str, str]]]:
    """Map resource type -> [(name, body)] for every resource block in source."""
    found: dict[str, list[tuple[str, str]]] = {}
    for match in _RESOURCE_DECLARATION.finditer(source):
        found.setdefault(match.group(1).lower(), []).append(
            (match.group(2), _resource_block_body(source, match))
        )
    return found


def _port_rule(body: str) -> tuple[str, str, str]:
    """(from_port, to_port, protocol) of an ingress block or rule resource."""
    def attr(pattern: str, default: str) -> str:
        match = re.search(pattern, body)
        return match.group(1) if match else default
    return (
        attr(r"from_port\s*=\s*(\d+)", "0"),
        attr(r"to_port\s*=\s*(\d+)", "0"),
        attr(r'(?:ip_)?protocol\s*=\s*"([^"]+)"', "tcp"),
    )


def _ingress_covers(port: int, sg_name: str, sg_body: str,
                    resources: dict[str, list[tuple[str, str]]]) -> bool:
    """True when the security group (inline or via rule resources) admits `port`."""
    ranges = [
        _port_rule(block.group(1))
        for block in re.finditer(r"\bingress\s*\{(.*?)\}", sg_body, re.DOTALL)
    ]
    sg_ref = re.compile(rf"aws_security_group\.{re.escape(sg_name)}\.id")
    for kind in ("aws_security_group_rule", "aws_vpc_security_group_ingress_rule"):
        for _, body in resources.get(kind, []):
            if kind == "aws_security_group_rule" and not re.search(r'type\s*=\s*"ingress"', body):
                continue
            if not re.search(rf"security_group_id\s*=\s*{sg_ref.pattern}", body):
                continue
            ranges.append(_port_rule(body))
    for low, high, protocol in ranges:
        if protocol == "-1" or int(low) <= port <= max(int(low), int(high)):
            return True
    return False


def check_terraform_semantics(files: dict[str, str], context: dict[str, Any]) -> list[str]:
    """Deterministic checks for mistakes `terraform validate` cannot see but that
    make `terraform apply` fail or leave the application unreachable.

    Returns every problem found so the generator can fix them in one retry.
    """
    source = "\n\n".join(files.values())
    resources = _resources_by_type(source)
    issues: list[str] = []

    def refs(body: str) -> set[str]:
        return set(re.findall(r"aws_security_group\.([A-Za-z0-9_-]+)\.id", body))

    # ── ECS on Fargate / awsvpc ───────────────────────────────────────────────
    task_defs = resources.get("aws_ecs_task_definition", [])
    awsvpc = any(
        re.search(r'network_mode\s*=\s*"awsvpc"|"FARGATE"', body) for _, body in task_defs
    )
    if awsvpc:
        for name, body in resources.get("aws_lb_target_group", []):
            if not re.search(r'target_type\s*=\s*"ip"', body):
                issues.append(
                    f'aws_lb_target_group.{name} must set target_type = "ip": ECS tasks using '
                    'awsvpc networking cannot register with the default "instance" target type.'
                )
        for name, body in task_defs:
            if not re.search(r"\bexecution_role_arn\s*=", body):
                issues.append(
                    f"aws_ecs_task_definition.{name} must set execution_role_arn to an aws_iam_role "
                    "trusted by ecs-tasks.amazonaws.com with the AmazonECSTaskExecutionRolePolicy "
                    "attached, otherwise Fargate cannot pull the image from ECR or write logs."
                )
        if not resources.get("aws_nat_gateway"):
            for name, body in resources.get("aws_ecs_service", []):
                if not re.search(r"assign_public_ip\s*=\s*true", body):
                    issues.append(
                        f"aws_ecs_service.{name} must set assign_public_ip = true in "
                        "network_configuration: the subnets have no NAT gateway, so tasks "
                        "cannot reach ECR without a public IP."
                    )

    # ── Infrastructure matches the validated strategy ─────────────────────────
    raw_strategy = context.get("strategy")
    strategy: dict[str, Any] = raw_strategy if isinstance(raw_strategy, dict) else {}
    targets = {str(c.get("target")) for c in strategy.get("components") or []}
    targets.add(str(strategy.get("primary_target") or ""))
    expected = {
        "ecs_fargate": ("aws_ecs_service", "aws_ecs_task_definition", "aws_ecs_cluster"),
        "ecr": ("aws_ecr_repository",),
        "ec2": ("aws_instance",),
    }
    for target, kinds in expected.items():
        if target not in targets:
            continue
        missing_kinds = [kind for kind in kinds if not resources.get(kind)]
        if missing_kinds:
            issues.append(
                f"The deployment strategy targets {target}, but the configuration has no "
                f"{', '.join(missing_kinds)}. Implement the strategy's targets exactly."
            )
    if "ecs_fargate" not in targets and resources.get("aws_ecs_service"):
        issues.append(
            "The configuration creates an ECS service, but the deployment strategy does not "
            "target ecs_fargate. Implement the strategy's targets exactly."
        )

    # ── Load balancer reachability ────────────────────────────────────────────
    lb_sgs: set[str] = set()
    for _, body in resources.get("aws_lb", []):
        lb_sgs |= refs(body)
    service_sgs: set[str] = set()
    for _, body in resources.get("aws_ecs_service", []):
        service_sgs |= refs(body)
    shared = sorted(lb_sgs & service_sgs)
    if shared:
        issues.append(
            "The load balancer and the ECS service share security group(s) "
            f"{', '.join('aws_security_group.' + s for s in shared)}. Use one security group "
            "for the load balancer (ingress on the listener port from 0.0.0.0/0) and a separate "
            "one for the service (ingress on the container port only from the load balancer's "
            "security group)."
        )
    listener_ports = {
        int(port)
        for _, body in resources.get("aws_lb_listener", [])
        for port in re.findall(r'^\s*port\s*=\s*"?(\d+)"?', body, re.MULTILINE)
    }
    sg_bodies = dict(resources.get("aws_security_group", []))
    for sg in sorted(lb_sgs):
        if sg not in sg_bodies:
            continue
        for port in sorted(listener_ports):
            if not _ingress_covers(port, sg, sg_bodies[sg], resources):
                issues.append(
                    f"aws_security_group.{sg} is attached to the load balancer but does not allow "
                    f"inbound traffic on listener port {port}."
                )

    # ── Data services the application needs ───────────────────────────────────
    needs = set(context.get("required_data_services") or [])
    if needs & {"postgres", "mysql"} and not (
        resources.get("aws_db_instance") or resources.get("aws_rds_cluster")
    ):
        engine = "postgres" if "postgres" in needs else "mysql"
        issues.append(
            f"The application uses a {engine} database but no aws_db_instance was generated. "
            "Add an RDS instance (with an aws_db_subnet_group and a security group admitting "
            "the database port only from the ECS service security group) and pass its "
            "connection URL to the container."
        )
    if "redis" in needs and not (
        resources.get("aws_elasticache_cluster")
        or resources.get("aws_elasticache_replication_group")
    ):
        issues.append(
            "The application uses Redis but no aws_elasticache_cluster was generated. Add a "
            "single-node ElastiCache Redis cluster (with an aws_elasticache_subnet_group and a "
            "security group admitting 6379 only from the ECS service security group) and pass "
            "its URL to the container."
        )
    if "mongodb" in needs and not resources.get("aws_docdb_cluster"):
        issues.append(
            "The application uses MongoDB but no aws_docdb_cluster was generated. RDS has no "
            "MongoDB engine: add an Amazon DocumentDB cluster (engine_version \"5.0.0\") with one "
            "db.t4g.medium aws_docdb_cluster_instance, an aws_docdb_subnet_group, a security "
            "group admitting 27017 only from the application, and pass its connection string "
            "(retryWrites=false) to the container as MONGODB_URI."
        )
    # Managed data services cost money every hour: only create what the app uses.
    if "mongodb" not in needs and resources.get("aws_docdb_cluster"):
        issues.append(
            "Remove the DocumentDB resources: required_data_services does not include mongodb."
        )
    if "redis" not in needs and (
        resources.get("aws_elasticache_cluster") or resources.get("aws_elasticache_replication_group")
    ):
        issues.append(
            "Remove the ElastiCache resources: required_data_services does not include redis."
        )
    if not needs & {"postgres", "mysql"} and (
        resources.get("aws_db_instance") or resources.get("aws_rds_cluster")
    ):
        issues.append(
            "Remove the RDS resources: required_data_services does not include a relational database."
        )
    for kind in ("aws_db_instance", "aws_rds_cluster"):
        for name, body in resources.get(kind, []):
            # AWS retires minor versions regularly (e.g. postgres 15.8), so a
            # pinned minor version eventually fails CreateDBInstance. A major
            # version lets RDS choose the current default minor version.
            version = re.search(r'\bengine_version\s*=\s*"([^"]+)"', body)
            engine = re.search(r'\bengine\s*=\s*"([^"]+)"', body)
            major_only = r"\d+" if engine and "postgres" in engine.group(1) else r"\d+(?:\.\d+)?"
            if version and not re.fullmatch(major_only, version.group(1)):
                issues.append(
                    f'{kind}.{name} pins engine_version "{version.group(1)}". Use the major '
                    'version only (for example "16" for postgres, "8.0" for mysql) so RDS picks '
                    "a minor version that is currently available, and omit parameter_group_name."
                )
            if re.search(r'\b(?:password|master_password)\s*=\s*"', body):
                issues.append(
                    f"{kind}.{name} hardcodes the database password. Declare "
                    'variable "db_password" { type = string, sensitive = true } without a '
                    "default and use var.db_password; the platform supplies the value."
                )
            if re.search(r'\b(?:username|master_username)\s*=\s*"', body):
                issues.append(
                    f"{kind}.{name} hardcodes the database username. Use var.db_username; "
                    'the platform supplies a valid value ("admin" and "postgres" are reserved).'
                )
    for env_name in re.findall(r'name\s*=\s*"([A-Za-z_]\w*)"\s*,?\s*value\s*=\s*""', source):
        issues.append(
            f"Container environment variable {env_name} is set to an empty string. Build it "
            "from the generated resources (for example the RDS or ElastiCache endpoint) or "
            "remove it."
        )

    # ── Outputs consumed by the application deployment step ───────────────────
    declared_outputs = set(re.findall(r'\boutput\s+"([^"]+)"', source))
    missing_outputs = [o for o in context.get("required_outputs") or [] if o not in declared_outputs]
    if missing_outputs:
        issues.append(
            "Missing required Terraform outputs: " + ", ".join(missing_outputs) + ". "
            "Declare an output block for each."
        )

    # ── Unique names per deployment ───────────────────────────────────────────
    prefix = str(context.get("resource_name_prefix") or "")
    for kind, attribute in _PREFIXED_NAME_ATTRIBUTES.items():
        for name, body in resources.get(kind, []):
            match = re.search(rf'^\s*{attribute}\s*=\s*"([^"$]*)"', body, re.MULTILINE)
            if not match:
                continue
            value = match.group(1)
            if prefix and not value.startswith(prefix):
                issues.append(
                    f'{kind}.{name} {attribute} "{value}" must start with "{prefix}" so it '
                    "does not collide with resources from other deployments."
                )
            limit = _AWS_NAME_LIMITS.get(kind)
            if limit and len(value) > limit:
                issues.append(f'{kind}.{name} {attribute} "{value}" exceeds the AWS limit of {limit} characters.')
    return issues


def _with_plugin_cache(env: dict[str, str]) -> dict[str, str]:
    """Share one provider cache across all workspaces.

    The AWS provider binary is ~700 MB; without a cache every deployment
    downloads it again during `terraform init` (minutes). Terraform >= 1.4
    ignores the cache for a workspace without a lock file unless
    TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE is set; the lock file then
    records this worker's platform checksum only, which is all it runs on.
    """
    cache = settings.resolved_artifact_dir / "plugin-cache"
    cache.mkdir(parents=True, exist_ok=True)
    return {
        **env,
        "TF_PLUGIN_CACHE_DIR": str(cache),
        "TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE": "true",
        "TF_IN_AUTOMATION": "1",
    }


def terraform_validate_files(files: dict[str, str]) -> list[str]:
    """Run `terraform init` + `terraform validate` on generated files in a
    scratch directory and return the diagnostics as readable strings.

    No AWS credentials are needed: init uses -backend=false and validate is
    offline. Providers are cached across runs via TF_PLUGIN_CACHE_DIR.
    """
    import uuid as _uuid

    root = settings.resolved_artifact_dir
    scratch = root / "validation" / _uuid.uuid4().hex
    scratch.mkdir(parents=True, exist_ok=True)
    env = _with_plugin_cache({
        key: value for key, value in os.environ.items()
        if not key.startswith("AWS_")
    })
    try:
        for filename, content in files.items():
            (scratch / filename).write_text(content.rstrip() + "\n", encoding="utf-8")
        try:
            _terraform_command(
                ["init", "-input=false", "-no-color", "-backend=false"], scratch, env, 900
            )
        except TerraformError as exc:
            if exc.error_kind != "init_failed":
                raise
            return ["terraform init failed: " + str(exc)[-1500:]]
        executable = shutil.which("terraform") or "terraform"
        result = subprocess.run(
            [executable, "validate", "-json", "-no-color"],
            cwd=str(scratch), env=env, capture_output=True, text=True,
            timeout=180, check=False,
        )
        try:
            report = json.loads(result.stdout or "{}")
        except json.JSONDecodeError:
            report = {}
        diagnostics = [
            d for d in report.get("diagnostics") or [] if d.get("severity") == "error"
        ]
        if not diagnostics and result.returncode == 0:
            return []
        if not diagnostics:
            return ["terraform validate failed: " + (result.stderr or result.stdout)[-1500:]]
        messages = []
        for diag in diagnostics:
            where = diag.get("range") or {}
            location = (
                f"{where.get('filename')}:{(where.get('start') or {}).get('line')}: "
                if where.get("filename") else ""
            )
            detail = (diag.get("detail") or "").strip()
            messages.append(f"{location}{diag.get('summary', 'error')}" + (f" — {detail}" if detail else ""))
        return messages
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


async def generate_terraform_artifacts(
    context: dict[str, Any],
    *,
    max_attempts: int = 3,
    generate_once=None,
) -> dict[str, Any]:
    """Run the Terraform agent with validation feedback, stopping after 3 tries."""
    from agents import terraform_agent
    from llm import LLMUnavailableError

    agent = generate_once or terraform_agent

    # Fast path: standard shapes use a vetted template (instant, apply-safe).
    # The LLM generator remains the path for everything else, and the
    # fallback if a template ever fails validation.
    if generate_once is None:
        from terraform_templates import render
        templated = render(context)
        if templated:
            try:
                validated = validate_terraform_artifact(
                    templated,
                    region=str((context.get("deployment") or {}).get("region") or ""),
                    required_components=context.get("required_application_components") or [],
                )
                issues = check_terraform_semantics(validated["files"], context)
                if not issues:
                    logger.info("[DEPLOYMENT] terraform_artifact_templated")
                    return validated
                logger.warning("[DEPLOYMENT] terraform_template_rejected | issues=%s", issues)
            except TerraformError as exc:
                logger.warning("[DEPLOYMENT] terraform_template_rejected | error=%s", exc)

    # Only the previous attempt's errors are fed back: earlier ones were
    # already addressed (or repeated) by the attempt that followed them.
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
            errors = check_terraform_semantics(validated["files"], context)
            if not errors:
                errors = await asyncio.to_thread(terraform_validate_files, validated["files"])
            if not errors:
                logger.info("[DEPLOYMENT] terraform_artifact_generated | attempt=%d", attempt)
                return validated
            logger.warning(
                "[DEPLOYMENT] terraform_artifact_generation_retry | attempt=%d | error=%s",
                attempt, "; ".join(errors)[:500],
            )
        except LLMUnavailableError as exc:
            # The model server is down / misconfigured: retrying the same call
            # cannot help, and wrapping it as a parse error hides the cause.
            raise TerraformError(
                str(exc), error_kind="llm_unavailable", stage="artifact_generation",
                user_message=str(exc),
            ) from exc
        except TerraformError as exc:
            if exc.error_kind == "missing_binary":
                raise
            errors = [str(exc)]
            logger.warning(
                "[DEPLOYMENT] terraform_artifact_generation_retry | attempt=%d | error=%s",
                attempt, str(exc)[:500],
            )
        except Exception as exc:
            errors = [f"Generation response could not be parsed: {exc}"]
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
    # Database credentials are generated here, never by the model. RDS master
    # passwords may not contain / @ " or spaces, so stay alphanumeric. The
    # value lives only in this workspace's terraform.tfvars and state.
    if re.search(r'\bvariable\s+"(?:db_password|database_password)"', source):
        import secrets
        import string
        alphabet = string.ascii_letters + string.digits
        password = "".join(secrets.choice(alphabet) for _ in range(32))
        db_name = re.sub(r"[^a-z0-9]", "", project_slug)
        if not db_name or not db_name[0].isalpha():
            db_name = "app" + db_name
        defaults.update({
            "db_password": password,
            "database_password": password,
            "db_username": "appadmin",
            "database_username": "appadmin",
            "db_name": db_name[:30],
        })
    if re.search(r'\bvariable\s+"docdb_password"', source):
        import secrets
        import string
        alphabet = string.ascii_letters + string.digits
        docdb_name = re.sub(r"[^a-z0-9]", "", project_slug) or "app"
        defaults.update({
            "docdb_password": "".join(secrets.choice(alphabet) for _ in range(32)),
            "docdb_username": "appadmin",
            "docdb_name": docdb_name[:30],
        })
    # Credentials are always supplied by the platform, even when generated
    # Terraform declares a default: a model-chosen default such as "admin" is
    # a reserved RDS master username, and a default password would be guessable.
    platform_owned = {
        "db_password", "database_password", "db_username", "database_username", "db_name",
        "docdb_password", "docdb_username", "docdb_name",
    }
    values: dict[str, Any] = {}
    for match in re.finditer(r'\bvariable\s+"([^"]+)"\s*\{(.*?)\n\}', source, re.DOTALL):
        name, body = match.group(1), match.group(2)
        if re.search(r"\bdefault\s*=", body) and name not in platform_owned:
            continue
        if name in defaults and defaults[name] is not None:
            values[name] = defaults[name]
    return values


def resource_name_prefix(project_name: str, deployment_id: str | UUID) -> str:
    """Short, AWS-safe prefix unique to one deployment, e.g. "zxxcv-3b66a5".

    Lowercase letters/digits/hyphens and starting with a letter satisfies the
    strictest naming rules among the resources we generate (RDS identifiers),
    and leaves room under the 32-character ALB / target group limit.
    """
    slug = re.sub(r"[^a-z0-9]", "", project_name.lower())
    if not slug or not slug[0].isalpha():
        slug = "app" + slug
    return f"{slug[:10]}-{str(deployment_id).replace('-', '')[:6]}"


def _detect_data_services(analysis: dict[str, Any], targets: set[str]) -> set[str]:
    """Databases / caches the application depends on, from static analysis.

    Only strategies with server-side compute can use one: a static site served
    from S3 cannot open a database connection, whatever the analysis says.
    """
    if not targets & {"ecs_fargate", "ec2", "rds", "documentdb"}:
        return set()
    static = analysis.get("static") or {}
    containerization = static.get("containerization") or {}
    evidence = json.dumps([
        static.get("databases_orms"),
        containerization.get("databases_detected_from_compose"),
        containerization.get("docker_services"),
    ], default=str).lower()
    services: set[str] = set()
    if "postgres" in evidence:
        services.add("postgres")
    elif "mysql" in evidence or "mariadb" in evidence:
        services.add("mysql")
    elif "mongo" in evidence or "documentdb" in targets:
        # RDS has no MongoDB engine: MongoDB apps get Amazon DocumentDB.
        services.add("mongodb")
    elif "rds" in targets or analysis.get("has_database"):
        services.add("postgres")
    if "redis" in evidence:
        services.add("redis")
    return services


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
    strategy_json = getattr(deployment, "strategy_json", None) or {}
    targets = {
        str(c.get("target")) for c in strategy_json.get("components") or [] if isinstance(c, dict)
    }
    targets.add(str(strategy_json.get("primary_target") or ""))
    data_services = _detect_data_services(analysis, targets)
    required_outputs: list[str] = []
    if "ecs_fargate" in targets:
        required_outputs += ["ecs_cluster_name", "ecs_service_name", "alb_dns_name"]
    if "ec2" in targets:
        required_outputs.append("instance_public_ip")
    if "ecr" in targets or "ecs_fargate" in targets:
        required_outputs.append("ecr_repository_url")
    if data_services & {"postgres", "mysql"}:
        required_outputs.append("db_endpoint")
    if "redis" in data_services:
        required_outputs.append("redis_endpoint")
    if "mongodb" in data_services:
        required_outputs.append("mongodb_endpoint")
    static_hosting = artifacts.get("static_hosting") or "cloudfront"
    if "s3_cloudfront" in targets:
        required_outputs.append("s3_bucket_name")
        required_outputs += (
            ["website_url"] if static_hosting == "s3_website"
            else ["cloudfront_distribution_id", "cloudfront_domain_name"]
        )
    health_check_path = next(
        (str((c.get("health_check") or {}).get("path"))
         for c in strategy_json.get("components") or []
         if isinstance(c, dict) and c.get("target") == "ecs_fargate"
         and (c.get("health_check") or {}).get("path")),
        "/",
    )
    container_port = next(
        (int(app["port"]) for app in applications
         if isinstance(app, dict) and str(app.get("port") or "").isdigit()),
        8000,
    )

    return {
        "project_name": project.name,
        "project_id": str(project.id),
        "resource_name_prefix": resource_name_prefix(project.name, deployment.id),
        "required_data_services": sorted(data_services),
        "required_outputs": required_outputs,
        "container_port": container_port,
        "health_check_path": health_check_path,
        "static_hosting": static_hosting,
        "source_code_summary": source_summary,
        "analysis": analysis,
        "architecture": architecture,
        # The validated deployment strategy decides the AWS targets; the raw
        # analysis hint is only used for legacy deployments without one.
        "strategy": {
            "primary_target": strategy_json.get("primary_target"),
            "components": [
                {k: c.get(k) for k in ("name", "target", "component_type", "exposed_ports")}
                for c in strategy_json.get("components") or [] if isinstance(c, dict)
            ],
        } if strategy_json else (artifacts.get("strategy") or analysis.get("recommended_strategy")),
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


def set_db_engine_version(workspace: Path, resource_address: str | None, version: str) -> dict[str, str]:
    """Set engine_version on an aws_db_instance in the workspace and drop its
    parameter_group_name (a parameter group is tied to one major version).

    Returns the patched {filename: content} map. Raises TerraformError when the
    resource cannot be found or the version is malformed.
    """
    if not re.fullmatch(r"\d+(?:\.\d+)?", version or ""):
        raise TerraformError(f"Invalid engine version {version!r}.", error_kind="workspace_error")
    wanted = (resource_address or "").split(".", 1)[-1] if resource_address else None
    terraform_dir = workspace / "terraform"
    for path in sorted(terraform_dir.glob("*.tf")):
        source = path.read_text(encoding="utf-8")
        for match in _RESOURCE_DECLARATION.finditer(source):
            if match.group(1).lower() != "aws_db_instance" or (wanted and match.group(2) != wanted):
                continue
            body = _resource_block_body(source, match)
            start = source.find("{", match.start(), match.end()) + 1
            patched = re.sub(r'(?m)^\s*parameter_group_name\s*=.*\n', "", body)
            if re.search(r'\bengine_version\s*=', patched):
                patched = re.sub(r'(\bengine_version\s*=\s*)"[^"]*"', rf'\g<1>"{version}"', patched, count=1)
            else:
                patched = f'\n  engine_version = "{version}"' + patched
            source = source[:start] + patched + source[start + len(body):]
            path.write_text(source, encoding="utf-8")
            return {p.name: p.read_text(encoding="utf-8") for p in terraform_dir.glob("*.tf")}
    raise TerraformError(
        f"Could not find {resource_address or 'an aws_db_instance'} in the workspace.",
        error_kind="workspace_error",
    )


def set_db_username(workspace: Path, username: str) -> dict[str, str]:
    """Use `username` as the RDS master username: set it in terraform.tfvars
    (overrides any variable default) and replace a hardcoded literal.
    Returns the {filename: content} map of the .tf files."""
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,15}", username or ""):
        raise TerraformError(f"Invalid database username {username!r}.", error_kind="workspace_error")
    terraform_dir = workspace / "terraform"
    tfvars = terraform_dir / "terraform.tfvars"
    lines = tfvars.read_text(encoding="utf-8").splitlines() if tfvars.exists() else []
    lines = [line for line in lines if not re.match(r"\s*(?:db_username|database_username)\s*=", line)]
    lines += [f'db_username = "{username}"', f'database_username = "{username}"']
    declared = "\n".join(p.read_text(encoding="utf-8") for p in terraform_dir.glob("*.tf"))
    # tfvars may only set declared variables
    lines = [
        line for line in lines
        if not (m := re.match(r"\s*(\w+)\s*=", line)) or re.search(rf'\bvariable\s+"{m.group(1)}"', declared)
    ]
    tfvars.write_text("\n".join(lines) + "\n", encoding="utf-8")
    for path in terraform_dir.glob("*.tf"):
        source = path.read_text(encoding="utf-8")
        patched = re.sub(r'(\b(?:username|master_username)\s*=\s*)"[^"]*"', rf'\g<1>"{username}"', source)
        if patched != source:
            path.write_text(patched, encoding="utf-8")
    return {p.name: p.read_text(encoding="utf-8") for p in terraform_dir.glob("*.tf")}


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
    env = _with_plugin_cache(env)

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
    # Fingerprint only the planned changes. The full plan JSON contains volatile
    # metadata (e.g. top-level "timestamp") that differs on every run, which
    # would make the pre-apply verification re-plan always look "changed".
    fingerprint_source = {
        "resource_changes": [
            {
                "address": item.get("address"),
                "actions": (item.get("change") or {}).get("actions"),
                "before": (item.get("change") or {}).get("before"),
                "after": (item.get("change") or {}).get("after"),
                "after_unknown": (item.get("change") or {}).get("after_unknown"),
            }
            for item in plan.get("resource_changes") or []
        ],
        "output_changes": plan.get("output_changes") or {},
    }
    fingerprint = hashlib.sha256(
        json.dumps(fingerprint_source, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
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
    env = _with_plugin_cache(env)
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
