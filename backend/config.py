from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://postgres:password@localhost:5432/infragenie"
    redis_url: str = "redis://localhost:6379"

    kimi_k2_base_url: str = ""
    kimi_k2_api_key: str = ""

    secret_key: str = "change-this-secret"
    access_token_expire_minutes: int = 1440

    app_env: str = "development"
    frontend_url: str = "http://localhost:5173"

    class Config:
        env_file = ".env"


settings = Settings()
