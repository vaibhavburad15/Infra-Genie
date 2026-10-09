"""
LangGraph Multi-Agent Orchestrator.

Graph flow:
  analyze_project -> discover_apps -> select_strategy
    -> {Docker, Terraform, Kubernetes, CI/CD, Architecture,
        Monitoring, Security, Cost} (parallel)
  -> aggregate_results

The specialists do not invent detection anymore: the deterministic
`ProjectDetails` summary produced by `static_analysis.analyze_repo_static`
is passed in as `source_code_summary` (it's a dict, not a string). Each agent's
system prompt instructs it to base all claims on `source_code_summary`. If a
field is empty, it returns a short explicit note rather than guessing.

Each specialist streams its LLM response through `on_llm_token` (when provided)
so the live analysis terminal shows what the model is actually generating.
"""
import asyncio
import json
import re
from typing import Any, TypedDict, Annotated, Callable, Mapping, Optional
import operator

from langgraph.graph import StateGraph, END
from langgraph.graph.graph import CompiledGraph

from llm import chat_stream, LLMUnavailableError


# ── Agent State ───────────────────────────────────────────────────────────────

class AgentState(TypedDict):
    project_id: str
    project_name: str
    # A deterministic dict from static_analysis.analyze_repo_static()
    source_code_summary: dict
    analysis: dict
    discovered_apps: list
    strategy: str
    docker_artifacts: str
    terraform_artifacts: Any
    kubernetes_artifacts: str
    cicd_artifacts: str
    architecture_notes: str
    monitoring_config: str
    security_config: str
    cost_estimate: str
    agent_logs: Annotated[list, operator.add]
    final_artifacts: dict
    on_log: Optional[Callable]
    on_llm_token: Optional[Callable]


_CONCISE = (
    "Be concise. No preamble, no filler, no code fences around JSON. "
    "Return exactly what is asked (a valid JSON object, or the file contents "
    "directly). Use the deterministic ProjectDetails provided - never invent "
    "frameworks or versions not listed there."
)


def _log(state: Mapping[str, Any], agent: str, result: str) -> dict:
    return {"agent_logs": [{"agent": agent, "result": result[:500]}]}


def _emit(state: Mapping[str, Any], agent: str, message: str, level: str = "info") -> None:
    cb = state.get("on_log")
    if cb:
        try:
            cb(agent, message, level)
        except Exception:
            pass


async def _streamed_ask(state: Mapping[str, Any], agent_name: str, system: str, user: str,
                       max_tokens: int = 1500) -> str:
    """Ask the LLM and stream tokens back to the live terminal as they arrive.

    Uses chat_stream() so the user can see model output in real time.
    Returns the full assembled text."""
    token_cb_state = {"buf": "", "last_flush_ts": 0.0}

    def _on_token(tok: str) -> None:
        token_cb_state["buf"] += tok
        on_llm = state.get("on_llm_token")
        if on_llm:
            try:
                on_llm(agent_name, tok)
            except Exception:
                pass

    _emit(state, agent_name, "Asking LLM (streaming)…", "info")
    text_parts: list[str] = []
    async for chunk in chat_stream(
        [{"role": "system", "content": system},
         {"role": "user", "content": user + "\n\n" + _CONCISE}],
        temperature=0.2, max_tokens=max_tokens, on_chunk=_on_token,
    ):
        text_parts.append(chunk)
    full = "".join(text_parts).strip()
    _emit(state, agent_name,
          f"LLM returned {len(full)} chars", "success")
    return full


# ── Nodes ─────────────────────────────────────────────────────────────────────

