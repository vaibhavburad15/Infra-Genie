"""
LangGraph Multi-Agent Orchestrator

Graph flow:
  analyze_project → discover_apps → select_strategy
      → [docker, terraform, kubernetes, cicd, architecture, monitoring, security, cost]
      → aggregate_results

Each node calls Kimi K2 with a specialized system prompt.
"""
import json
import asyncio
from typing import TypedDict, Annotated, List
import operator

from langgraph.graph import StateGraph, END

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


# ── Helper ────────────────────────────────────────────────────────────────────

def _log(state: AgentState, agent: str, result: str) -> dict:
    return {"agent_logs": [{"agent": agent, "result": result[:500]}]}


async def _ask(system: str, user: str) -> str:
    return await chat(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0.2,
    )


# ── Nodes ─────────────────────────────────────────────────────────────────────

async def analyze_project(state: AgentState) -> dict:
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
    except Exception:
        analysis = {"raw": result, "recommended_strategy": "docker-compose"}
    return {"analysis": analysis, **_log(state, "AI Project Analyzer", str(analysis))}


async def discover_apps(state: AgentState) -> dict:
    system = """You are an Application Discovery agent. Given a project analysis, list all distinct applications/services as a JSON array.
Each item: {"name": "...", "type": "backend|frontend|worker|database", "port": 8000, "tech": "..."}
Return ONLY valid JSON array."""
    user = f"Analysis: {json.dumps(state['analysis'])}\n\nSummary: {state['source_code_summary'][:2000]}"
    result = await _ask(system, user)
    try:
        apps = json.loads(result)
    except Exception:
        apps = [{"name": state["project_name"], "type": "backend", "port": 8000, "tech": "unknown"}]
    return {"discovered_apps": apps, **_log(state, "Application Discovery", str(apps))}


async def select_strategy(state: AgentState) -> dict:
    strategy = state["analysis"].get("recommended_strategy", "docker-compose")
    return {"strategy": strategy, **_log(state, "Strategy Selection", strategy)}


# ── Specialized AI Agents ─────────────────────────────────────────────────────

async def docker_agent(state: AgentState) -> dict:
    system = """You are a Docker AI Agent. Generate production-ready Dockerfiles and docker-compose.yml for the given applications.
Include multi-stage builds, non-root users, health checks. Return the complete file contents."""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nStrategy: {state['strategy']}\nAnalysis: {json.dumps(state['analysis'])}"
    result = await _ask(system, user)
    return {"docker_artifacts": result, **_log(state, "Docker AI Agent", result)}


async def terraform_agent(state: AgentState) -> dict:
    system = """You are a Terraform AI Agent. Generate Terraform IaC for the infrastructure needed.
Include provider config, VPC, compute, storage resources. Use variables for environment-specific values."""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nStrategy: {state['strategy']}"
    result = await _ask(system, user)
    return {"terraform_artifacts": result, **_log(state, "Terraform AI Agent", result)}


async def kubernetes_agent(state: AgentState) -> dict:
    system = """You are a Kubernetes AI Agent. Generate K8s manifests: Deployments, Services, Ingress, HPA, ConfigMaps.
Follow best practices: resource limits, liveness/readiness probes, rolling updates."""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nAnalysis: {json.dumps(state['analysis'])}"
    result = await _ask(system, user)
    return {"kubernetes_artifacts": result, **_log(state, "Kubernetes AI Agent", result)}


async def cicd_agent(state: AgentState) -> dict:
    system = """You are a CI/CD AI Agent. Generate a GitHub Actions workflow (or GitLab CI) pipeline.
Include: build, test, security scan, push to registry, deploy stages."""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nAnalysis: {json.dumps(state['analysis'])}"
    result = await _ask(system, user)
    return {"cicd_artifacts": result, **_log(state, "CI/CD AI Agent", result)}


async def architecture_agent(state: AgentState) -> dict:
    system = """You are an Architecture AI Agent. Review the application structure and provide architecture recommendations:
scalability, resilience patterns, API gateway needs, service mesh suggestions."""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nAnalysis: {json.dumps(state['analysis'])}"
    result = await _ask(system, user)
    return {"architecture_notes": result, **_log(state, "Architecture AI Agent", result)}


async def monitoring_agent(state: AgentState) -> dict:
    system = """You are a Monitoring AI Agent. Generate monitoring configuration:
Prometheus scrape configs, Grafana dashboard JSON, alerting rules, log aggregation setup."""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nStrategy: {state['strategy']}"
    result = await _ask(system, user)
    return {"monitoring_config": result, **_log(state, "Monitoring AI Agent", result)}


async def security_agent(state: AgentState) -> dict:
    system = """You are a Security AI Agent. Analyze the deployment plan and provide:
- Security hardening recommendations
- Network policies
- Secrets management approach
- RBAC configuration
- Vulnerability scan checklist"""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nAnalysis: {json.dumps(state['analysis'])}"
    result = await _ask(system, user)
    return {"security_config": result, **_log(state, "Security AI Agent", result)}


async def cost_agent(state: AgentState) -> dict:
    system = """You are a Cost Optimization AI Agent. Estimate infrastructure costs and suggest optimizations:
- Monthly cost estimate by service
- Spot/preemptible instance recommendations
- Right-sizing suggestions
- Reserved instance savings"""
    user = f"Apps: {json.dumps(state['discovered_apps'])}\nStrategy: {state['strategy']}"
    result = await _ask(system, user)
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

def build_graph() -> StateGraph:
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
    """Entry point called by background worker."""
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
    )
    result = await orchestrator.ainvoke(initial_state)
    return result
