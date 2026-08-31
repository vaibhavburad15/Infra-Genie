"""
InfraGenie — LLM Client

Thin httpx wrapper around an OpenAI-compatible vLLM endpoint.
All configuration (base URL, API key, model name) is read exclusively
from the Settings singleton — never hard-coded here.

Request URL pattern:
    {LLM_BASE_URL}/chat/completions
    e.g. http://<host>:8000/v1/chat/completions

Do NOT append /v1 here; it is already part of LLM_BASE_URL in .env.
"""
import httpx
import json
from typing import AsyncIterator

from config import settings


def _headers() -> dict:
    """Build request headers at call-time so the API key is always current.
    The Authorization header is omitted entirely when llm_api_key is empty,
    because sending 'Bearer ' (empty token) is rejected by most servers.
    """
    headers = {"Content-Type": "application/json"}
    if settings.llm_api_key:
        headers["Authorization"] = f"Bearer {settings.llm_api_key}"
    return headers


async def chat(
    messages: list[dict],
    temperature: float = 0.3,
    max_tokens: int = 4096,
) -> str:
    """Single completion — returns the full response string."""
    payload = {
        "model": settings.llm_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{settings.llm_base_url}/chat/completions",
            headers=_headers(),
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def chat_stream(
    messages: list[dict],
    temperature: float = 0.3,
) -> AsyncIterator[str]:
    """Streaming completion — yields token chunks as they arrive."""
    payload = {
        "model": settings.llm_model,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream(
            "POST",
            f"{settings.llm_base_url}/chat/completions",
            headers=_headers(),
            json=payload,
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    chunk = line[6:]
                    if chunk == "[DONE]":
                        break
                    try:
                        delta = (
                            json.loads(chunk)["choices"][0]["delta"].get("content", "")
                        )
                        if delta:
                            yield delta
                    except Exception:
                        continue