def _summary_block(state: AgentState) -> str:
    """Render the deterministic analysis dict as a Markdown-ish block the LLM
    can actually read. Keeps the model honest about what's known vs unknown."""
    s = state.get("source_code_summary") or {}
    summary = s.get("summary", {})
    lines = [
        f"PROJECT: {state['project_name']}",
        f"PRIMARY LANGUAGE: {summary.get('primary_language','?')}",
        f"PRIMARY FRAMEWORK: {summary.get('primary_framework','(none detected)')}",
        f"PACKAGE MANAGER: {summary.get('package_manager','not detected')}",
        f"FILES: {summary.get('total_files','?')}  "
        f"SOURCE FILES: {summary.get('source_files','?')}  "
        f"TEST FILES: {summary.get('test_files','?')}  "
        f"LOC: {summary.get('total_loc','?')}",
        "",
        "LANGUAGES (top 6):",
    ]
    for lang in s.get("languages", [])[:6]:
        lines.append(f"  - {lang.get('name')}: {lang.get('files')} files, "
                     f"{lang.get('loc')} LOC")
    lines.append("")
    lines.append("FRAMEWORKS:")
    for fw in s.get("frameworks", []):
        ver = fw.get("version")
        lines.append(f"  - {fw.get('name')}" + (f" v{ver}" if ver else ""))
    if s.get("build_tools"):
        lines += ["", "BUILD TOOLS:"]
        for b in s["build_tools"]:
            lines.append(f"  - {b.get('name')}" + (f" v{b.get('version')}" if b.get("version") else ""))
    if s.get("tests"):
        lines += ["", "TEST FRAMEWORKS:"]
        for t in s["tests"]:
            lines.append(f"  - {t.get('name')}" + (f" v{t.get('version')}" if t.get("version") else ""))
    if s.get("databases_orms"):
        lines += ["", "DATABASES / ORMs:"]
        for d in s["databases_orms"]:
            lines.append(f"  - {d.get('name')}" + (f" v{d.get('version')}" if d.get("version") else ""))
    if s.get("linters_formatters"):
        lines += ["", "LINTERS / FORMATTERS:"]
        for lf in s["linters_formatters"]:
            lines.append(f"  - {lf.get('name')}")
    cont = s.get("containerization", {})
    if cont.get("has_dockerfile") or cont.get("has_docker_compose"):
        lines += ["", f"CONTAINER: Dockerfile={cont.get('has_dockerfile',False)}, "
                      f"compose={cont.get('has_docker_compose',False)}"]
        if cont.get("docker_services"):
            lines.append(f"  compose services: {', '.join(cont['docker_services'])}")
    if s.get("ci_cd", {}).get("present"):
        lines += ["", f"CI/CD: {', '.join(s['ci_cd'].get('systems',[]))}"]
    if s.get("entry_points"):
        lines += ["", "ENTRY POINTS:"]
        for ep in s["entry_points"][:5]:
            lines.append(f"  - {ep}")
    if s.get("environment_variables_hint"):
        lines += ["", "ENV HINTS: " + ", ".join(s["environment_variables_hint"][:8])]
    return "\n".join(lines)


async def analyze_project(state: AgentState) -> dict:
    _emit(state, "AI Project Analyzer",
          "Synthesizing project analysis from deterministic ProjectDetails…")
    sys_prompt = (
        "You are an AI Project Analyzer. Given the deterministic ProjectDetails "
        "block below, return a JSON object with: "
        "language, framework, has_database, has_frontend, complexity "
        "(low|medium|high), recommended_strategy "
        "(docker-compose|kubernetes|serverless), notes (1-2 sentences). "
        "Use ONLY what's listed; do NOT invent."
    )
    user = _summary_block(state)
    raw = await _streamed_ask(state, "AI Project Analyzer", sys_prompt, user, max_tokens=900)
    try:
        analysis = json.loads(raw)
        _emit(state, "AI Project Analyzer",
              f"Project is "
              f"{analysis.get('language','?')} / {analysis.get('framework','?')} "
              f"- complexity {analysis.get('complexity','?')}",
              "success")
    except Exception:
        analysis = {
            "language": state["source_code_summary"].get("summary",{}).get("primary_language","Unknown"),
            "framework": state["source_code_summary"].get("summary",{}).get("primary_framework"),
            "complexity": "medium",
            "recommended_strategy": "docker-compose",
            "notes": "Static-analyzer fallback for the LLM JSON parser.",
            "raw_llm_response": raw[:400],
        }
        _emit(state, "AI Project Analyzer",
              "Model returned non-JSON; using deterministic fallback.", "error")
    return {"analysis": analysis, **_log(state, "AI Project Analyzer", str(analysis)[:400])}


