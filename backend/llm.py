
import httpx
import json
from typing import AsyncIterator

from config import settings


HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {settings.kimi_k2_api_key}",
}

MODEL = "kimi-k2"   # model name served by the vLLM instance


async def chat(messages: list[dict], temperature: float = 0.3, max_tokens: int = 4096) -> str:
    """Single completion call — returns full response string."""
    payload = {
        "model": MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{settings.kimi_k2_base_url}/v1/chat/completions",
            headers=HEADERS,
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


async def chat_stream(messages: list[dict], temperature: float = 0.3) -> AsyncIterator[str]:
    """Streaming completion — yields token chunks."""
    payload = {
        "model": MODEL,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream(
            "POST",
            f"{settings.kimi_k2_base_url}/v1/chat/completions",
            headers=HEADERS,
            json=payload,
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    chunk = line[6:]
                    if chunk == "[DONE]":
                        break
                    try:
                        delta = json.loads(chunk)["choices"][0]["delta"].get("content", "")
                        if delta:
                            yield delta
                    except Exception:
                        continue
