"""
InfraGenie — LLM Client

Thin httpx wrapper around an OpenAI-compatible vLLM endpoint.
All configuration (base URL, API key, model name) is read exclusively
from the Settings singleton — never hard-coded here.

Request URL pattern:
    {LLM_BASE_URL}/chat/completions
    e.g. http://<host>:8000/v1/chat/completions

Do NOT append /v1 here; it is already part of LLM_BASE_URL in .env.

Concurrency fix:
    The LangGraph pipeline launches 8 specialist agents in parallel. On a
    slow self-hosted vLLM (shared GPU), 8 simultaneous requests starve each
    other and every request blows past the old fixed 120 s timeout — which
    the UI then rendered as "LLM is not working" even though the server
    returned 200 on the health check. We now:
      1. throttle concurrent calls with a semaphore (LLM_MAX_CONCURRENCY),
         so each request gets its full time budget;
      2. make the per-request timeout configurable (LLM_TIMEOUT, default 300 s);
      3. tell the timeout message apart from "unreachable".
"""
import httpx
import json
import asyncio
from typing import AsyncIterator

from config import settings


class LLMUnavailableError(Exception):
    """Raised whenever the configured LLM endpoint can't be reached or fails
    to return a usable response. Always carries a short, user-facing message
    — callers can surface str(err) directly in logs/UI without translation.
    """
    pass


# Cap the total number of in-flight chat requests against the (single) vLLM
# endpoint. Created at import time; Python 3.10+ binds the loop lazily.
_semaphore = asyncio.Semaphore(settings.llm_max_concurrency)


def _headers() -> dict:
    """Build request headers at call-time so the API key is always current.
    The Authorization header is omitted entirely when llm_api_key is empty,
    because sending 'Bearer ' (empty token) is rejected by most servers.
    """
    headers = {"Content-Type": "application/json"}
    if settings.llm_api_key:
        headers["Authorization"] = f"Bearer {settings.llm_api_key}"
    return headers


def _friendly_llm_error(exc: Exception, timeout: float) -> LLMUnavailableError:
    """Translate a low-level httpx/parsing error into a clear, user-facing message."""
    base = settings.llm_base_url

    if isinstance(exc, httpx.ConnectError):
        return LLMUnavailableError(
            f"Could not connect to the LLM service at {base}. "
            f"Make sure the LLM server (vLLM) is running and reachable from this machine."
        )
    if isinstance(exc, httpx.TimeoutException):
        # A timeout is NOT the same as "unreachable": the health check passed and
        # the server is up — it is just slow under load. Say so with a recovery hint.
        return LLMUnavailableError(
            f"The LLM service at {base} did not respond within {timeout:g}s. "
            f"The server is likely overloaded (8 agents call it concurrently; "
            f"InfraGenie caps parallelism at {settings.llm_max_concurrency}). "
            f"Re-running the analysis usually succeeds. If it keeps timing out, "
            f"raise LLM_TIMEOUT or lower LLM_MAX_CONCURRENCY in your .env."
        )
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in (401, 403):
            return LLMUnavailableError(
                f"The LLM service at {base} rejected the request (HTTP {code}). "
                f"Check that LLM_API_KEY is set correctly."
            )
        if code == 404:
            return LLMUnavailableError(
                f"The LLM service at {base} returned HTTP 404. "
                f"Check LLM_BASE_URL and LLM_MODEL are correct."
            )
        detail = exc.response.text[:200]
        return LLMUnavailableError(
            f"The LLM service at {base} returned an error (HTTP {code}): {detail}"
        )
    if isinstance(exc, (KeyError, IndexError, TypeError, json.JSONDecodeError)):
        return LLMUnavailableError(
            f"The LLM service at {base} returned an unexpected response format. "
            f"Check that LLM_MODEL matches a model actually served at that endpoint."
        )
    if isinstance(exc, httpx.RequestError):
        return LLMUnavailableError(
            f"Could not reach the LLM service at {base}: {exc}"
        )
    return LLMUnavailableError(f"LLM request failed: {exc}")


async def chat(
    messages: list[dict],
    temperature: float = 0.3,
    max_tokens: int = 4096,
    timeout: float | None = None,
) -> str:
    """Single completion — returns the full response string.

    Waits for a concurrency slot first (so 8 parallel agents do not starve a
    slow endpoint), then uses settings.llm_timeout unless overridden.

    Raises LLMUnavailableError (never a raw httpx/parsing exception) so callers
    can log or display str(err) directly as a clear reason for failure.
    """
    if timeout is None:
        timeout = settings.llm_timeout
    payload = {
        "model": settings.llm_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    async with _semaphore:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    f"{settings.llm_base_url}/chat/completions",
                    headers=_headers(),
                    json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
                return data["choices"][0]["message"]["content"]
        except LLMUnavailableError:
            raise
        except Exception as exc:
            raise _friendly_llm_error(exc, timeout) from exc


async def check_llm_health() -> None:
    """Fast pre-flight check: confirms the LLM endpoint is reachable and
    returns a usable completion, without waiting for the full timeout used
    by the real analysis calls. Raises LLMUnavailableError on failure.
    """
    await chat(
        [{"role": "user", "content": "Reply with the single word: ok"}],
        temperature=0,
        max_tokens=5,
        timeout=15,
    )


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
    async with _semaphore:
        async with httpx.AsyncClient(timeout=settings.llm_timeout) as client:
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