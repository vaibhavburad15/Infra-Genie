# 🧞 InfraGenie

> **AI-powered infrastructure deployment platform that analyzes your application, generates production-ready infrastructure artifacts, and deploys them with minimal manual effort.**

InfraGenie is an intelligent infrastructure automation platform designed to simplify the journey from **source code → infrastructure → deployment → monitoring**.

Upload an existing project or provide a GitHub repository URL, and InfraGenie uses a **multi-agent AI pipeline** to understand your application, generate deployment artifacts, recommend infrastructure architecture, identify security risks, and estimate cloud costs.

---

## ✨ Key Features

* 📦 **Project Upload** — Upload your project as a ZIP file or provide a GitHub repository URL.
* 🤖 **Multi-Agent AI Analysis** — Multiple specialized AI agents analyze different aspects of your application.
* 🐳 **Docker Generation** — Automatically generate Dockerfiles and Docker Compose configurations.
* ☁️ **Terraform Generation** — Generate Infrastructure as Code for cloud infrastructure.
* ☸️ **Kubernetes Generation** — Generate production-ready Kubernetes manifests.
* 🔄 **CI/CD Automation** — Generate GitHub Actions workflows.
* 🏗️ **Architecture Recommendations** — Get recommendations for scalability, resilience, and infrastructure design.
* 📊 **Monitoring Configuration** — Generate Prometheus and Grafana configurations.
* 🔐 **Security Analysis** — Identify security issues and generate hardening recommendations.
* 💰 **Cost Optimization** — Estimate infrastructure costs and identify potential savings.
* 💬 **AI Infrastructure Assistant** — Ask questions about your project and generated infrastructure through streaming chat.
* 🚀 **One-Click Deployment** — Review and approve generated infrastructure before deployment.
* 📡 **Real-Time Deployment Status** — Track infrastructure provisioning and deployment progress.

---

# 🏗️ Architecture

InfraGenie uses a modern asynchronous architecture designed to handle long-running AI analysis and infrastructure provisioning tasks.

```text
                         ┌──────────────────────┐
                         │      Frontend        │
                         │ React + TypeScript    │
                         │ Vite + Tailwind CSS   │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │       FastAPI        │
                         │   Backend / REST API │
                         └───────┬───────┬──────┘
                                 │       │
                    ┌────────────┘       └─────────────┐
                    ▼                                  ▼
           ┌─────────────────┐                ┌─────────────────┐
           │   PostgreSQL    │                │      Redis      │
           │ Users / Projects│                │ Queue / Cache   │
           │ Deployments     │                └────────┬────────┘
           │ Reports         │                         │
           └─────────────────┘                         ▼
                                             ┌─────────────────┐
                                             │   RQ Worker     │
                                             │ Background Jobs │
                                             └────────┬────────┘
                                                      │
                                                      ▼
                                             ┌─────────────────┐
                                             │    LangGraph    │
                                             │ Multi-Agent AI  │
                                             └────────┬────────┘
                                                      │
                           ┌──────────────────────────┼─────────────────────────┐
                           ▼                          ▼                         ▼
                    AI Agent Pipeline          Project Analysis          Infrastructure
                           │                          │                         │
                           └──────────────────────────┼─────────────────────────┘
                                                      ▼
                                             ┌─────────────────┐
                                             │   Kimi K2 LLM   │
                                             │  Self-Hosted    │
                                             │      vLLM       │
                                             └─────────────────┘
```

---

# 🛠️ Technology Stack

| Layer                 | Technology              |
| --------------------- | ----------------------- |
| Frontend              | React + TypeScript      |
| Build Tool            | Vite                    |
| Styling               | Tailwind CSS            |
| Backend               | Python + FastAPI        |
| Database              | PostgreSQL              |
| Cache / Queue         | Redis + RQ              |
| AI Orchestration      | LangGraph               |
| LLM                   | Kimi K2                 |
| LLM Serving           | vLLM                    |
| Authentication        | JWT                     |
| Background Processing | RQ Workers              |
| Containerization      | Docker + Docker Compose |
| Infrastructure        | Terraform               |
| Orchestration         | Kubernetes              |
| CI/CD                 | GitHub Actions          |
| Monitoring            | Prometheus + Grafana    |

