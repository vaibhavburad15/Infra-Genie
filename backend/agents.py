"""
LangGraph Multi-Agent Orchestrator

Graph flow:
  analyze_project → discover_apps → select_strategy
      → [docker, terraform, kubernetes, cicd, architecture, monitoring, security, cost]
      → aggregate_results

Each node calls the configured LLM (via llm.chat) with a specialized system prompt.
The active model and endpoint are read from settings (LLM_MODEL / LLM_BASE_URL).

The `run_orchestrator_with_progress` entry point accepts an `on_log` callback so the
background worker can stream log lines to Redis in real time.
"""
import json
import asyncio
from typing import TypedDict, Annotated, List, Callable, Optional
import operator

from langgraph.graph import StateGraph, END
from langgraph.graph.graph import CompiledGraph

from llm import chat


# ── Agent State ───────────────────────────────────────────────────────────────

class AgentState(TypedDict):
    project_id: str
    project_name: str
    source_code_summary: str          # summary of files/structure sent by analyzer
    analysis: dict                    # AI project analysis
    discovered_apps: list             # microservices / apps found
    strategy: str                     # deployment strategy chosen
    docker_artifacts: str
    terraform_artifacts: str
    kubernetes_artifacts: str
    cicd_artifacts: str
    architecture_notes: str
    monitoring_config: str
    security_config: str
    cost_estimate: str
    agent_logs: Annotated[list, operator.add]
    final_artifacts: dict
    on_log: Optional[Callable]        # progress callback: (agent, message, level) → None


# ── Helper ────────────────────────────────────────────────────────────────────

def _log(state: AgentState, agent: str, result: str) -> dict:
    return {"agent_logs": [{"agent": agent, "result": result[:500]}]}


def _emit(state: AgentState, agent: str, message: str, level: str = "info"):
    """Fire the progress callback if present (runs in worker thread via asyncio.run)."""
    cb = state.get("on_log")
    if cb:
        try:
            cb(agent, message, level)
        except Exception:
            pass


async def _ask(system: str, user: str) -> str:
    return await chat(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0.2,
    )


# ── Nodes ─────────────────────────────────────────────────────────────────────

async def analyze_project(state: AgentState) -> dict:
    _emit(state, "AI Project Analyzer", "🔍 Analyzing project structure, language and complexity…")
    system = """You are an AI Project Analyzer. Analyze the given project summary and return a JSON object with:
{
  "language": "...",
  "framework": "...",
  "has_database": true/false,
  "has_frontend": true/false,
  "complexity": "low|medium|high",
  "recommended_strategy": "docker-compose|kubernetes|serverless",
  "notes": "..."
}
Return ONLY valid JSON."""
    user = f"Project: {state['project_name']}\n\nCode Summary:\n{state['source_code_summary']}"
    result = await _ask(system, user)
    try:
        analysis = json.loads(result)
        _emit(state, "AI Project Analyzer",
              f"✅ Detected: {analysis.get('language','?')} / {analysis.get('framework','?')} — strategy: {analysis.get('recommended_strategy','?')}",
              "success")
    except Exception:
        analysis = {"raw": result, "recommended_strategy": "docker-compose"}
        _emit(state, "AI Project Analyzer", "⚠️ Could not parse JSON — using fallback analysis", "error")
    return {"analysis": analysis, **_log(state, "AI Project Analyzer", str(analysis))}


async def discover_apps(state: AgentState) -> dict:
    _emit(state, "Application Discovery", "🔎 Discovering services and microservices…")
    system = """You are an Application Discovery agent. Given a project analysis, list all distinct applications/services as a JSON array.
Each item: {"name": "...", "type": "backend|frontend|worker|database", "port": 8000, "tech": "..."}
Return ONLY valid JSON array."""
    user = f"Analysis: {json.dumps(state['analysis'])}\n\nSummary: {state['source_code_summary'][:2000]}"
    result = await _ask(system, user)
    try:
        apps = json.loads(result)
        names = ", ".join(a.get("name", "?") for a in apps)
        _emit(state, "Application Discovery", f"✅ Found {len(apps)} service(s): {names}", "success")
    except Exception:
        apps = [{"name": state["project_name"], "type": "backend", "port": 8000, "tech": "unknown"}]
        _emit(state, "Application Discovery", "⚠️ Using fallback single-service discovery", "error")
    return {"discovered_apps": apps, **_log(state, "Application Discovery", str(apps))}


