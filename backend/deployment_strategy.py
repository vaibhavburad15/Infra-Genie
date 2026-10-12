
from __future__ import annotations

import enum
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

logger = logging.getLogger(__name__)

# ── Strategy version ─────────────────────────────────────────────────────────
STRATEGY_VERSION = 1


# ── Allowed deployment targets (strict allowlist) ────────────────────────────

class DeploymentTarget(str, enum.Enum):
    """Every supported (or planned) deployment target.

    Only ACTIVE targets may proceed to Terraform planning.  PLANNED targets
    are shown to the user but immediately rejected if selected.  UNSUPPORTED
    targets must not reach planning.
    """
    ec2             = "ec2"
    ecs_fargate     = "ecs_fargate"
    s3_cloudfront   = "s3_cloudfront"
    eks             = "eks"
    rds             = "rds"
    documentdb      = "documentdb"  # MongoDB-compatible (RDS has no MongoDB engine)
    ecr             = "ecr"        # container registry — dependency, not standalone
    lambda_function = "lambda"
    unsupported     = "unsupported"


class TargetStatus(str, enum.Enum):
    active      = "active"       # fully implemented — may proceed to plan
    planned     = "planned"      # roadmap item — shown but blocked
    unsupported = "unsupported"  # cannot be deployed by this platform


# Registry: maps DeploymentTarget → its current support status.
# Update this table as each adapter is completed.
TARGET_REGISTRY: Dict[DeploymentTarget, TargetStatus] = {
    DeploymentTarget.ec2:             TargetStatus.active,
    DeploymentTarget.ecs_fargate:     TargetStatus.active,
    DeploymentTarget.s3_cloudfront:   TargetStatus.active,
    DeploymentTarget.rds:             TargetStatus.active,
    DeploymentTarget.documentdb:      TargetStatus.active,
    DeploymentTarget.ecr:             TargetStatus.active,
    DeploymentTarget.eks:             TargetStatus.planned,
    DeploymentTarget.lambda_function: TargetStatus.planned,
    DeploymentTarget.unsupported:     TargetStatus.unsupported,
}

# Human-readable labels for frontend display
TARGET_LABELS: Dict[DeploymentTarget, str] = {
    DeploymentTarget.ec2:             "Amazon EC2",
    DeploymentTarget.ecs_fargate:     "Amazon ECS Fargate",
    DeploymentTarget.s3_cloudfront:   "S3 + CloudFront (static website)",
    DeploymentTarget.eks:             "Amazon EKS (Kubernetes)",
    DeploymentTarget.rds:             "Amazon RDS (managed database)",
    DeploymentTarget.documentdb:      "Amazon DocumentDB (MongoDB-compatible)",
    DeploymentTarget.ecr:             "Amazon ECR (container registry)",
    DeploymentTarget.lambda_function: "AWS Lambda",
    DeploymentTarget.unsupported:     "Unsupported",
}


# ── Component types ───────────────────────────────────────────────────────────

class ComponentType(str, enum.Enum):
    static_web          = "static_web"
    containerized_api   = "containerized_api"
    containerized_web   = "containerized_web"
    virtual_machine     = "virtual_machine"
    kubernetes_workload = "kubernetes_workload"
    managed_database    = "managed_database"
    container_registry  = "container_registry"
    event_function      = "event_function"
    unknown             = "unknown"


class ArtifactType(str, enum.Enum):
    static_build    = "static_build"
    container_image = "container_image"
    vm_package      = "vm_package"
    k8s_manifests   = "k8s_manifests"
    source_only     = "source_only"
    none_required   = "none_required"


# ── Per-component health check expectation ───────────────────────────────────

class HealthCheckSpec(BaseModel):
    protocol: str = "http"           # http | tcp | none
    path: str = "/health"
    port: Optional[int] = None
    timeout_seconds: int = 300
    retry_count: int = 5
    expected_status: int = 200


# ── Single deployment component ───────────────────────────────────────────────

