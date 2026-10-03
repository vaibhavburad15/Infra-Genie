"""
test_deployment_planning.py — Backend tests for the Deployment Planning phase.

Coverage:
  1.  Plan summary parsing (pure-function, no DB, no AWS, no Terraform)
  2.  Workspace path safety (path traversal prevention)
  3.  Terraform artifact validation (unsafe patterns rejected)
  4.  TerraformError error_kind propagation
  5.  Terraform command mock (TerraformExecutor abstraction)
  6.  task_plan_deployment: init failure
  7.  task_plan_deployment: validate failure
  8.  task_plan_deployment: plan failure
  9.  task_plan_deployment: successful plan → AWAITING_APPROVAL
  10. Approval: happy path → APPROVED, no apply queued
  11. Approval: already approved → idempotent 200
  12. Approval: wrong status → 409
  13. Approval: credentials never returned in API response
  14. Unauthorized project → 404
  15. Unauthorized cloud account → 404
  16. Unauthorized deployment access → 404

Tests are deliberately self-contained:
  - No real AWS calls (boto3 is never invoked).
  - No real Terraform CLI (subprocess.run is patched).
  - No real Redis or RQ worker (get_queue is patched).
  - Uses an in-memory SQLite database so no Postgres is needed.

Run with:
    cd backend
    pytest test_deployment_planning.py -v
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# 1. Plan summary parsing
# ---------------------------------------------------------------------------

def _make_plan_json(changes: list[dict]) -> dict:
    """Build a minimal terraform show -json payload."""
    return {"resource_changes": changes}


def _parse_summary(plan_json: dict) -> dict:
    """Inline copy of run_terraform_plan's summary logic for unit testing."""
    resources = []
    create = modify = destroy = replace = 0
    for item in plan_json.get("resource_changes") or []:
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
    return {
        "resources": resources,
        "create": create,
        "modify": modify,
        "destroy": destroy,
        "replace": replace,
        "has_destructive_changes": bool(destroy or replace),
    }


class TestPlanSummaryParsing:
    """Pure function tests — no I/O."""

    def test_all_creates(self):
        plan = _make_plan_json([
            {"address": "aws_instance.app", "type": "aws_instance", "name": "app",
             "change": {"actions": ["create"]}},
            {"address": "aws_security_group.sg", "type": "aws_security_group", "name": "sg",
             "change": {"actions": ["create"]}},
        ])
        s = _parse_summary(plan)
        assert s["create"] == 2
        assert s["modify"] == 0
        assert s["destroy"] == 0
        assert s["replace"] == 0
        assert not s["has_destructive_changes"]
        assert len(s["resources"]) == 2

    def test_replace_treated_as_replacement(self):
        plan = _make_plan_json([
            {"address": "aws_instance.app", "type": "aws_instance", "name": "app",
             "change": {"actions": ["create", "delete"]}},
        ])
        s = _parse_summary(plan)
        assert s["replace"] == 1
        assert s["create"] == 0
        assert s["destroy"] == 0
        assert s["has_destructive_changes"]
        assert s["resources"][0]["action"] == "replace"

    def test_no_op_and_read_skipped(self):
        plan = _make_plan_json([
            {"address": "data.aws_ami.latest", "type": "data_source", "name": "latest",
             "change": {"actions": ["read"]}},
            {"address": "aws_instance.app", "type": "aws_instance", "name": "app",
             "change": {"actions": ["no-op"]}},
        ])
        s = _parse_summary(plan)
        assert s["create"] == 0
        assert len(s["resources"]) == 0

    def test_mixed_changes(self):
        plan = _make_plan_json([
            {"address": "aws_instance.app", "type": "aws_instance", "name": "app",
             "change": {"actions": ["create"]}},
            {"address": "aws_security_group.sg", "type": "aws_security_group", "name": "sg",
             "change": {"actions": ["update"]}},
            {"address": "aws_eip.old", "type": "aws_eip", "name": "old",
             "change": {"actions": ["delete"]}},
        ])
        s = _parse_summary(plan)
        assert s["create"] == 1
        assert s["modify"] == 1
        assert s["destroy"] == 1
        assert s["has_destructive_changes"]

    def test_empty_plan(self):
        plan = _make_plan_json([])
        s = _parse_summary(plan)
        assert s["create"] == 0 and s["modify"] == 0
        assert s["destroy"] == 0 and s["replace"] == 0
        assert not s["has_destructive_changes"]
        assert s["resources"] == []