async def select_strategy(state: AgentState) -> dict:
    strategy = state["analysis"].get("recommended_strategy", "docker-compose")
    _emit(state, "Strategy Selection", f"✅ Deployment strategy selected: {strategy}", "success")
    return {"strategy": strategy, **_log(state, "Strategy Selection", strategy)}


# ── Specialized AI Agents ─────────────────────────────────────────────────────

async def docker_agent(state: AgentState) -> dict:
    _emit(state, "Docker Agent", "🐳 Generating Dockerfiles and docker-compose.yml…")
    system = """You are a Docker AI Agent. Generate production-ready Dockerfiles and docker-compose.yml for the given applications.
Include multi-stage builds, non-root users, health checks. Return the complete file contents."""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nStrategy: {state['strategy']}\nAnalysis: {json.dumps(state['analysis'])}"
    result = await _ask(system, user)
    _emit(state, "Docker Agent", "✅ Docker configuration generated", "success")
    return {"docker_artifacts": result, **_log(state, "Docker AI Agent", result)}


async def terraform_agent(state: AgentState) -> dict:
    _emit(state, "Terraform Agent", "🏗️  Generating Terraform IaC…")
    system = """You are a Terraform AI Agent. Generate Terraform IaC for the infrastructure needed.
Include provider config, VPC, compute, storage resources. Use variables for environment-specific values."""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nStrategy: {state['strategy']}"
    result = await _ask(system, user)
    _emit(state, "Terraform Agent", "✅ Terraform configuration generated", "success")
    return {"terraform_artifacts": result, **_log(state, "Terraform AI Agent", result)}


async def kubernetes_agent(state: AgentState) -> dict:
    _emit(state, "Kubernetes Agent", "☸️  Generating Kubernetes manifests…")
    system = """You are a Kubernetes AI Agent. Generate K8s manifests: Deployments, Services, Ingress, HPA, ConfigMaps.
Follow best practices: resource limits, liveness/readiness probes, rolling updates."""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nAnalysis: {json.dumps(state['analysis'])}"
    result = await _ask(system, user)
    _emit(state, "Kubernetes Agent", "✅ Kubernetes manifests generated", "success")
    return {"kubernetes_artifacts": result, **_log(state, "Kubernetes AI Agent", result)}


async def cicd_agent(state: AgentState) -> dict:
    _emit(state, "CI/CD Agent", "🔄 Generating CI/CD pipeline…")
    system = """You are a CI/CD AI Agent. Generate a GitHub Actions workflow (or GitLab CI) pipeline.
Include: build, test, security scan, push to registry, deploy stages."""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nAnalysis: {json.dumps(state['analysis'])}"
    result = await _ask(system, user)
    _emit(state, "CI/CD Agent", "✅ CI/CD pipeline generated", "success")
    return {"cicd_artifacts": result, **_log(state, "CI/CD AI Agent", result)}


async def architecture_agent(state: AgentState) -> dict:
    _emit(state, "Architecture Agent", "🏛️  Generating architecture recommendations…")
    system = """You are an Architecture AI Agent. Review the application structure and provide architecture recommendations:
scalability, resilience patterns, API gateway needs, service mesh suggestions."""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nAnalysis: {json.dumps(state['analysis'])}"
    result = await _ask(system, user)
    _emit(state, "Architecture Agent", "✅ Architecture plan generated", "success")
    return {"architecture_notes": result, **_log(state, "Architecture AI Agent", result)}


async def monitoring_agent(state: AgentState) -> dict:
    _emit(state, "Monitoring Agent", "📊 Generating monitoring configuration…")
    system = """You are a Monitoring AI Agent. Generate monitoring configuration:
Prometheus scrape configs, Grafana dashboard JSON, alerting rules, log aggregation setup."""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nStrategy: {state['strategy']}"
    result = await _ask(system, user)
    _emit(state, "Monitoring Agent", "✅ Monitoring configuration generated", "success")
    return {"monitoring_config": result, **_log(state, "Monitoring AI Agent", result)}


