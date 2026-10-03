"""Claude API wrapper. Har call structured output (Pydantic) return karta hai."""
import os

import anthropic

MODEL = os.environ.get("LLM_MODEL", "claude-opus-5-5")
_client = None


class LLMError(Exception):
    pass


def configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _get_client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic(max_retries=4, timeout=600)
    return _client


def ask(system: str, prompt: str, schema, effort: str = "medium", max_tokens: int = 16000):
    if not configured():
        raise LLMError("ANTHROPIC_API_KEY is not set")
    try:
        # streaming: lambe outputs par HTTP timeout se bachne ke liye
        with _get_client().beta.messages.stream(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_format=schema,
            output_config={"effort": effort},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        ) as stream:
            resp = stream.get_final_message()
    except anthropic.AuthenticationError as e:
        raise LLMError("Anthropic API key is invalid") from e
    except anthropic.RateLimitError as e:
        raise LLMError("Anthropic rate limit hit; will retry later") from e
    except anthropic.APIStatusError as e:
        raise LLMError(f"Anthropic API error {e.status_code}: {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise LLMError("could not reach the Anthropic API") from e
    if resp.stop_reason == "refusal":
        raise LLMError("model declined the request")
    if resp.stop_reason == "max_tokens":
        raise LLMError("output was cut off at max_tokens")
    if resp.parsed_output is None:
        raise LLMError("could not parse model output")
    return resp.parsed_output