async def discover_apps(state: AgentState) -> dict:
    _emit(state, "Application Discovery", "Discovering services and runtimes…")
    sys_prompt = (
        "You are an Application Discovery agent. Given the ProjectDetails, list "
        "the distinct runnable services as a JSON array. Each item: "
        "{name, type (backend|frontend|worker|database|static), port, tech}. "
        "If only one app exists, return one item. Be honest - don't fabricate ports."
    )
    user = _summary_block(state)
    raw = await _streamed_ask(state, "Application Discovery", sys_prompt, user, max_tokens=900)
    try:
        apps = json.loads(raw)
        if not isinstance(apps, list):
            raise ValueError("expected array")
        _emit(state, "Application Discovery",
              f"Found {len(apps)} service(s): " +
              ", ".join(a.get("name","?") for a in apps), "success")
    except Exception:
        primary = state["source_code_summary"].get("summary",{}).get("primary_language","app")
        apps = [{"name": primary, "type": "backend", "port": 8000,
                 "tech": state["source_code_summary"].get("summary",{}).get("primary_framework","unknown")}]
        _emit(state, "Application Discovery",
              "Using deterministic single-service fallback.", "error")
    return {"discovered_apps": apps, **_log(state, "Application Discovery", str(apps)[:400])}


async def select_strategy(state: AgentState) -> dict:
    strategy = state["analysis"].get("recommended_strategy") or "docker-compose"
    _emit(state, "Strategy Selection",
          f"Deployment strategy: {strategy} (from ProjectDetails + LLM)",
          "success")
    return {"strategy": strategy, **_log(state, "Strategy Selection", strategy)}


# ── Specialized agents ───────────────────────────────────────────────────────

async def docker_agent(state: AgentState) -> dict:
    _emit(state, "Docker Agent", "Generating Dockerfile and docker-compose.yml…")
    sys_prompt = (
        "You are a Docker AI Agent. Produce a Dockerfile and a docker-compose.yml "
        "tailored to the project's detected language / framework. Use multi-stage "
        "builds, non-root user, health checks. If the ProjectDetails shows an "
        "existing Dockerfile at /Dockerfile, reference its base image. Return the "
        "two files in this exact format:\n\n"
        "=== Dockerfile ===\n<contents>\n\n=== docker-compose.yml ===\n<contents>\n"
    )
    user = _summary_block(state) + "\nSTRATEGY=" + state["strategy"]
    result = await _streamed_ask(state, "Docker Agent", sys_prompt, user, max_tokens=1800)
    return {"docker_artifacts": result, **_log(state, "Docker Agent", result[:400])}


def _parse_terraform_json_output(raw: str, state: Mapping[str, Any]) -> dict[str, Any]:
    """Extract Terraform files and their resource specification from model JSON.

    The preferred response is ``{"files": {"main.tf": "..."},
    "resource_specifications": [...]}``. The older ``{"terraform": "..."}``
    form and raw HCL remain readable so saved projects can be upgraded without
    rerunning project analysis. Planning performs strict validation before use.
    """
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*\n?", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\n?```\s*$", "", text).strip()

    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        parsed = None

    if isinstance(parsed, dict):
        files = parsed.get("files")
        if isinstance(files, dict):
            normalized_files = {
                str(path): content
                for path, content in files.items()
                if isinstance(path, str) and isinstance(content, str)
            }
            if len(normalized_files) == len(files):
                _emit(state, "Terraform Agent", "Structured Terraform files received.", "success")
                return {
                    "files": normalized_files,
                    "resource_specifications": parsed.get("resource_specifications"),
                }
        legacy_hcl = parsed.get("terraform")
        if isinstance(legacy_hcl, str):
            _emit(state, "Terraform Agent", "Legacy single-file Terraform response received.", "info")
            return {"files": {"main.tf": legacy_hcl}, "resource_specifications": None}

    # Keep the original response intact. Planning validation will reject prose,
    # README content, malformed JSON, and empty output and request a retry.
    _emit(state, "Terraform Agent", "Response was not structured JSON; preserving it for validation.", "warning")
    return {"files": {"main.tf": raw or ""}, "resource_specifications": None}