async def security_agent(state: AgentState) -> dict:
    _emit(state, "Security Agent", "🔒 Running security analysis and generating hardening config…")
    system = """You are a Security AI Agent. Analyze the deployment plan and provide:
- Security hardening recommendations
- Network policies
- Secrets management approach
- RBAC configuration
- Vulnerability scan checklist"""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nAnalysis: {json.dumps(state['analysis'])}"
    result = await _ask(system, user)
    _emit(state, "Security Agent", "✅ Security configuration generated", "success")
    return {"security_config": result, **_log(state, "Security AI Agent", result)}


async def cost_agent(state: AgentState) -> dict:
    _emit(state, "Cost Agent", "💰 Estimating infrastructure costs…")
    system = """You are a Cost Optimization AI Agent. Estimate infrastructure costs and suggest optimizations:
- Monthly cost estimate by service
- Spot/preemptible instance recommendations
- Right-sizing suggestions
- Reserved instance savings"""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nStrategy: {state['strategy']}"
    result = await _ask(system, user)
    _emit(state, "Cost Agent", "✅ Cost estimate generated", "success")
    return {"cost_estimate": result, **_log(state, "Cost Optimization AI Agent", result)}


async def aggregate_results(state: AgentState) -> dict:
    artifacts = {
        "docker": state.get("docker_artifacts", ""),
        "terraform": state.get("terraform_artifacts", ""),
        "kubernetes": state.get("kubernetes_artifacts", ""),
        "cicd": state.get("cicd_artifacts", ""),
        "architecture": state.get("architecture_notes", ""),
        "monitoring": state.get("monitoring_config", ""),
        "security": state.get("security_config", ""),
        "cost_estimate": state.get("cost_estimate", ""),
        "strategy": state.get("strategy", ""),
        "analysis": state.get("analysis", {}),
        "discovered_apps": state.get("discovered_apps", []),
    }
    return {"final_artifacts": artifacts}


# ── Run specialized agents in parallel ───────────────────────────────────────

async def run_all_agents(state: AgentState) -> dict:
    """Fan-out: run all 8 specialized agents concurrently."""
    _emit(state, "InfraGenie", "⚡ Launching 8 specialist agents in parallel…")
    results = await asyncio.gather(
        docker_agent(state),
        terraform_agent(state),
        kubernetes_agent(state),
        cicd_agent(state),
        architecture_agent(state),
        monitoring_agent(state),
        security_agent(state),
        cost_agent(state),
    )
    merged = {}
    logs = []
    for r in results:
        logs.extend(r.pop("agent_logs", []))
        merged.update(r)
    merged["agent_logs"] = logs
    return merged


# ── Build LangGraph ───────────────────────────────────────────────────────────

def build_graph() -> CompiledGraph:
    graph = StateGraph(AgentState)

    graph.add_node("analyze_project", analyze_project)
    graph.add_node("discover_apps", discover_apps)
    graph.add_node("select_strategy", select_strategy)
    graph.add_node("run_all_agents", run_all_agents)
    graph.add_node("aggregate_results", aggregate_results)

    graph.set_entry_point("analyze_project")
    graph.add_edge("analyze_project", "discover_apps")
    graph.add_edge("discover_apps", "select_strategy")
    graph.add_edge("select_strategy", "run_all_agents")
    graph.add_edge("run_all_agents", "aggregate_results")
    graph.add_edge("aggregate_results", END)

    return graph.compile()


# Compiled graph (reused across requests)
orchestrator = build_graph()


async def run_orchestrator(project_id: str, project_name: str, source_summary: str) -> dict:
    """Entry point called by background worker (no progress callback)."""
    return await run_orchestrator_with_progress(project_id, project_name, source_summary)


async def run_orchestrator_with_progress(
    project_id: str,
    project_name: str,
    source_summary: str,
    on_log: Optional[Callable] = None,
) -> dict:
    """Entry point with real-time progress callback."""
    initial_state = AgentState(
        project_id=project_id,
        project_name=project_name,
        source_code_summary=source_summary,
        analysis={},
        discovered_apps=[],
        strategy="",
        docker_artifacts="",
        terraform_artifacts="",
        kubernetes_artifacts="",
        cicd_artifacts="",
        architecture_notes="",
        monitoring_config="",
        security_config="",
        cost_estimate="",
        agent_logs=[],
        final_artifacts={},
        on_log=on_log,
    )
    result = await orchestrator.ainvoke(initial_state)
    return result