---

# 🤖 AI Agent Pipeline

InfraGenie uses specialized AI agents, with each agent responsible for a specific infrastructure concern.

| #  | Agent                         | Responsibility                         | Output                                        |
| -- | ----------------------------- | -------------------------------------- | --------------------------------------------- |
| 1  | 🔍 Project Analyzer           | Understand the application             | Language, framework, dependencies, complexity |
| 2  | 🧩 Application Discovery      | Identify application components        | Services, applications, ports, dependencies   |
| 3  | 🐳 Docker AI Agent            | Containerize the application           | Dockerfiles, Docker Compose                   |
| 4  | ☁️ Terraform AI Agent         | Design cloud infrastructure            | Terraform IaC                                 |
| 5  | ☸️ Kubernetes AI Agent        | Create Kubernetes deployment resources | K8s manifests                                 |
| 6  | 🔄 CI/CD AI Agent             | Automate deployment workflows          | GitHub Actions pipelines                      |
| 7  | 🏗️ Architecture AI Agent     | Analyze scalability and resilience     | Architecture recommendations                  |
| 8  | 📊 Monitoring AI Agent        | Configure observability                | Prometheus + Grafana configuration            |
| 9  | 🔐 Security AI Agent          | Identify and mitigate security risks   | Hardening, RBAC, network policies             |
| 10 | 💰 Cost Optimization AI Agent | Analyze infrastructure spending        | Cost estimates + optimization recommendations |

> **Note:** The platform currently contains **10 specialized AI agents**, not 8.

---

# 🔄 How InfraGenie Works

```text
┌──────────────┐
│    Upload    │
│ Project /    │
│ GitHub Repo  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│    Project   │
│    Analysis  │
└──────┬───────┘
       │
       ▼
┌─────────────────────────┐
│   Multi-Agent Pipeline  │
│                         │
│ Docker • Terraform      │
│ Kubernetes • CI/CD      │
│ Security • Monitoring   │
│ Architecture • Cost     │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Generated Artifacts     │
│                         │
│ Dockerfiles             │
│ Terraform               │
│ Kubernetes              │
│ GitHub Actions          │
│ Monitoring              │
│ Security Policies       │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│     Review & Approve    │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│       Deployment        │
│ Infrastructure Provision│
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│ Monitoring & AI Chat    │
└─────────────────────────┘
```

---

# 👤 User Flow

### 1. Register / Login

Create an account and authenticate using the application's authentication system.

### 2. Create a Project

Users can either:

* Upload a project as a `.zip` file
* Provide a GitHub repository URL

### 3. Automatic Analysis

Once the project is created, InfraGenie starts an asynchronous background analysis job.

### 4. AI Agent Execution

The LangGraph pipeline coordinates the specialized AI agents.

Agents analyze the project and generate infrastructure artifacts in parallel wherever possible.

### 5. Review Artifacts

Users can review generated:

* Docker configurations
* Terraform infrastructure
* Kubernetes manifests
* CI/CD pipelines
* Monitoring configurations
* Security recommendations
* Architecture recommendations
* Cost estimates

### 6. Approve Deployment

After reviewing the generated infrastructure, users can approve the deployment.

### 7. Infrastructure Provisioning

The deployment pipeline provisions the required infrastructure and deploys the application.

### 8. Monitor Deployment

Users can track deployment progress and status in real time.

### 9. AI Infrastructure Chat

Users can interact with the AI assistant to ask questions about:

* Their application
* Generated infrastructure
* Deployment configuration
* Security
* Scaling
* Costs
* Infrastructure errors

---

# 🚀 Quick Start

## Prerequisites

Make sure the following are installed:

* Python 3.10+
* Node.js 18+
* npm
* Docker
* Docker Compose
* PostgreSQL
* Redis
* Git

You also need access to a **Kimi K2 model served through vLLM**.

---

## 1. Clone the Repository

```bash
git clone <repository-url>
cd InfraGenie
```

---

## 2. Configure Environment Variables

Copy the environment configuration:

```bash
cp .env .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env .env.local
```

Configure the following variables:

