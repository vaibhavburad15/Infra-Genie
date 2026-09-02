"""
InfraGenie — LLM Client

Thin httpx wrapper around an OpenAI-compatible vLLM endpoint.
All configuration (base URL, API key, model name) is read exclusively from
the Settings singleton.

Concurrency fix (carried forward from v2):
  The LangGraph pipeline launches 8 specialist agents in parallel. On a slow
  self-hosted vLLM those requests starve each other and blow the timeout —
  UI shows "LLM is not working" even though the server is up. We now:
   1. cap concurrent calls with a semaphore (settings.llm_max_concurrency);
   2. use a configurable per-request timeout (settings.llm_timeout);
   3. tell the timeout message apart from "unreachable".
"""
import httpx
import json
import asyncio
from typing import AsyncIterator, Callable, Optional

from config import settings


class LLMUnavailableError(Exception):
    """All LLM failures are wrapped in this. str(err) is user-facing."""
    pass

# Lazy-init at import time. Python >= 3.10 binds the loop lazily, so an
# asyncio.Semaphore created at module load time is safe across FastAPI lifespans.
_semaphore = asyncio.Semaphore(settings.llm_max_concurrency)


def _headers() -> dict:
    h = {"Content-Type": "application/json"}
    if settings.llm_api_key:
        h["Authorization"] = f"Bearer {settings.llm_api_key}"
    return h


def _friendly_llm_error(exc: Exception, timeout: float) -> LLMUnavailableError:
    base = settings.llm_base_url
    if isinstance(exc, httpx.ConnectError):
        return LLMUnavailableError(
            f"Could not connect to the LLM service at {base}. "
            f"Make sure vLLM is running and reachable from this machine."
        )
    if isinstance(exc, httpx.TimeoutException):
        return LLMUnavailableError(
            f"The LLM service at {base} did not respond within {timeout:g}s. "
            f"The server is overloaded (8 specialists call it in parallel; "
            f"InfraGenie caps concurrency at {settings.llm_max_concurrency}). "
            f"Re-running usually succeeds. Or raise LLM_TIMEOUT / lower LLM_MAX_CONCURRENCY."
        )
    if isinstance(exc, httpx.HTTPStatusError):
        c = exc.response.status_code
        if c in (401, 403):
            return LLMUnavailableError(
                f"LLM at {base} rejected the request (HTTP {c}). Check LLM_API_KEY."
            )
        if c == 404:
            return LLMUnavailableError(
                f"LLM at {base} returned 404. Check LLM_BASE_URL and LLM_MODEL."
            )
        return LLMUnavailableError(f"LLM at {base} error (HTTP {c}): {exc.response.text[:180]}")
    if isinstance(exc, (KeyError, IndexError, TypeError, json.JSONDecodeError)):
        return LLMUnavailableError(
            f"LLM at {base} returned an unexpected response format. Check LLM_MODEL."
        )
    if isinstance(exc, httpx.RequestError):
        return LLMUnavailableError(f"Could not reach LLM at {base}: {exc}")
    return LLMUnavailableError(f"LLM request failed: {exc}")


async def chat(messages, temperature=0.3, max_tokens=4096, timeout=None) -> str:
    if timeout is None:
        timeout = settings.llm_timeout
    payload = {"model": settings.llm_model, "messages": messages,
               "temperature": temperature, "max_tokens": max_tokens}
    async with _semaphore:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    f"{settings.llm_base_url}/chat/completions",
                    headers=_headers(), json=payload,
                )
                resp.raise_for_status()
                data = resp.json()
                return data["choices"][0]["message"]["content"]
        except LLMUnavailableError:
            raise
        except Exception as exc:
            raise _friendly_llm_error(exc, timeout) from exc


async def check_llm_health() -> None:
    """Fast preflight: confirms endpoint is reachable AND returns usable output."""
    await chat([{"role": "user", "content": "Reply with the single word: ok"}],
               temperature=0, max_tokens=5, timeout=15)


async def chat_stream(
    messages,
    temperature=0.3,
    on_chunk: Optional[Callable[[str], None]] = None,
    max_tokens: int = 2048,
    timeout: Optional[float] = None,
) -> AsyncIterator[str]:
    """Stream completion; yields token chunks. Optionally calls `on_chunk(text)`
    for each chunk received — used to pipe tokens into the SSE log stream so
    the user sees the LLM's output live in the analysis terminal.

    Falls back to non-streaming `chat()` if the endpoint doesn't support
    streaming or returns a non-SSE response (e.g. some vLLM versions).
    """
    if timeout is None:
        timeout = settings.llm_timeout
    payload = {"model": settings.llm_model, "messages": messages,
               "temperature": temperature, "stream": True, "max_tokens": max_tokens}

    async def _consume_non_stream_fallback() -> AsyncIterator[str]:
        """Used when the endpoint rejects streaming — still gives caller bytes."""
        text = await chat(messages, temperature=temperature, max_tokens=max_tokens, timeout=timeout)
        if on_chunk:
            # report in one shot
            try: on_chunk(text)
            except Exception: pass
        yield text

    async with _semaphore:
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                async with client.stream(
                    "POST", f"{settings.llm_base_url}/chat/completions",
                    headers=_headers(), json=payload,
                ) as resp:
                    if resp.status_code >= 400:
                        body = (await resp.aread()).decode("utf-8", "ignore")[:200]
                        raise LLMUnavailableError(
                            f"LLM stream error (HTTP {resp.status_code}): {body}"
                        )
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        chunk = line[6:]
                        if chunk == "[DONE]":
                            return
                        try:
                            j = json.loads(chunk)
                            delta = (j.get("choices") or [{}])[0].get("delta", {}).get("content", "")
                            if delta:
                                if on_chunk:
                                    try: on_chunk(delta)
                                    except Exception: pass
                                yield delta
                        except Exception:
                            continue
            except LLMUnavailableError:
                raise
            except Exception as exc:
                # Network/timeout errors: do NOT silently fall back to non-stream
                # (the caller sets on_chunk in a worker thread and would see
                # duplicated output); surface as a clear error instead.
                raise _friendly_llm_error(exc, timeout) from exc