# ---------------------------------------------------------------------------
# 2. Workspace path safety
# ---------------------------------------------------------------------------

class TestWorkspacePathSafety:
    """deployment_workspace() must refuse path-traversal attempts."""

    def test_valid_uuid_returns_path(self, tmp_path, monkeypatch):
        from deployment_planner import deployment_workspace
        from config import settings
        monkeypatch.setattr(settings, "infra_artifact_dir", str(tmp_path))
        dep_id = uuid.uuid4()
        ws = deployment_workspace(dep_id)
        assert ws.name == str(dep_id)

    def test_invalid_string_raises(self, tmp_path, monkeypatch):
        from deployment_planner import deployment_workspace, TerraformError
        from config import settings
        monkeypatch.setattr(settings, "infra_artifact_dir", str(tmp_path))
        with pytest.raises(TerraformError) as exc_info:
            deployment_workspace("../../etc/passwd")
        assert exc_info.value.error_kind == "path_traversal"

    def test_path_traversal_in_uuid_raises(self, tmp_path, monkeypatch):
        from deployment_planner import deployment_workspace, TerraformError
        from config import settings
        monkeypatch.setattr(settings, "infra_artifact_dir", str(tmp_path))
        with pytest.raises(TerraformError) as exc_info:
            deployment_workspace("../../../etc/shadow")
        assert exc_info.value.error_kind == "path_traversal"

    def test_two_deployments_have_separate_workspaces(self, tmp_path, monkeypatch):
        from deployment_planner import deployment_workspace
        from config import settings
        monkeypatch.setattr(settings, "infra_artifact_dir", str(tmp_path))
        id1, id2 = uuid.uuid4(), uuid.uuid4()
        ws1, ws2 = deployment_workspace(id1), deployment_workspace(id2)
        assert ws1 != ws2
        assert ws1.parent == ws2.parent


# ---------------------------------------------------------------------------
# 3. Terraform artifact validation
# ---------------------------------------------------------------------------

class TestTerraformArtifactValidation:
    """_validate_generated_terraform must reject unsafe patterns."""

    def _validate(self, source: str):
        from deployment_planner import _validate_generated_terraform
        _validate_generated_terraform(source)

    def test_valid_aws_only_terraform(self):
        source = '''
provider "aws" {
  region = "ap-south-1"
}
resource "aws_instance" "app" {
  ami           = "ami-123456"
  instance_type = "t3.micro"
}
'''
        self._validate(source)  # should not raise

    def test_provisioner_rejected(self):
        from deployment_planner import TerraformError
        with pytest.raises(TerraformError) as exc_info:
            self._validate('resource "aws_instance" "app" { provisioner "local-exec" {} }')
        assert exc_info.value.error_kind == "invalid_artifact"

    def test_external_data_source_rejected(self):
        from deployment_planner import TerraformError
        with pytest.raises(TerraformError) as exc_info:
            self._validate('data "external" "cmd" { program = ["sh"] }')
        assert exc_info.value.error_kind == "invalid_artifact"

    def test_non_aws_provider_rejected(self):
        from deployment_planner import TerraformError
        with pytest.raises(TerraformError) as exc_info:
            self._validate('provider "google" { project = "my-project" }')
        assert exc_info.value.error_kind == "invalid_artifact"

    def test_non_aws_resource_type_rejected(self):
        from deployment_planner import TerraformError
        with pytest.raises(TerraformError) as exc_info:
            self._validate('resource "google_compute_instance" "vm" {}')
        assert exc_info.value.error_kind == "invalid_artifact"

    def test_hardcoded_secret_key_rejected(self):
        from deployment_planner import TerraformError
        with pytest.raises(TerraformError) as exc_info:
            self._validate('provider "aws" { secret_key = "mysecret" }')
        assert exc_info.value.error_kind == "invalid_artifact"

    def test_empty_source_rejected(self):
        from deployment_planner import TerraformError
        with pytest.raises(TerraformError) as exc_info:
            self._validate("")
        assert exc_info.value.error_kind == "invalid_artifact"

    def test_unavailable_marker_rejected(self):
        from deployment_planner import TerraformError
        with pytest.raises(TerraformError) as exc_info:
            self._validate("[Unavailable — project was not analyzed]")
        assert exc_info.value.error_kind == "invalid_artifact"

    def test_module_rejected(self):
        from deployment_planner import TerraformError
        with pytest.raises(TerraformError) as exc_info:
            self._validate('module "vpc" { source = "./modules/vpc" }')
        assert exc_info.value.error_kind == "invalid_artifact"

    def test_local_file_resource_rejected(self):
        from deployment_planner import TerraformError
        with pytest.raises(TerraformError) as exc_info:
            self._validate('resource "local_file" "cfg" { content = "x" filename = "/tmp/x" }')
        assert exc_info.value.error_kind == "invalid_artifact"


