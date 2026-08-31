"""
Quick LLM connectivity test.
Run from the backend/ directory:
    python test_llm.py

Verifies:
  1. settings.llm_base_url is read correctly from .env
  2. settings.llm_model is read correctly from .env
  3. llm.chat() sends to {LLM_BASE_URL}/chat/completions
  4. A valid response is returned

Does NOT print API keys or secrets.
"""
import asyncio
import sys
import llm
import config


def main():
    s = config.settings

    print("=" * 60)
    print("InfraGenie — LLM Connectivity Test")
    print("=" * 60)
    print(f"  LLM base URL : {s.llm_base_url}")
    print(f"  LLM model    : {s.llm_model}")
    print(f"  API key set  : {'yes' if s.llm_api_key else 'no (unauthenticated)'}")
    print(f"  Request URL  : {s.llm_base_url}/chat/completions")
    print("=" * 60)
    print("Sending test prompt...")

    prompt = "Write a Terraform resource for an AWS S3 bucket with versioning enabled."

    try:
        result = asyncio.run(llm.chat([
            {"role": "user", "content": prompt}
        ]))
    except Exception as exc:
        print(f"\n[FAIL] Request failed: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"\n[OK] Response received — {len(result)} characters\n")
    print("-" * 60)
    print(result[:600])
    if len(result) > 600:
        print(f"\n... (truncated, full response is {len(result)} chars)")
    print("-" * 60)


if __name__ == "__main__":
    main()
