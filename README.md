# InfraGenie 🧞

AI-powered infrastructure deployment platform. Upload your project, let 8 specialized AI agents analyze and generate production-ready deployment artifacts, then approve and deploy with one click.

## Architecture

- **Frontend**: React + TypeScript (Vite + Tailwind)
- **Backend**: Python FastAPI (async)
- **Database**: PostgreSQL (users, projects, deployments, reports)
- **Cache / Queue**: Redis + RQ (background jobs)
- **AI Orchestration**: LangGraph multi-agent pipeline
- **LLM**: Self-hosted Kimi K2 (vLLM OpenAI-compatible endpoint)

## AI Agents

| Agent | Output |
|---|---|
| Project Analyzer | Language, framework, complexity |
| Application Discovery | List of services/apps |
| Docker AI Agent | Dockerfiles, docker-compose |
| Terraform AI Agent | IaC for cloud infra |
| Kubernetes AI Agent | K8s manifests |
| CI/CD AI Agent | GitHub Actions pipeline |
| Architecture AI Agent | Scaling / resilience recommendations |
| Monitoring AI Agent | Prometheus + Grafana config |
| Security AI Agent | Hardening, network policies, RBAC |
| Cost Optimization AI Agent | Monthly cost estimate + savings |

## Quick Start

### 1. Configure environment
```
cp .env .env.local   # or edit .env directly
```
Fill in:
- `KIMI_K2_BASE_URL` — your vLLM server address (e.g. `http://gpu-server:8080`)
- `KIMI_K2_API_KEY` — API key if required
- `SECRET_KEY` — random secret for JWT signing
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` — mail server settings for email OTP
- `SMTP_USE_TLS=true` — keep enabled for most SMTP providers
- `EMAIL_OTP_EXPIRE_MINUTES` — OTP lifetime, defaults to 10

If you do not configure SMTP, the backend prints OTPs to the server console in development so you can still test the registration flow.

### 2. Start services with Docker Compose
```bash
docker-compose up -d postgres redis
docker-compose up backend worker frontend
```

### 3. Without Docker (dev mode)

**Backend:**
```bash
cd backend
py  -m venv myenv
.\myenv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# in a second terminal:
python worker.py
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

## User Flow

1. Register / Login
2. Create a project (upload ZIP or paste GitHub URL)
3. Analysis kicks off automatically via background job
4. 8 AI agents run in parallel via LangGraph
5. Review generated artifacts (Docker, Terraform, K8s, CI/CD, etc.)
6. Approve deployment — infrastructure provisioning runs
7. Monitor deployment status in real-time
8. Ask the AI any questions about the project via streaming chat


sudo journalctl -u qwen-vllm -n 20 --no-pager