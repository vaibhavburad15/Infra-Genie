"""
InfraGenie — Central Configuration

All values are read from environment variables (or a .env file).
This file contains ONLY:
  - The Settings class and its field type definitions
  - Environment variable mappings
  - Genuinely safe, non-sensitive generic defaults
  - The settings singleton

DO NOT hard-code secrets, IP addresses, model names, passwords,
API keys, or production-specific URLs in this file.
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str                          # e.g. postgresql://user:pass@host/db
    redis_url: str                             # e.g. redis://localhost:6379

    # ── LLM (OpenAI-compatible vLLM) ─────────────────────────────────────────
    llm_base_url: str                          # e.g. http://<host>:8000/v1
    llm_api_key: str = ""                      # empty string = unauthenticated endpoint
    llm_model: str                             # e.g. Qwen/Qwen3-Coder-Next-FP8 (read from LLM_MODEL)

    # ── Auth / JWT ────────────────────────────────────────────────────────────
    secret_key: str                            # JWT signing secret — must be set
    access_token_expire_minutes: int = 1440    # 24 hours; safe non-sensitive default

    # ── SMTP / Email OTP ──────────────────────────────────────────────────────
    smtp_host: str = ""                        # empty = OTP printed to console (dev)
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_from_email: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True
    email_otp_expire_minutes: int = 10         # safe non-sensitive default

    # ── App ───────────────────────────────────────────────────────────────────
    app_env: str = "development"               # safe non-sensitive default
    frontend_url: str = "http://localhost:5173"
    vite_api_url: str = "http://localhost:8000"

    class Config:
        env_file = ("../.env", ".env")


# BaseSettings resolves required values from the environment and configured .env files.
# Pylance's generated BaseModel constructor signature cannot represent that source.
settings = Settings()  # pyright: ignore[reportCallIssue]
