InfraGenie — Bug-fix patch (2026-09-01)
Fixes the four issues observed in the live demo (screen-recording + vLLM logs + wobb-influencer-dashboard run).

1. Wrong tech-stack detection (said "Python / Streamlit" for a TypeScript app)
Root cause: backend/tasks.py::summarize_project_files() treated every GitHub URL as an atomic value — the "code summary" sent to the AI was literally the URL string, so the model had nothing to inspect and hallucinated a stack.

Fix: the summarizer now shallow-clones the repo (git clone --depth 1 via gitpython, already in requirements.txt), skips noise dirs (node_modules, dist, .git, ...), and lists stack-identifying manifests first (package.json, tsconfig*.json, vite.config.*, requirements.txt, pyproject.toml, Dockerfile, ...). If the clone fails, the project is marked failed with a clear log instead of "analyzing" an empty summary.

2. "LLM is not working / unreachable" while vLLM returned HTTP 200
Root cause: the LangGraph pipeline launches 8 agents in parallel. On a slow self-hosted vLLM, those 8 concurrent requests starve each other and each blows the old fixed 120 s httpx timeout → LLMUnavailableError: did not respond in time → rendered in the UI as "LLM is not working".

Fix (backend/llm.py + backend/config.py):

per-request timeout is now configurable: LLM_TIMEOUT (default 300 s);
a global semaphore caps concurrent LLM calls: LLM_MAX_CONCURRENCY (default 4) — requests queue instead of starving;
the timeout error now says "server overloaded — re-running analysis usually succeeds; raise LLM_TIMEOUT or lower LLM_MAX_CONCURRENCY" instead of implying the server is down;
agent outputs are capped (max_tokens=2048) with a "be concise" instruction so each call finishes faster.
3. User approval never appeared
Root cause: the approval UI existed only on the Deployments page; the Projects drawer showed a misleading "Re-analyze & Deploy" button that never approved or deployed.

Fix (frontend/src/pages/ProjectsPage.tsx): when a project is ready, the drawer now fetches deployments and shows a real "Approve & Deploy" button for the deployment awaiting approval, with inline status feedback. The old button is now truthfully labeled "Re-analyze".

4. "Did not connect to the user's AWS account"
Reality: deployment was fully simulated (time.sleep per step) and nothing in the codebase talks to AWS — the Settings-page "Connected" badges were cosmetic.

Fix + honesty (backend/tasks.py): on "deploy" the AI-generated artifacts (Dockerfile/compose, Terraform main.tf, K8s YAML, CI/CD workflow, Prometheus) are now written to ./deployment_output/<project>/<deployment>/ so the pipeline has tangible output. DEPLOYMENT_MODE (simulate default) documents the semantics. Real AWS provisioning is a separate milestone (needs Terraform CLI + AWS credentials, or SDK wiring) — see "AWS next steps" below.

Files changed
backend/config.py — new settings: llm_timeout, llm_max_concurrency, deployment_mode
backend/llm.py — concurrency semaphore, configurable timeout, honest timeout message
backend/agents.py — max_tokens=2048 + concise-output instruction per agent
backend/tasks.py — real GitHub clone summarizer; clear failure on bad source; artifacts written to disk on deploy
backend/main.py — job timeouts 600→1800 s (analysis) / 300→600 s (deploy); /stream/insights now owner-checked; upload filename sanitized
.env.example — new variables documented
frontend/src/pages/ProjectsPage.tsx — "Approve & Deploy" button in project drawer; truthful labels
How to apply
Copy the changed files over your repo (or unzip this archive into Infra-Genie-main/).
Add to your .env:
CopyLLM_TIMEOUT=300
LLM_MAX_CONCURRENCY=4
DEPLOYMENT_MODE=simulate
Restart the backend and the worker; rebuild the frontend (npm run build or restart npm run dev).
Re-run analysis on the GitHub project — the Analysis tab should now detect TypeScript / React / Vite (or whatever is real), and the drawer shows Approve & Deploy.
AWS — honest options (pick one)
Keep it simulated (current): best for the viva demo — no credentials, no cost, artifacts on disk + Deployments page progress. Label slides as "provisioning simulated".
Middle path (recommended next): write the generated main.tf to disk and run terraform plan in the worker when Terraform CLI + AWS creds are present on the server (DEPLOYMENT_MODE=plan) — real plan output without applying anything.
Full AWS: wire boto3/provider SDKs or terraform apply and real ECR/ECS/EC2 steps, with IAM least-privilege and approval already in place. This is a few days of work; the architecture supports it.
Note: AI-generated infrastructure is untrusted — keep the manual review step before applying anything real.

v2 — Pylance / TypeScript diagnostics (2026-09-02)
Fixes the editor errors surfaced after applying v1:

agents.py (reportAttributeAccessIssue on .pop, reportCallIssue/reportArgumentType on update) — asyncio.gather(..., return_exceptions=True) types the fan-out results as dict | BaseException. Narrowing with isinstance(outcome, Exception) does not remove the BaseException member (it is a supertype), so Pylance still allowed a BaseException into the else branch. The failure branch now checks BaseException directly (with LLMUnavailableError checked first), so the else branch is statically dict.
main.py ("get_queue / get_redis_conn / task_analyze_project / task_run_deployment is unknown import symbol") — caused by tasks.py now importing git (GitPython). If GitPython is missing from the interpreter Pylance uses, the whole tasks.py module fails analysis and every name imported from it becomes "unknown". Fixed two ways: (a) the from git import Repo import is now guarded with try/except ImportError (repo cloners get a clear "pip install -r backend/requirements.txt" error instead of a crash); (b) run pip install -r backend/requirements.txt in the interpreter VS Code has selected.
ProjectsPage.tsx (TS2345) — listDeployments() returns Promise<unknown>, so the .then((deps: any[]) => …) annotation was rejected. The handler now leaves the parameter untyped and narrows inside with (deps as Array<{id,status}>).
No behaviour changes beyond the above.

tasks.py (reportOptionalMemberAccess on Repo.clone_from) — the Repo = None fallback made type-checkers treat Repo as type | None; it is now pre-annotated Repo: Any = None before the guarded import, so the fallback path is fully static-clean.