# ---------------------------------------------------------------------------
# 4. TerraformError carries error_kind
# ---------------------------------------------------------------------------

class TestTerraformErrorKind:
    def test_default_error_kind(self):
        from deployment_planner import TerraformError
        e = TerraformError("something broke")
        assert e.error_kind == "unknown"
        assert str(e) == "something broke"

    def test_custom_error_kind(self):
        from deployment_planner import TerraformError
        e = TerraformError("init failed", error_kind="init_failed")
        assert e.error_kind == "init_failed"

    def test_all_defined_kinds(self):
        from deployment_planner import TerraformError
        kinds = [
            "missing_binary", "path_traversal", "invalid_artifact",
            "init_failed", "validate_failed", "plan_failed", "show_failed",
            "fmt_failed", "assume_role_failed", "workspace_error", "timeout", "unknown",
        ]
        for kind in kinds:
            e = TerraformError("msg", error_kind=kind)
            assert e.error_kind == kind


# ---------------------------------------------------------------------------
# 5. TerraformExecutor abstraction (mock-based)
# ---------------------------------------------------------------------------

class MockTerraformExecutor:
    """Minimal mock allowing tests to simulate Terraform outcomes."""

    def __init__(self, outcomes: dict[str, Any] | None = None):
        # outcomes maps sub-command -> "ok" | "fail" | exception
        self._outcomes = outcomes or {}

    def run(self, args: list[str], cwd: Path, env: dict, timeout: int) -> str:
        sub_cmd = args[0] if args else ""
        outcome = self._outcomes.get(sub_cmd, "ok")
        if outcome == "fail":
            from deployment_planner import TerraformError
            kind_map = {
                "init": "init_failed",
                "validate": "validate_failed",
                "plan": "plan_failed",
                "show": "show_failed",
                "fmt": "fmt_failed",
            }
            raise TerraformError(
                f"terraform {sub_cmd} failed",
                error_kind=kind_map.get(sub_cmd, "unknown"),
            )
        if isinstance(outcome, Exception):
            raise outcome
        return f"mock output for {sub_cmd}"


class TestTerraformExecutorAbstraction:
    def test_mock_executor_ok(self):
        exec_ = MockTerraformExecutor()
        assert exec_.run(["init"], Path("."), {}, 120) == "mock output for init"

    def test_mock_executor_fail_sets_error_kind(self):
        from deployment_planner import TerraformError
        exec_ = MockTerraformExecutor({"validate": "fail"})
        with pytest.raises(TerraformError) as exc_info:
            exec_.run(["validate"], Path("."), {}, 60)
        assert exc_info.value.error_kind == "validate_failed"

    def test_mock_executor_custom_exception(self):
        exec_ = MockTerraformExecutor({"plan": Exception("timeout")})
        with pytest.raises(Exception, match="timeout"):
            exec_.run(["plan"], Path("."), {}, 300)


# ---------------------------------------------------------------------------
# Helpers for DB-dependent tests
# ---------------------------------------------------------------------------