async def terraform_agent(state: Mapping[str, Any]) -> dict:
    _emit(state, "Terraform Agent", "Generating AWS Terraform files from the supplied architecture…")
    analysis = state.get("analysis") or {}
    details = state.get("source_code_summary") or {}
    architecture = state.get("architecture")
    if architecture is None:
        architecture = _parse_architecture(state.get("architecture_notes", ""))
    apps = state.get("discovered_apps") or []
    context = {
        "project": state.get("project_name"),
        "analysis": analysis,
        "project_details": details,
        "architecture": architecture,
        "deployment_strategy": state.get("strategy"),
        "application_services": apps,
        "deployment": state.get("deployment") or {},
        "aws_discovery": state.get("aws_discovery") or {},
        "required_application_components": state.get("required_application_components") or [
            str(app.get("name")) for app in apps
            if isinstance(app, dict) and app.get("name")
            and app.get("type") in {"backend", "frontend", "worker", "static"}
        ],
        "previous_validation_errors": state.get("terraform_generation_errors") or [],
    }
    sys_prompt = (
        "You are the Terraform artifact generation agent for an AWS deployment. "
        "Use only the supplied project analysis, proposed architecture, deployment "
        "requirements, region, and AWS discovery snapshot. Generate actual Terraform "
        "infrastructure that implements that architecture. Do not generate application "
        "source code or documentation. Do not invent components or fabricate resources "
        "to satisfy a resource count. Include only files required by this architecture.\n\n"
        "Return exactly one JSON object with this shape:\n"
        '{"files":{"main.tf":"...","providers.tf":"..."},'
        '"resource_specifications":[{"type":"aws_...","name":"...",'
        '"components":["service name"],"purpose":"..."}]}\n\n'
        "Requirements:\n"
        "- Every file value must contain only HCL. Put at least one real resource \"aws_*\" block in main.tf.\n"
        "- Include a terraform.required_providers declaration for hashicorp/aws and one provider \"aws\" block.\n"
        "- Declare each resource block exactly once in resource_specifications with matching type and name.\n"
        "- Each required_application_component must be covered in a resource specification's components list. "
        "A single resource may cover multiple components when the architecture does so.\n"
        "- The resource count must follow the proposed architecture; one resource is valid when sufficient.\n"
        "- Set the AWS provider region to the supplied deployment region. Do not hardcode a different region.\n"
        "- If retry feedback is present, correct every listed validation error.\n"
        "- Never return Markdown, README text, directory trees, JavaScript, or explanatory prose.\n"
        "- Never include credentials, provisioners, local_file, external data sources, or non-AWS providers."
    )
    raw = await _streamed_ask(
        state, "Terraform Agent", sys_prompt,
        json.dumps(context, ensure_ascii=False, sort_keys=True, default=str),
        max_tokens=5000,
    )
    terraform_artifacts = _parse_terraform_json_output(raw, state)
    return {
        "terraform_artifacts": terraform_artifacts,
        **_log(state, "Terraform Agent", json.dumps(terraform_artifacts, default=str)[:400]),
    }


async def kubernetes_agent(state: AgentState) -> dict:
    _emit(state, "Kubernetes Agent", "Generating Kubernetes manifests…")
    sys_prompt = (
        "You are a Kubernetes AI Agent. Generate Deployment + Service + Ingress for "
        "the primary service. Include liveness / readiness probes, resource limits, "
        "rolling update strategy. Return YAML only."
    )
    user = _summary_block(state)
    result = await _streamed_ask(state, "Kubernetes Agent", sys_prompt, user, max_tokens=1800)
    return {"kubernetes_artifacts": result, **_log(state, "Kubernetes Agent", result[:400])}