class DeploymentComponent(BaseModel):
    """One logical piece of the overall deployment (frontend, API, DB, etc.)."""

    name: str = Field(..., min_length=1, max_length=128)
    component_type: ComponentType
    target: DeploymentTarget
    artifact_type: ArtifactType
    dependencies: List[str] = Field(default_factory=list)  # names of other components
    health_check_required: bool = True
    health_check: Optional[HealthCheckSpec] = None

    # Runtime hints
    exposed_ports: List[int] = Field(default_factory=list)
    environment_variables: List[str] = Field(default_factory=list)  # names only, never values
    resource_requirements: Dict[str, Any] = Field(default_factory=dict)

    # Why this target was chosen
    rationale: str = ""
    assumptions: List[str] = Field(default_factory=list)

    @field_validator("target")
    @classmethod
    def target_must_be_known(cls, v: DeploymentTarget) -> DeploymentTarget:
        if v not in TARGET_REGISTRY:
            raise ValueError(f"Unknown deployment target: {v!r}")
        return v

    @property
    def target_status(self) -> TargetStatus:
        return TARGET_REGISTRY.get(self.target, TargetStatus.unsupported)

    @property
    def can_deploy(self) -> bool:
        return self.target_status == TargetStatus.active


# ── Cost estimate ─────────────────────────────────────────────────────────────

class CostEstimate(BaseModel):
    monthly_usd_low: Optional[float] = None
    monthly_usd_high: Optional[float] = None
    currency: str = "USD"
    assumptions: List[str] = Field(default_factory=list)
    disclaimer: str = (
        "This is a rough estimate only. Actual AWS charges depend on usage, "
        "data transfer, and other factors not captured here. "
        "Always check the AWS Pricing Calculator for authoritative figures."
    )


# ── Full deployment strategy ──────────────────────────────────────────────────