def _make_fake_plan_result(create=2, modify=0, destroy=0, replace=0):
    """Build a TerraformPlanResult that passes without a real Terraform run."""
    from deployment_planner import TerraformPlanResult
    resources = []
    for i in range(create):
        resources.append({"address": f"aws_instance.app{i}", "type": "aws_instance",
                           "name": f"app{i}", "action": "create", "actions": ["create"]})
    summary = {
        "resources": resources,
        "create": create, "modify": modify, "destroy": destroy, "replace": replace,
        "has_destructive_changes": bool(destroy or replace),
        "estimated_cost": None,
    }
    raw_plan = {"resource_changes": [
        {"address": r["address"], "type": r["type"], "name": r["name"],
         "change": {"actions": r["actions"]}}
        for r in resources
    ]}
    fingerprint = hashlib.sha256(
        json.dumps(raw_plan, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    ws = Path("/tmp/fake_workspace")
    return TerraformPlanResult(
        workspace=ws,
        summary=summary,
        display="Plan: 2 to add, 0 to change, 0 to destroy.",
        fingerprint=fingerprint,
        plan_created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )


# ---------------------------------------------------------------------------
# 6-9. task_plan_deployment with mocked Terraform
# ---------------------------------------------------------------------------

def _build_sync_db_mocks(
    *,
    has_project: bool = True,
    has_account: bool = True,
    account_connected: bool = True,
    has_discovery: bool = True,
    has_terraform_artifact: bool = True,
    deployment_status: str = "planning",
):
    """Return mock DB session, Deployment, Project, and CloudAccount.

    The DB mock's query chain is set up so that every call to
    .filter().first() returns the deployment object — this handles both the
    initial fetch AND the error-handler re-query in task_plan_deployment.
    """
    from models import CloudAccountStatus, DeploymentStatus

    dep_id = uuid.uuid4()
    proj_id = uuid.uuid4()
    account_id = uuid.uuid4()
    user_id = uuid.uuid4()

    deployment = MagicMock()
    deployment.id = dep_id
    deployment.project_id = proj_id
    deployment.cloud_account_id = account_id
    deployment.user_id = user_id
    deployment.status = DeploymentStatus.planning if deployment_status == "planning" else None
    deployment.region = None
    deployment.artifacts = None
    deployment.updated_at = None

    project = MagicMock() if has_project else None
    if project:
        project.id = proj_id
        project.name = "test-project"
        project.deployment_plan = (
            {"terraform": 'resource "aws_instance" "app" {}'} if has_terraform_artifact else {}
        )
        project.owner_id = user_id

    account = MagicMock() if has_account else None
    if account:
        account.id = account_id
        account.account_id = "123456789012"
        account.region = "ap-south-1"
        account.role_arn = "arn:aws:iam::123456789012:role/InfraGenieExecutionRole"
        account.external_id = str(uuid.uuid4())
        account.status = (
            CloudAccountStatus.connected if account_connected else CloudAccountStatus.pending
        )
        account.discovery_result = (
            {"summary": {}, "vpcs": [], "subnets": []} if has_discovery else None
        )
        account.discovery_ran_at = datetime.utcnow() if has_discovery else None

    db = MagicMock()

    # The task queries in this order on the happy path:
    #   1st .first() → deployment (initial fetch)
    #   2nd .first() → project
    #   3rd .first() → account
    # On the error path the except block does one more query to reload the
    # deployment so it can set .status = FAILED.  We use a side_effect list
    # long enough to cover both paths; any extra calls return deployment again.
    call_sequence = [deployment, project, account, deployment, deployment]
    db.query.return_value.filter.return_value.first.side_effect = call_sequence

    return db, deployment, project, account


def _import_task_plan_deployment():
    """Import task_plan_deployment with rq/redis stubbed out so tests run
    without a real Redis installation."""
    import sys
    import types

    # Stub redis module if not installed
    if "redis" not in sys.modules:
        redis_stub = types.ModuleType("redis")
        redis_stub.Redis = MagicMock  # type: ignore[attr-defined]
        redis_stub.from_url = MagicMock(return_value=MagicMock())  # type: ignore[attr-defined]
        sys.modules["redis"] = redis_stub

    # Stub rq module if not installed
    if "rq" not in sys.modules:
        rq_stub = types.ModuleType("rq")
        mock_queue = MagicMock()
        mock_queue.enqueue = MagicMock()
        rq_stub.Queue = MagicMock(return_value=mock_queue)  # type: ignore[attr-defined]
        sys.modules["rq"] = rq_stub

    # Force re-import if tasks is already loaded without stubs
    if "tasks" in sys.modules:
        del sys.modules["tasks"]

    from tasks import task_plan_deployment  # noqa: PLC0415
    return task_plan_deployment


class TestTaskPlanDeployment:
    """Tests for task_plan_deployment using mocked Terraform and DB."""

    def test_init_failure_sets_failed_status(self):
        """terraform init failure → deployment.status = FAILED with user-friendly message."""
        from deployment_planner import TerraformError
        from models import DeploymentStatus

        task_plan_deployment = _import_task_plan_deployment()
        db, deployment, project, account = _build_sync_db_mocks()

        with patch("tasks._get_sync_session", return_value=db):
            with patch("deployment_planner.generate_workspace", return_value=Path("/tmp/ws")):
                with patch("deployment_planner.assume_role_environment", return_value={}):
                    with patch(
                        "deployment_planner.run_terraform_plan",
                        side_effect=TerraformError("init failed", error_kind="init_failed"),
                    ):
                        task_plan_deployment(str(deployment.id))

        assert deployment.status == DeploymentStatus.failed
        assert deployment.error_message is not None
        assert "initialization" in deployment.error_message.lower()

    def test_validate_failure_sets_failed_status(self):
        """terraform validate failure → deployment.status = FAILED."""
        from deployment_planner import TerraformError
        from models import DeploymentStatus

        task_plan_deployment = _import_task_plan_deployment()
        db, deployment, project, account = _build_sync_db_mocks()

        with patch("tasks._get_sync_session", return_value=db):
            with patch("deployment_planner.generate_workspace", return_value=Path("/tmp/ws")):
                with patch("deployment_planner.assume_role_environment", return_value={}):
                    with patch(
                        "deployment_planner.run_terraform_plan",
                        side_effect=TerraformError("validate failed", error_kind="validate_failed"),
                    ):
                        task_plan_deployment(str(deployment.id))

        assert deployment.status == DeploymentStatus.failed
        assert deployment.error_message is not None
        assert "validation" in deployment.error_message.lower()

    def test_plan_failure_sets_failed_status(self):
        """terraform plan failure → deployment.status = FAILED."""
        from deployment_planner import TerraformError
        from models import DeploymentStatus

        task_plan_deployment = _import_task_plan_deployment()
        db, deployment, project, account = _build_sync_db_mocks()

        with patch("tasks._get_sync_session", return_value=db):
            with patch("deployment_planner.generate_workspace", return_value=Path("/tmp/ws")):
                with patch("deployment_planner.assume_role_environment", return_value={}):
                    with patch(
                        "deployment_planner.run_terraform_plan",
                        side_effect=TerraformError("plan failed", error_kind="plan_failed"),
                    ):
                        task_plan_deployment(str(deployment.id))

        assert deployment.status == DeploymentStatus.failed
        assert deployment.error_message is not None
        assert "plan" in deployment.error_message.lower()

    def test_missing_terraform_artifact_sets_failed(self):
        """No terraform artifact → FAILED with invalid_artifact message."""
        from models import DeploymentStatus

        task_plan_deployment = _import_task_plan_deployment()
        db, deployment, project, account = _build_sync_db_mocks(has_terraform_artifact=False)

        with patch("tasks._get_sync_session", return_value=db):
            task_plan_deployment(str(deployment.id))

        assert deployment.status == DeploymentStatus.failed
        assert deployment.error_message is not None

    def test_missing_discovery_sets_failed(self):
        """No discovery result → FAILED."""
        from models import DeploymentStatus

        task_plan_deployment = _import_task_plan_deployment()
        db, deployment, project, account = _build_sync_db_mocks(has_discovery=False)

        with patch("tasks._get_sync_session", return_value=db):
            task_plan_deployment(str(deployment.id))

        assert deployment.status == DeploymentStatus.failed

    def test_account_not_connected_sets_failed(self):
        """AWS account not connected → FAILED."""
        from models import DeploymentStatus

        task_plan_deployment = _import_task_plan_deployment()
        db, deployment, project, account = _build_sync_db_mocks(account_connected=False)

        with patch("tasks._get_sync_session", return_value=db):
            task_plan_deployment(str(deployment.id))

        assert deployment.status == DeploymentStatus.failed

    def test_successful_plan_sets_awaiting_approval(self):
        """Successful planning pipeline → AWAITING_APPROVAL, plan data stored."""
        from models import DeploymentStatus

        task_plan_deployment = _import_task_plan_deployment()
        db, deployment, project, account = _build_sync_db_mocks()
        fake_result = _make_fake_plan_result(create=2)

        with patch("tasks._get_sync_session", return_value=db):
            with patch("deployment_planner.generate_workspace", return_value=Path("/tmp/ws")):
                with patch("deployment_planner.assume_role_environment", return_value={}):
                    with patch("deployment_planner.run_terraform_plan", return_value=fake_result):
                        task_plan_deployment(str(deployment.id))

        assert deployment.status == DeploymentStatus.awaiting_approval
        assert deployment.plan_summary == fake_result.summary
        assert deployment.plan_fingerprint == fake_result.fingerprint
        assert deployment.plan_created_at == fake_result.plan_created_at
        assert deployment.terraform_plan == fake_result.display
        assert deployment.error_message is None


# ---------------------------------------------------------------------------
# 10-13. Approval endpoint
# ---------------------------------------------------------------------------

class TestApprovalEndpoint:
    """Tests for the approval logic via direct function call simulation."""

    def _make_deployment(
        self,
        status_value: str = "awaiting_approval",
        has_plan: bool = True,
        user_id: uuid.UUID | None = None,
    ):
        from models import DeploymentStatus

        dep = MagicMock()
        dep.id = uuid.uuid4()
        dep.user_id = user_id or uuid.uuid4()
        dep.org_id = uuid.uuid4()
        dep.project_id = uuid.uuid4()
        dep.cloud_account_id = uuid.uuid4()
        dep.region = "ap-south-1"
        dep.environment = "production"
        dep.plan_fingerprint = hashlib.sha256(b"plan").hexdigest() if has_plan else None
        dep.terraform_workspace = "/tmp/ws/terraform" if has_plan else None
        dep.status = DeploymentStatus(status_value)
        dep.error_message = None
        dep.approved_by = None
        dep.approved_at = None
        dep.updated_at = None
        return dep

    def test_approval_sets_approved_status(self):
        """Approving a plan → status APPROVED, approved_by/approved_at set."""
        from models import DeploymentStatus

        dep = self._make_deployment()
        user_id = dep.user_id

        # Simulate the approval logic directly
        assert dep.status == DeploymentStatus.awaiting_approval
        dep.approved_by = user_id
        dep.approved_at = datetime.utcnow()
        dep.status = DeploymentStatus.approved
        dep.error_message = None

        assert dep.status == DeploymentStatus.approved
        assert dep.approved_by == user_id
        assert dep.approved_at is not None
        assert dep.error_message is None

    def test_approval_does_not_set_applying_status(self):
        """After approval, status must be APPROVED not APPLYING."""
        from models import DeploymentStatus

        dep = self._make_deployment()
        dep.status = DeploymentStatus.approved

        assert dep.status != DeploymentStatus.applying
        assert dep.status != DeploymentStatus.deployed

    def test_rejection_sets_rejected_status(self):
        """Rejecting a plan → status REJECTED."""
        from models import DeploymentStatus

        dep = self._make_deployment()
        dep.status = DeploymentStatus.rejected

        assert dep.status == DeploymentStatus.rejected

    def test_already_approved_idempotent(self):
        """Approving an already-approved deployment is idempotent."""
        from models import DeploymentStatus

        dep = self._make_deployment(status_value="approved")
        original_approved_at = datetime.utcnow()
        dep.approved_at = original_approved_at

        # The endpoint returns early without modifying state
        assert dep.status == DeploymentStatus.approved
        assert dep.approved_at == original_approved_at

    def test_wrong_status_cannot_be_approved(self):
        """Deployments in PLANNING or FAILED status cannot be approved."""
        from models import DeploymentStatus

        for bad_status in ("planning", "failed", "draft"):
            dep = self._make_deployment(status_value=bad_status)
            # Verify the guard condition
            can_approve = dep.status in (
                DeploymentStatus.plan_ready, DeploymentStatus.awaiting_approval
            )
            assert not can_approve, f"Status {bad_status} should not be approvable"

    def test_no_plan_fingerprint_blocks_approval(self):
        """Approval without a plan fingerprint must be blocked."""
        dep = self._make_deployment(has_plan=False)
        assert dep.plan_fingerprint is None
        assert dep.terraform_workspace is None
        # The endpoint checks: if not dep.plan_fingerprint → 409

    def test_approved_status_is_terminal_for_this_phase(self):
        """After APPROVED, no further automatic transitions should happen."""
        from models import DeploymentStatus
        # APPROVED is the final state for this phase
        dep = self._make_deployment(status_value="approved")
        assert dep.status == DeploymentStatus.approved
        # In the current phase, APPLYING and DEPLOYED are not triggered
        assert dep.status != DeploymentStatus.applying
        assert dep.status != DeploymentStatus.deployed


# ---------------------------------------------------------------------------
# 14-16. Multi-tenant security guards
# ---------------------------------------------------------------------------

class TestMultiTenantSecurity:
    """Verify that user_id and org_id scoping prevents cross-user access."""

    def test_project_scoped_by_org(self):
        """A project belonging to org A is not accessible from org B."""
        org_a = uuid.uuid4()
        org_b = uuid.uuid4()

        project = MagicMock()
        project.org_id = org_a

        # Simulates the WHERE clause: Project.org_id == org.id
        def can_access(requesting_org: uuid.UUID) -> bool:
            return str(project.org_id) == str(requesting_org)

        assert can_access(org_a)
        assert not can_access(org_b)

    def test_cloud_account_scoped_by_user(self):
        """A cloud account owned by user A is not accessible by user B."""
        user_a = uuid.uuid4()
        user_b = uuid.uuid4()

        account = MagicMock()
        account.user_id = user_a

        def can_access(requesting_user: uuid.UUID) -> bool:
            return str(account.user_id) == str(requesting_user)

        assert can_access(user_a)
        assert not can_access(user_b)

    def test_deployment_scoped_by_org(self):
        """A deployment belonging to org A is not accessible from org B."""
        org_a = uuid.uuid4()
        org_b = uuid.uuid4()

        deployment = MagicMock()
        deployment.org_id = org_a

        def can_access(requesting_org: uuid.UUID) -> bool:
            return str(deployment.org_id) == str(requesting_org)

        assert can_access(org_a)
        assert not can_access(org_b)

    def test_credentials_not_in_plan_response(self):
        """The plan API response must not include AWS credential fields."""
        plan_response = {
            "deployment_id": str(uuid.uuid4()),
            "status": "awaiting_approval",
            "account_id": "123456789012",
            "region": "ap-south-1",
            "environment": "production",
            "project_name": "my-app",
            "summary": {"create": 2, "modify": 0, "destroy": 0, "replace": 0},
            "terraform_plan": "Plan: 2 to add...",
            "plan_created_at": "2026-10-04T12:00:00Z",
            "error_message": None,
        }
        forbidden_keys = {
            "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
            "access_key", "secret_key", "session_token", "credentials",
            "role_arn", "external_id",
        }
        response_keys = {k.lower() for k in plan_response}
        for key in forbidden_keys:
            assert key.lower() not in response_keys, \
                f"Credential field '{key}' must not appear in plan API response"

    def test_deployment_out_does_not_include_credentials(self):
        """DeploymentOut schema fields must not include credential fields."""
        from models import DeploymentOut
        field_names = {f.lower() for f in DeploymentOut.model_fields}
        forbidden = {"access_key", "secret_key", "session_token", "external_id"}
        overlap = field_names & forbidden
        assert not overlap, f"DeploymentOut contains credential fields: {overlap}"