```env
KIMI_K2_BASE_URL=http://gpu-server:8080
KIMI_K2_API_KEY=your-api-key

SECRET_KEY=your-secret-key

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=your-username
SMTP_PASSWORD=your-password
SMTP_FROM_EMAIL=noreply@example.com

SMTP_USE_TLS=true
EMAIL_OTP_EXPIRE_MINUTES=10
```

### Environment Variables

| Variable                   | Description                                |
| -------------------------- | ------------------------------------------ |
| `KIMI_K2_BASE_URL`         | URL of the vLLM OpenAI-compatible endpoint |
| `KIMI_K2_API_KEY`          | API key if authentication is enabled       |
| `SECRET_KEY`               | Secret used for JWT signing                |
| `SMTP_HOST`                | SMTP server hostname                       |
| `SMTP_PORT`                | SMTP server port                           |
| `SMTP_USERNAME`            | SMTP username                              |
| `SMTP_PASSWORD`            | SMTP password                              |
| `SMTP_FROM_EMAIL`          | Sender email address                       |
| `SMTP_USE_TLS`             | Enable SMTP TLS                            |
| `EMAIL_OTP_EXPIRE_MINUTES` | OTP expiration time                        |

> If SMTP is not configured in development, the backend prints OTPs to the server console so the registration flow can still be tested.

---

# 🐳 Running with Docker

Start PostgreSQL and Redis:

```bash
docker-compose up -d postgres redis
```

Start the backend, worker, and frontend:

```bash
docker-compose up backend worker frontend
```

Verify that the containers are running:

```bash
docker-compose ps
```

---

# 💻 Running Without Docker

## Backend

Navigate to the backend:

```bash
cd backend
```

Create a virtual environment:

```bash
py -m venv myenv
```

Activate it on Windows PowerShell:

```powershell
.\myenv\Scripts\Activate.ps1
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Start the FastAPI server:

```bash
uvicorn main:app --reload --port 8000
```

---

## Start the Background Worker

Open another terminal:

```bash
cd backend
```

Activate the environment:

```powershell
.\myenv\Scripts\Activate.ps1
```

Start the worker:

```bash
python worker.py
```

The worker processes long-running jobs such as:

* Project analysis
* AI agent execution
* Artifact generation
* Infrastructure operations

---

# 🎨 Frontend

Open another terminal:

```bash
cd frontend
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

---

# 🧠 Kimi K2 / vLLM

InfraGenie uses a self-hosted **Kimi K2** model through a vLLM OpenAI-compatible API.

Example configuration:

```env
KIMI_K2_BASE_URL=http://gpu-server:8080
KIMI_K2_API_KEY=your-api-key
```

Make sure the vLLM server is accessible from the InfraGenie backend.

### Check vLLM Service Logs

If vLLM is running as a systemd service:

```bash
sudo journalctl -u qwen-vllm -n 20 --no-pager
```

Follow logs in real time:

```bash
sudo journalctl -u qwen-vllm -f
```

Check the service status:

```bash
sudo systemctl status qwen-vllm
```

> Replace `qwen-vllm` with the actual systemd service name if your deployment uses a different name.

---

# 📁 Project Structure

```text
InfraGenie/
│
├── backend/
│   ├── agents/
│   │   ├── project_analyzer/
│   │   ├── application_discovery/
│   │   ├── docker/
│   │   ├── terraform/
│   │   ├── kubernetes/
│   │   ├── cicd/
│   │   ├── architecture/
│   │   ├── monitoring/
│   │   ├── security/
│   │   └── cost_optimization/
│   │
│   ├── api/
│   ├── models/
│   ├── services/
│   ├── workers/
│   ├── main.py
│   ├── worker.py
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   ├── components/
│   ├── pages/
│   ├── services/
│   └── package.json
│
├── docker-compose.yml
├── .env
├── .env.local
└── README.md
```

> Adjust the structure above to match the actual repository if your folders differ.

---

# 🔐 Security Considerations

InfraGenie generates and potentially provisions real infrastructure, so security should be treated as a first-class concern.

Important practices include:

