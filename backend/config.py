"""
InfraGenie — Central Configuration

All values are read from environment variables (or a .env file).
This file contains ONLY:
  - The Settings class and its field type definitions
  - Environment variable mappings
  - Genuinely safe, non-sensitive generic defaults
  - The settings singleton
"""
from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str
    redis_url: str
    redis_container: str = ""              # REDIS_CONTAINER — Redis Docker container name

    # ── LLM (OpenAI-compatible vLLM) ─────────────────────────────────────────
    llm_base_url: str
    llm_api_key: str = ""
    llm_model: str
    llm_timeout: float = 300.0                 # LLM_TIMEOUT
    llm_max_concurrency: int = 4               # LLM_MAX_CONCURRENCY
    llm_stream_to_logs: bool = True            # LLM_STREAM_TO_LOGS — pipe chunks into SSE

    # ── Repository cloning ────────────────────────────────────────────────────
    # Where GitHub repos / uploaded zips are physically checked out for analysis.
    # IMPORTANT: keep this OUTSIDE backend/ — if it sits inside the folder that
    # uvicorn --reload watches, every extracted file triggers a server reload,
    # killing in-flight SSE streams and requests.
    repo_clone_dir: str = ""                   # REPO_CLONE_DIR — empty → ~/infragenie-repos

    # Where the uploaded .zip files are stored, and where deployment artifacts
    # are written. Both default to sibling dirs of REPO_CLONE_DIR (outside the
    # watched source tree) so the reloader never sees them.
    infra_upload_dir: str = ""                 # INFRA_UPLOAD_DIR — empty → ~/uploads
    infra_artifact_dir: str = ""               # INFRA_ARTIFACT_DIR — empty → ~/deployment_output

    # ── Static analysis limits ────────────────────────────────────────────────
    static_analysis_max_files: int = 400       # STATIC_ANALYSIS_MAX_FILES
    static_analysis_max_loc: int = 250_000     # STATIC_ANALYSIS_MAX_LOC

    # ── Deployment ─────────────────────────────────────────────────────────────
    deployment_mode: str = "simulate"          # simulate | artifacts

    # ── Auth / JWT ────────────────────────────────────────────────────────────
    secret_key: str
    access_token_expire_minutes: int = 1440

    # ── SMTP ──────────────────────────────────────────────────────────────────
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_from_email: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True
    email_otp_expire_minutes: int = 10

    # ── App ───────────────────────────────────────────────────────────────────
    app_env: str = "development"
    frontend_url: str = "http://localhost:5173"
    vite_api_url: str = "http://localhost:8000"

    class Config:
        env_file = ("../.env", ".env")

    @property
    def resolved_clone_dir(self) -> Path:
        """Absolute Path for repo clones (created on first use)."""
        raw = (self.repo_clone_dir or "").strip()
        if raw:
            return Path(raw).expanduser().resolve()
        return (Path.home() / "infragenie-repos").resolve()

    @property
    def resolved_upload_dir(self) -> Path:
        """Absolute Path for uploaded archives (created on first use)."""
        raw = (self.infra_upload_dir or "").strip()
        if raw:
            return Path(raw).expanduser().resolve()
        return (Path.home() / "uploads").resolve()

    @property
    def resolved_artifact_dir(self) -> Path:
        """Absolute Path for deployment artifact output (created on first use)."""
        raw = (self.infra_artifact_dir or "").strip()
        if raw:
            return Path(raw).expanduser().resolve()
        return (Path.home() / "deployment_output").resolve()


settings = Settings()  # pyright: ignore[reportCallIssue]