async def cicd_agent(state: AgentState) -> dict:
    _emit(state, "CI/CD Agent", "Generating GitHub Actions workflow…")
    sys_prompt = (
        "You are a CI/CD AI Agent. Produce a GitHub Actions workflow YAML with "
        "build -> test -> docker push -> deploy steps, tuned to the project's "
        "package manager and test framework from ProjectDetails. Return YAML only."
    )
    user = _summary_block(state)
    result = await _streamed_ask(state, "CI/CD Agent", sys_prompt, user, max_tokens=1500)
    return {"cicd_artifacts": result, **_log(state, "CI/CD Agent", result[:400])}


async def architecture_agent(state: AgentState) -> dict:
    _emit(state, "Architecture Agent", "Generating visual architecture diagram…")
    sys_prompt = (
        "You are an Architecture AI Agent. Analyze the ProjectDetails and return a "
        "JSON object that describes the system architecture as a visual graph.\n\n"
        "The JSON must have exactly three keys:\n"
        "  'nodes': array of objects with keys: id (string), label (string), "
        "type (one of: service|database|cache|queue|gateway|storage|frontend|cdn|auth|monitoring), "
        "description (short 1-line string)\n"
        "  'edges': array of objects with keys: source (node id), target (node id), "
        "label (short verb like 'reads', 'writes', 'calls', 'streams', 'auth')\n"
        "  'notes': array of 5-8 short strings — concrete scalability / resilience "
        "recommendations\n\n"
        "Rules:\n"
        "- Include every detected service, database, cache, queue, and external "
        "dependency as a node\n"
        "- Add an 'Internet / Client' gateway node as the entry point\n"
        "- Connect nodes with realistic data-flow edges\n"
        "- Return ONLY valid JSON — no code fences, no extra keys, no markdown"
    )
    user = _summary_block(state)
    result = await _streamed_ask(state, "Architecture Agent", sys_prompt, user, max_tokens=1800)
    return {"architecture_notes": result, **_log(state, "Architecture Agent", result[:400])}


async def monitoring_agent(state: AgentState) -> dict:
    _emit(state, "Monitoring Agent", "Generating Prometheus / Grafana config…")
    sys_prompt = (
        "You are a Monitoring AI Agent. Return a Prometheus scrape config "
        "(YAML) tuned for the project's primary framework, plus 3 alerting rules."
    )
    user = _summary_block(state)
    result = await _streamed_ask(state, "Monitoring Agent", sys_prompt, user, max_tokens=1200)
    return {"monitoring_config": result, **_log(state, "Monitoring Agent", result[:400])}


async def security_agent(state: AgentState) -> dict:
    _emit(state, "Security Agent", "Compiling security hardening checklist…")
    sys_prompt = (
        "You are a Security AI Agent. Produce a Markdown checklist with: "
        "image hardening, network policies, secrets management, RBAC, and any "
        "vulnerabilities typical of the detected framework version."
    )
    user = _summary_block(state)
    result = await _streamed_ask(state, "Security Agent", sys_prompt, user, max_tokens=1000)
    return {"security_config": result, **_log(state, "Security Agent", result[:400])}


async def cost_agent(state: AgentState) -> dict:
    _emit(state, "Cost Agent", "Estimating monthly cost and optimization levers…")
    sys_prompt = (
        "You are a Cost Optimization AI Agent. Return a table-form cost estimate "
        "(monthly $) covering compute / storage / network for the project, and "
        "3 - 5 savings recommendations (right-sizing, reserved capacity, caching)."
    )
    user = _summary_block(state) + "\nSTRATEGY=" + state["strategy"]
    result = await _streamed_ask(state, "Cost Agent", sys_prompt, user, max_tokens=900)
    return {"cost_estimate": result, **_log(state, "Cost Agent", result[:400])}