* Never commit `.env` or secrets to Git.
* Use strong JWT secrets.
* Protect API endpoints with authentication and authorization.
* Validate uploaded project files.
* Restrict ZIP extraction paths to prevent path traversal.
* Sanitize GitHub repository inputs.
* Review generated Terraform and Kubernetes configurations before deployment.
* Use least-privilege IAM/RBAC permissions.
* Restrict network access to infrastructure services.
* Store secrets using a dedicated secret-management solution in production.
* Do not expose the vLLM endpoint publicly unless required.
* Treat AI-generated infrastructure as **untrusted output that requires validation**.

---

# 📊 Background Processing

InfraGenie uses **Redis + RQ** to handle long-running operations outside the main API process.

Typical workflow:

```text
API Request
    │
    ▼
Create Job
    │
    ▼
Redis Queue
    │
    ▼
RQ Worker
    │
    ▼
LangGraph Pipeline
    │
    ▼
AI Agents
    │
    ▼
Generated Artifacts
    │
    ▼
PostgreSQL
```

This prevents long-running AI operations from blocking the FastAPI request lifecycle.

---

# 🧪 Development

Run the backend:

```bash
uvicorn main:app --reload --port 8000
```

Run the worker:

```bash
python worker.py
```

Run the frontend:

```bash
npm run dev
```

For production deployments, use appropriate process managers, reverse proxies, TLS, secret management, monitoring, and resource limits rather than development servers.

---

# 🚢 Deployment

A typical production deployment can contain:

```text
                    Internet
                       │
                       ▼
                Load Balancer
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
     Frontend                    Backend
          │                         │
          │                 ┌───────┴────────┐
          │                 ▼                ▼
          │             PostgreSQL         Redis
          │                                  │
          │                                  ▼
          │                              RQ Worker
          │                                  │
          │                                  ▼
          │                              LangGraph
          │                                  │
          │                                  ▼
          │                              Kimi K2
          │                                vLLM
          │
          └───────────────┐
                          ▼
                   Cloud Infrastructure
```

---

# 📝 Generated Artifacts

Depending on the project, InfraGenie can generate artifacts such as:

```text
deployment/
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
│
├── terraform/
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   └── providers.tf
│
├── kubernetes/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── configmap.yaml
│   └── ingress.yaml
│
├── .github/
│   └── workflows/
│       └── deploy.yml
│
├── monitoring/
│   ├── prometheus.yml
│   └── grafana/
│
└── security/
    ├── network-policy.yaml
    └── rbac.yaml
```

---

# ⚠️ Production Disclaimer

InfraGenie uses AI to generate infrastructure configurations.

**AI-generated infrastructure must be reviewed before being deployed to production.**

Generated Terraform, Kubernetes manifests, IAM/RBAC policies, networking rules, security configurations, and cost estimates may contain errors or assumptions that do not match your environment.

Always validate:

* Infrastructure configuration
* Credentials and secrets
* Network rules
* IAM/RBAC permissions
* Resource sizing
* Kubernetes configurations
* Terraform plans
* Estimated cloud costs

Before executing infrastructure changes, review the generated plan and obtain the required approval.

---

# 🗺️ Roadmap

Potential future improvements include:

* [ ] AWS / Azure / GCP account integration
* [ ] Multi-cloud deployment
* [ ] Infrastructure drift detection
* [ ] Automated rollback
* [ ] Terraform plan visualization
* [ ] Kubernetes cluster health monitoring
* [ ] Advanced cost forecasting
* [ ] Infrastructure security scoring
* [ ] Deployment approval workflows
* [ ] GitHub App integration
* [ ] GitLab integration
* [ ] Infrastructure versioning
* [ ] Deployment history and rollback
* [ ] Advanced observability
* [ ] Multi-user teams and RBAC

---

# 🤝 Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a feature branch.

```bash
git checkout -b feature/your-feature
```

3. Make your changes.
4. Test your changes.
5. Commit your changes.

```bash
git commit -m "feat: add your feature"
```

6. Push the branch.

```bash
git push origin feature/your-feature
```

7. Open a Pull Request.

---

# 📄 License

Add your project's license information here.

---

## 🧞 InfraGenie

**From source code to production infrastructure — powered by AI.**