class DeploymentStrategy(BaseModel):
    """Complete, validated deployment strategy for one project.

    Produced by the strategy selector; persisted in Deployment.strategy_json.
    The strategy_digest ties plan artifacts back to the exact strategy that
    was used to generate them — any change invalidates existing plans.
    """

    strategy_version: int = STRATEGY_VERSION
    deployment_id: str
    project_id: str
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    components: List[DeploymentComponent] = Field(default_factory=list)

    # Top-level metadata
    primary_target: DeploymentTarget = DeploymentTarget.ec2
    description: str = ""
    rationale: str = ""
    limitations: List[str] = Field(default_factory=list)
    unsupported_requirements: List[str] = Field(default_factory=list)

    # Cost
    cost_estimate: Optional[CostEstimate] = None

    # Confidence
    confidence: str = "medium"   # high | medium | low
    unresolved_requirements: List[str] = Field(default_factory=list)

    # Validation
    is_valid: bool = False
    validation_errors: List[str] = Field(default_factory=list)
    requires_user_approval: bool = True

    # Computed digest (set by validate_and_digest())
    strategy_digest: Optional[str] = None

    @model_validator(mode="after")
    def check_component_dependencies(self) -> "DeploymentStrategy":
        names = {c.name for c in self.components}
        for comp in self.components:
            for dep in comp.dependencies:
                if dep not in names:
                    self.validation_errors.append(
                        f"Component '{comp.name}' depends on '{dep}' which is not defined."
                    )
        return self

    def validate_and_digest(self) -> "DeploymentStrategy":
        """Run full validation and compute a deterministic digest.

        Call this after constructing a strategy so that the digest captures
        the final validated state. Any downstream change to the strategy
        (e.g. a target override by the user) requires calling this again,
        which produces a new digest and invalidates any existing plan.
        """
        errors: List[str] = list(self.validation_errors)  # carry forward model-validator errors

        if not self.components:
            errors.append("Strategy has no components.")

        for comp in self.components:
            if comp.target_status == TargetStatus.unsupported:
                errors.append(
                    f"Component '{comp.name}' targets '{comp.target.value}' "
                    "which is not supported by this platform."
                )
            elif comp.target_status == TargetStatus.planned:
                errors.append(
                    f"Component '{comp.name}' targets '{comp.target.value}' "
                    "which is on the roadmap but not yet implemented. "
                    f"Label: {TARGET_LABELS[comp.target]}"
                )

        self.validation_errors = errors
        self.is_valid = len(errors) == 0

        # Digest: stable hash of component targets + versions.
        # Intentionally excludes rationale / description so cosmetic edits
        # do not invalidate an existing plan.
        digest_payload = {
            "strategy_version": self.strategy_version,
            "deployment_id": self.deployment_id,
            "components": [
                {
                    "name": c.name,
                    "component_type": c.component_type.value,
                    "target": c.target.value,
                    "artifact_type": c.artifact_type.value,
                    "dependencies": sorted(c.dependencies),
                    "exposed_ports": sorted(c.exposed_ports),
                }
                for c in self.components
            ],
        }
        self.strategy_digest = hashlib.sha256(
            json.dumps(digest_payload, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

        return self

    def to_db_json(self) -> Dict[str, Any]:
        """Serialise to a dict suitable for JSON column storage."""
        return self.model_dump(mode="json")

    @classmethod
    def from_db_json(cls, data: Dict[str, Any]) -> "DeploymentStrategy":
        return cls.model_validate(data)


# ── Strategy selector ─────────────────────────────────────────────────────────

def _has_k8s(static: Dict[str, Any]) -> bool:
    """True if the project contains Kubernetes manifests or Helm charts."""
    k8s = static.get("kubernetes", {}) or {}
    if k8s.get("has_manifests") or k8s.get("has_helm"):
        return True
    # Some analyzers report it inside containerization
    container = static.get("containerization", {}) or {}
    return bool(container.get("has_k8s") or container.get("has_helm"))


def _has_dockerfile(static: Dict[str, Any]) -> bool:
    container = static.get("containerization", {}) or {}
    return bool(container.get("has_dockerfile"))


# Server frameworks the application deploy step can containerize without a
# repository Dockerfile (see deployment_adapter._synthesize_dockerfile).
_CONTAINERIZABLE_FRAMEWORKS = ("fastapi", "flask", "express", "nest", "koa", "fastify")


def _can_containerize(static: Dict[str, Any]) -> bool:
    names = [str((static.get("summary") or {}).get("primary_framework") or "")]
    names += [str(f.get("name") or "") for f in static.get("frameworks") or [] if isinstance(f, dict)]
    text = " ".join(names).lower()
    return any(fw in text for fw in _CONTAINERIZABLE_FRAMEWORKS)


def _has_database(static: Dict[str, Any]) -> bool:
    return bool(static.get("has_database_hint") or static.get("databases_orms"))


def _is_static_frontend(static: Dict[str, Any]) -> bool:
    """True when the project is a pure static frontend (no server-side code)."""
    summary = static.get("summary", {}) or {}
    lang = (summary.get("primary_language") or "").lower()
    fw = (summary.get("primary_framework") or "").lower()
    # TypeScript/JavaScript projects with React/Vue/Vite that have NO Dockerfile
    # and no Python/Go/Java/Rust are good static-site candidates.
    server_langs = {"python", "go", "java", "rust", "c#", "ruby", "php", "elixir"}
    if lang in server_langs:
        return False
    static_fws = {"react", "vue", "vite", "next", "nuxt", "angular", "svelte"}
    fw_hit = any(s in fw for s in static_fws)
    if not fw_hit:
        return False
    # Must not have a Dockerfile (that would imply a server component)
    return not _has_dockerfile(static)


_FRONTEND_FRAMEWORKS = ("react", "vue", "angular", "svelte", "next", "nuxt")
_BACKEND_FRAMEWORKS = ("fastapi", "flask", "django", "express", "nest", "koa", "fastify",
                       "spring", "rails", "laravel", "gin")
_SERVER_LANGUAGES = {"python", "go", "java", "rust", "c#", "ruby", "php", "elixir"}


def _is_fullstack(static: Dict[str, Any]) -> bool:
    """True when the analysis found both a frontend framework and a backend
    (a backend framework or a server-side language) anywhere in the project,
    not only as the primary language/framework — monorepos such as
    frontend/ + backend/ are usually primarily TypeScript."""
    summary = static.get("summary", {}) or {}
    names = [str(summary.get("primary_framework") or "").lower()]
    names += [str(f.get("name") or "").lower() for f in static.get("frameworks") or [] if isinstance(f, dict)]
    languages = {str(summary.get("primary_language") or "").lower()}
    languages |= {str(l.get("name") or "").lower() for l in static.get("languages") or [] if isinstance(l, dict)}
    has_frontend = any(fe in name for name in names for fe in _FRONTEND_FRAMEWORKS)
    has_backend = bool(languages & _SERVER_LANGUAGES) or any(
        be in name for name in names for be in _BACKEND_FRAMEWORKS
    )
    return has_frontend and has_backend


def _database_component(static: Dict[str, Any]) -> DeploymentComponent:
    """Managed database matching the engine the project uses. MongoDB apps get
    Amazon DocumentDB (RDS has no MongoDB engine); otherwise RDS."""
    evidence = str([static.get("databases_orms"),
                    (static.get("containerization") or {}).get("databases_detected_from_compose")]).lower()
    target = DeploymentTarget.rds
    if "mongo" in evidence and "postgres" not in evidence and "mysql" not in evidence:
        target = DeploymentTarget.documentdb
        port, rationale = 27017, (
            "MongoDB dependency detected. RDS has no MongoDB engine, so the database is "
            "Amazon DocumentDB (MongoDB-compatible) in a private subnet."
        )
        assumptions = ["MongoDB 5.0 API (DocumentDB); retryable writes are not supported.",
                       "TLS is off; only the application's security group can reach it."]
    elif "mysql" in evidence or "mariadb" in evidence:
        port, rationale = 3306, "MySQL dependency detected. RDS MySQL in a private subnet."
        assumptions = ["Not publicly accessible."]
    else:
        port, rationale = 5432, "Database dependency detected. RDS PostgreSQL in a private subnet."
        assumptions = ["PostgreSQL assumed unless MySQL or MongoDB is detected.", "Not publicly accessible."]
    return DeploymentComponent(
        name="database",
        component_type=ComponentType.managed_database,
        target=target,
        artifact_type=ArtifactType.none_required,
        dependencies=[],
        # Private by design: the worker cannot reach it. The application's
        # own health check proves the database connection instead.
        health_check_required=False,
        health_check=HealthCheckSpec(protocol="tcp", port=port, timeout_seconds=300),
        rationale=rationale,
        assumptions=assumptions,
    )


def select_strategy(
    deployment_id: str,
    project_id: str,
    static_analysis: Dict[str, Any],
    analysis_result: Optional[Dict[str, Any]] = None,
    deployment_plan: Optional[Dict[str, Any]] = None,
) -> DeploymentStrategy:
    """Derive a validated deployment strategy from the project's static analysis.

    This is a deterministic function — the LLM analysis_result is used only as
    supplementary context to improve descriptions, not to determine targets.
    All target decisions are based on the deterministic static_analysis output.

    The returned strategy is fully validated. Check strategy.is_valid and
    strategy.validation_errors before proceeding to planning.
    """
    summary = (static_analysis or {}).get("summary", {}) or {}
    components: List[DeploymentComponent] = []
    limitations: List[str] = []
    unsupported_reqs: List[str] = []
    primary_target = DeploymentTarget.ec2

    # A repository Dockerfile, or a server framework we can build an image for.
    has_docker = _has_dockerfile(static_analysis or {}) or _can_containerize(static_analysis or {})
    has_k8s    = _has_k8s(static_analysis or {})
    has_db     = _has_database(static_analysis or {})
    is_static  = _is_static_frontend(static_analysis or {})
    is_full    = _is_fullstack(static_analysis or {})

    lang = (summary.get("primary_language") or "unknown").lower()
    fw   = (summary.get("primary_framework") or "").lower()

    logger.info(
        "[STRATEGY] select | deployment_id=%s | lang=%s | fw=%s | "
        "has_docker=%s | has_k8s=%s | has_db=%s | is_static=%s | is_full=%s",
        deployment_id, lang, fw, has_docker, has_k8s, has_db, is_static, is_full,
    )

    # ── Decision tree ─────────────────────────────────────────────────────────

    if has_k8s:
        # EKS is on the roadmap — tell the user why it can't deploy yet
        components.append(DeploymentComponent(
            name="kubernetes-workload",
            component_type=ComponentType.kubernetes_workload,
            target=DeploymentTarget.eks,
            artifact_type=ArtifactType.k8s_manifests,
            rationale="Project contains Kubernetes manifests or Helm charts.",
            assumptions=["Requires an EKS cluster (planned, not yet implemented)."],
        ))
        limitations.append(
            "EKS deployment is on the Infra Genie roadmap but not yet available. "
            "Select a different deployment target or contact support."
        )
        primary_target = DeploymentTarget.eks

    elif is_static and not is_full:
        # Pure static frontend — S3 + CloudFront
        components.append(DeploymentComponent(
            name="frontend",
            component_type=ComponentType.static_web,
            target=DeploymentTarget.s3_cloudfront,
            artifact_type=ArtifactType.static_build,
            health_check_required=True,
            health_check=HealthCheckSpec(protocol="http", path="/", timeout_seconds=120),
            exposed_ports=[443, 80],
            rationale=(
                "Static frontend project (no Dockerfile, no server-side language). "
                "S3 + CloudFront is the cost-efficient standard for static sites."
            ),
        ))
        primary_target = DeploymentTarget.s3_cloudfront

    elif is_full and has_docker:
        # Full-stack with Docker — frontend on S3+CF, backend on ECS Fargate
        primary_target = DeploymentTarget.ecs_fargate
        components.append(DeploymentComponent(
            name="backend",
            component_type=ComponentType.containerized_api,
            target=DeploymentTarget.ecs_fargate,
            artifact_type=ArtifactType.container_image,
            dependencies=["database"] if has_db else [],
            health_check_required=True,
            health_check=HealthCheckSpec(protocol="http", path="/health", port=8000),
            exposed_ports=[8000, 80, 443],
            rationale=(
                "Containerised backend API. ECS Fargate removes the need to manage "
                "EC2 instances while supporting any Docker workload."
            ),
        ))
        # ECR for the container image
        components.append(DeploymentComponent(
            name="registry",
            component_type=ComponentType.container_registry,
            target=DeploymentTarget.ecr,
            artifact_type=ArtifactType.none_required,
            dependencies=[],
            health_check_required=False,
            rationale="Amazon ECR stores the container image for ECS Fargate.",
        ))
        # Frontend: static build on S3 + CloudFront, built against the
        # backend's public URL (so it deploys after the backend).
        components.append(DeploymentComponent(
            name="frontend",
            component_type=ComponentType.static_web,
            target=DeploymentTarget.s3_cloudfront,
            artifact_type=ArtifactType.static_build,
            dependencies=["backend"],
            health_check_required=True,
            health_check=HealthCheckSpec(protocol="http", path="/", timeout_seconds=300),
            exposed_ports=[443, 80],
            rationale=(
                "Frontend built to static files and served from S3 + CloudFront; "
                "it calls the backend through the backend's public URL."
            ),
        ))
        if has_db:
            components.append(_database_component(static_analysis or {}))

    elif has_docker:
        # Docker but not full-stack — ECS Fargate
        primary_target = DeploymentTarget.ecs_fargate
        components.append(DeploymentComponent(
            name="app",
            component_type=ComponentType.containerized_web,
            target=DeploymentTarget.ecs_fargate,
            artifact_type=ArtifactType.container_image,
            dependencies=["database"] if has_db else [],
            health_check_required=True,
            health_check=HealthCheckSpec(protocol="http", path="/health", timeout_seconds=300),
            exposed_ports=[80, 443, 8000],
            rationale=(
                "Dockerised application. ECS Fargate is the recommended managed "
                "container platform for projects that don't require Kubernetes features."
            ),
        ))
        components.append(DeploymentComponent(
            name="registry",
            component_type=ComponentType.container_registry,
            target=DeploymentTarget.ecr,
            artifact_type=ArtifactType.none_required,
            dependencies=[],
            health_check_required=False,
            rationale="Amazon ECR stores the container image.",
        ))
        if has_db:
            components.append(_database_component(static_analysis or {}))

    else:
        # No Docker, no K8s, no clear static site — EC2 general workload
        primary_target = DeploymentTarget.ec2
        components.append(DeploymentComponent(
            name="app",
            component_type=ComponentType.virtual_machine,
            target=DeploymentTarget.ec2,
            artifact_type=ArtifactType.source_only,
            dependencies=["database"] if has_db else [],
            health_check_required=True,
            health_check=HealthCheckSpec(protocol="http", path="/", timeout_seconds=300),
            exposed_ports=[80, 443],
            rationale=(
                f"No Dockerfile or Kubernetes manifests found. "
                f"EC2 provides a general-purpose VM for a {lang} application."
            ),
            assumptions=[
                "A compatible runtime will be installed via cloud-init.",
                f"Primary language detected: {lang}.",
            ],
        ))
        if has_db:
            components.append(_database_component(static_analysis or {}))

    # ── Rough cost estimate ───────────────────────────────────────────────────
    cost = _estimate_cost(components)

    strategy = DeploymentStrategy(
        strategy_version=STRATEGY_VERSION,
        deployment_id=deployment_id,
        project_id=project_id,
        components=components,
        primary_target=primary_target,
        description=_describe_strategy(primary_target, components),
        rationale=f"Derived from static analysis: lang={lang}, fw={fw}, "
                  f"has_docker={has_docker}, has_k8s={has_k8s}.",
        limitations=limitations,
        unsupported_requirements=unsupported_reqs,
        cost_estimate=cost,
        confidence="high" if (has_docker or is_static) else "medium",
        unresolved_requirements=_unresolved(static_analysis or {}),
    )

    return strategy.validate_and_digest()


def _describe_strategy(target: DeploymentTarget, components: List[DeploymentComponent]) -> str:
    label = TARGET_LABELS.get(target, target.value)
    names = [c.name for c in components]
    return f"{label} deployment with {len(components)} component(s): {', '.join(names)}."


def _estimate_cost(components: List[DeploymentComponent]) -> CostEstimate:
    low = 0.0
    high = 0.0
    assumptions: List[str] = []
    for comp in components:
        t = comp.target
        if t == DeploymentTarget.ec2:
            low += 8.0; high += 35.0
            assumptions.append("EC2: t3.micro–t3.small, on-demand pricing, us-east-1.")
        elif t == DeploymentTarget.ecs_fargate:
            low += 12.0; high += 50.0
            assumptions.append("ECS Fargate: 0.25 vCPU / 512 MB, minimal traffic.")
        elif t == DeploymentTarget.s3_cloudfront:
            low += 1.0; high += 10.0
            assumptions.append("S3+CloudFront: 1 GB storage, 10 GB/mo transfer.")
        elif t == DeploymentTarget.rds:
            low += 15.0; high += 60.0
            assumptions.append("RDS: db.t3.micro PostgreSQL, 20 GB storage, single-AZ.")
        elif t == DeploymentTarget.documentdb:
            low += 60.0; high += 90.0
            assumptions.append("DocumentDB: one db.t4g.medium instance, storage and I/O billed separately.")
        elif t == DeploymentTarget.ecr:
            low += 0.5; high += 2.0
            assumptions.append("ECR: up to 1 GB image storage.")
    return CostEstimate(
        monthly_usd_low=round(low, 2),
        monthly_usd_high=round(high, 2),
        assumptions=assumptions,
    )


def _unresolved(static: Dict[str, Any]) -> List[str]:
    reqs: List[str] = []
    summary = (static.get("summary") or {})
    if not summary.get("primary_language"):
        reqs.append("Primary programming language could not be detected.")
    if not summary.get("primary_framework"):
        reqs.append("Primary framework could not be detected — review target selection.")
    return reqs


# ── Guard: reject unsupported targets before planning ────────────────────────

def assert_strategy_deployable(strategy: DeploymentStrategy) -> None:
    """Raise ValueError if the strategy cannot proceed to Terraform planning.

    Called by the planning task before any infrastructure work begins.
    """
    if not strategy.is_valid:
        raise ValueError(
            "Deployment strategy validation failed: "
            + "; ".join(strategy.validation_errors)
        )
    blocked = [
        c for c in strategy.components
        if c.target_status != TargetStatus.active
    ]
    if blocked:
        messages = []
        for c in blocked:
            status = c.target_status.value
            label = TARGET_LABELS.get(c.target, c.target.value)
            messages.append(
                f"Component '{c.name}' targets '{label}' [{status}]. "
                "This target cannot be deployed at this time."
            )
        raise ValueError(
            "One or more deployment targets are not available: " + " | ".join(messages)
        )