def _parse_architecture(raw: str) -> dict:
    """Parse the architecture_agent JSON output into a structured dict.

    Returns a guaranteed-shape dict so the frontend always gets the same
    schema.  Falls back gracefully when the LLM returns non-JSON.
    """
    _EMPTY: dict = {"nodes": [], "edges": [], "notes": []}
    if not raw or not raw.strip():
        return _EMPTY
    # Strip accidental code fences the LLM may have added despite instructions
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    try:
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            raise ValueError("expected object")
        # Normalise — ensure all three keys exist
        return {
            "nodes": parsed.get("nodes", []),
            "edges": parsed.get("edges", []),
            "notes": parsed.get("notes", []),
        }
    except Exception:
        # Last-resort: wrap the raw text as a single note so nothing is lost
        return {"nodes": [], "edges": [], "notes": [raw]}


async def aggregate_results(state: AgentState) -> dict:
    static = state.get("source_code_summary") or {}
    static_summary = static.get("summary", {})

    # Start with whatever the LLM analysis agent produced
    llm_analysis: dict = dict(state.get("analysis") or {})

    # Merge static analysis fields in — static data fills gaps and adds
    # structured detail that the LLM analysis object alone doesn't carry.
    # LLM values are kept when present; static values are added under their
    # own keys so nothing is silently overwritten.
    merged_analysis = {
        # Core identity — prefer LLM interpretation, static as fallback
        "language": llm_analysis.get("language") or static_summary.get("primary_language", "Unknown"),
        "framework": llm_analysis.get("framework") or static_summary.get("primary_framework"),
        "complexity": llm_analysis.get("complexity", "medium"),
        "recommended_strategy": llm_analysis.get("recommended_strategy", "docker-compose"),
        "notes": llm_analysis.get("notes", ""),
        "has_database": llm_analysis.get("has_database",
                                         bool(static.get("databases_orms"))),
        "has_frontend": llm_analysis.get("has_frontend", False),
        # Structured detail straight from static analysis
        "static": {
            "summary": static_summary,
            "languages": static.get("languages", []),
            "frameworks": static.get("frameworks", []),
            "build_tools": static.get("build_tools", []),
            "tests": static.get("tests", []),
            "linters_formatters": static.get("linters_formatters", []),
            "databases_orms": static.get("databases_orms", []),
            "containerization": static.get("containerization", {}),
            "ci_cd": static.get("ci_cd", {}),
            "entry_points": static.get("entry_points", []),
            "environment_variables_hint": static.get("environment_variables_hint", []),
            "total_files": static_summary.get("total_files"),
            "total_loc": static_summary.get("total_loc"),
            "source_files": static_summary.get("source_files"),
            "test_files": static_summary.get("test_files"),
            "package_manager": static_summary.get("package_manager"),
        },
    }

    _emit(state, "InfraGenie",
          f"Aggregating results: language={merged_analysis['language']}, "
          f"framework={merged_analysis['framework']}, "
          f"strategy={merged_analysis['recommended_strategy']}",
          "success")

    return {"final_artifacts": {
        "docker": state.get("docker_artifacts", ""),
        "terraform": state.get("terraform_artifacts", ""),
        "kubernetes": state.get("kubernetes_artifacts", ""),
        "cicd": state.get("cicd_artifacts", ""),
        "architecture": _parse_architecture(state.get("architecture_notes", "")),
        "monitoring": state.get("monitoring_config", ""),
        "security": state.get("security_config", ""),
        "cost_estimate": state.get("cost_estimate", ""),
        "strategy": state.get("strategy", ""),
        "analysis": merged_analysis,
        "detailed_analysis": static,
        "discovered_apps": state.get("discovered_apps", []),
    }}


# ── Fan-out / parallel runner ─────────────────────────────────────────────────

async def run_all_agents(state: AgentState) -> dict:
    _emit(state, "InfraGenie",
          "Launching 7 specialist agents in parallel; Terraform follows the architecture result…")

    agent_fns = [
        ("Docker Agent", "docker_artifacts", docker_agent),
        ("Kubernetes Agent", "kubernetes_artifacts", kubernetes_agent),
        ("CI/CD Agent", "cicd_artifacts", cicd_agent),
        ("Architecture Agent", "architecture_notes", architecture_agent),
        ("Monitoring Agent", "monitoring_config", monitoring_agent),
        ("Security Agent", "security_config", security_agent),
        ("Cost Agent", "cost_estimate", cost_agent),
    ]

    outcomes = await asyncio.gather(
        *(fn(state) for _, _, fn in agent_fns),
        return_exceptions=True,
    )

    merged: dict = {}
    logs = []
    failures = 0
    for (agent_name, field, _fn), outcome in zip(agent_fns, outcomes):
        if isinstance(outcome, LLMUnavailableError):
            failures += 1
            _emit(state, agent_name, "LLM is not working: " + str(outcome), "error")
            merged[field] = "[Unavailable - LLM is not working: " + str(outcome) + "]"
            logs.append({"agent": agent_name, "result": "FAILED: " + str(outcome)})
        elif isinstance(outcome, BaseException):
            # Narrow here (asyncio.gather(return_exceptions=True) types items as
            # `dict | BaseException`) so the `else` branch is statically `dict`.
            failures += 1
            _emit(state, agent_name, "Failed: " + str(outcome), "error")
            merged[field] = "[Unavailable - " + str(outcome) + "]"
            logs.append({"agent": agent_name, "result": "FAILED: " + str(outcome)})
        else:
            logs.extend(outcome.pop("agent_logs", []))
            merged.update(outcome)

    if failures == len(agent_fns):
        raise LLMUnavailableError(
            "LLM is not working - all 7 parallel specialist agents failed to get a response."
        )

    # Terraform generation runs after Architecture so it can consume the
    # proposed graph. Deployment planning regenerates it with the selected
    # AWS region and discovery snapshot.
    terraform_state = {**state, **merged}
    try:
        terraform_result = await terraform_agent(terraform_state)
        logs.extend(terraform_result.pop("agent_logs", []))
        merged.update(terraform_result)
    except Exception as exc:
        failures += 1
        _emit(state, "Terraform Agent", "Failed: " + str(exc), "error")
        merged["terraform_artifacts"] = {
            "files": {},
            "resource_specifications": None,
            "generation_error": str(exc),
        }
        logs.append({"agent": "Terraform Agent", "result": "FAILED: " + str(exc)})
    if failures:
        _emit(state, "InfraGenie",
              f"{failures}/8 agent(s) failed - continuing with partial results.",
              "error")

    merged["agent_logs"] = logs
    return merged


# ── Build LangGraph ───────────────────────────────────────────────────────────

def build_graph() -> CompiledGraph:
    g = StateGraph(AgentState)
    g.add_node("analyze_project", analyze_project)
    g.add_node("discover_apps", discover_apps)
    g.add_node("select_strategy", select_strategy)
    g.add_node("run_all_agents", run_all_agents)
    g.add_node("aggregate_results", aggregate_results)
    g.set_entry_point("analyze_project")
    g.add_edge("analyze_project", "discover_apps")
    g.add_edge("discover_apps", "select_strategy")
    g.add_edge("select_strategy", "run_all_agents")
    g.add_edge("run_all_agents", "aggregate_results")
    g.add_edge("aggregate_results", END)
    return g.compile()


orchestrator = build_graph()


async def run_orchestrator(project_id, project_name, source_summary):
    return await run_orchestrator_with_progress(project_id, project_name, source_summary)


async def run_orchestrator_with_progress(
    project_id: str,
    project_name: str,
    source_summary: dict,
    on_log: Optional[Callable] = None,
    on_llm_token: Optional[Callable] = None,
) -> dict:
    initial_state = AgentState(
        project_id=project_id, project_name=project_name,
        source_code_summary=source_summary, analysis={},
        discovered_apps=[], strategy="",
        docker_artifacts="", terraform_artifacts="",
        kubernetes_artifacts="", cicd_artifacts="",
        architecture_notes="", monitoring_config="",
        security_config="", cost_estimate="",
        agent_logs=[], final_artifacts={},
        on_log=on_log, on_llm_token=on_llm_token,
    )
    return await orchestrator.ainvoke(initial_state)
