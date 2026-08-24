import os
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field
import litellm
from fastapi import Request

# Suppress litellm telemetry noise
litellm.telemetry = False
litellm.drop_params = True

PRESET_PROVIDERS = [
    {
        "id": "openai",
        "name": "OpenAI",
        "default_model": "gpt-5.4-mini",
        "models": ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
        "default_base": "https://api.openai.com/v1",
        "requires_key": True,
    },
    {
        "id": "anthropic",
        "name": "Anthropic",
        "default_model": "claude-sonnet-5",
        "models": ["claude-sonnet-5", "claude-fable-5", "claude-opus-4-8", "claude-haiku-4-5", "claude-3-7-sonnet-20250219"],
        "default_base": "https://api.anthropic.com",
        "requires_key": True,
    },
    {
        "id": "gemini",
        "name": "Google Gemini",
        "default_model": "gemini-3.6-flash",
        "models": ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.1-pro", "gemini-3-flash", "gemini-3.1-flash-lite"],
        "default_base": "https://generativelanguage.googleapis.com",
        "requires_key": True,
    },
    {
        "id": "openrouter",
        "name": "OpenRouter",
        "default_model": "anthropic/claude-sonnet-5",
        "models": [
            "anthropic/claude-sonnet-5",
            "anthropic/claude-fable-5",
            "google/gemini-3.6-flash",
            "deepseek/deepseek-v4-pro",
            "deepseek/deepseek-v4-flash",
            "meta-llama/llama-3.3-70b-instruct",
            "qwen/qwen-2.5-72b-instruct",
        ],
        "default_base": "https://openrouter.ai/api/v1",
        "requires_key": True,
    },
    {
        "id": "deepseek",
        "name": "DeepSeek",
        "default_model": "deepseek-v4-flash",
        "models": ["deepseek-v4-flash", "deepseek-v4-pro"],
        "default_base": "https://api.deepseek.com/v1",
        "requires_key": True,
    },
    {
        "id": "ollama",
        "name": "Ollama (Local)",
        "default_model": "llama3.3",
        "models": ["llama3.3", "llama3.2", "qwen2.5-coder", "deepseek-r1:8b", "mistral", "gemma2"],
        "default_base": os.getenv("OLLAMA_URL", "http://localhost:11434"),
        "requires_key": False,
    },
    {
        "id": "custom",
        "name": "Custom OpenAI-Compatible",
        "default_model": "default",
        "models": ["default"],
        "default_base": os.getenv("CUSTOM_PROVIDER_BASE", "http://localhost:8000/v1"),
        "requires_key": False,
    },
]


DEFAULT_FALLBACK_MODEL = os.getenv("BYOK_DEFAULT_MODEL", "gpt-5.4-mini")


def get_provider_default_model(provider: str) -> str:
    p_lower = provider.lower()
    for prov in PRESET_PROVIDERS:
        if prov["id"] == p_lower:
            return prov["default_model"]
    return DEFAULT_FALLBACK_MODEL


class BYOKConfig(BaseModel):
    provider: str = Field(default="openai", description="AI Provider ID (openai, anthropic, gemini, ollama, openrouter, deepseek, custom)")
    api_key: Optional[str] = Field(default=None, description="API Key for the provider")
    model: str = Field(default=DEFAULT_FALLBACK_MODEL, description="Model name or ID")
    api_base: Optional[str] = Field(default=None, description="Custom Base URL if applicable")
    custom_headers: Optional[Dict[str, str]] = Field(default=None, description="Additional HTTP headers")


def extract_byok_config(request: Optional[Request] = None, headers: Optional[Dict[str, str]] = None) -> BYOKConfig:
    """
    Extract BYOK configuration from request headers (X-BYOK-*) with environment fallback.
    """
    header_map = {}
    if request:
        header_map = {k.lower(): v for k, v in request.headers.items()}
    elif headers:
        header_map = {k.lower(): v for k, v in headers.items()}

    provider = header_map.get("x-byok-provider") or os.getenv("BYOK_PROVIDER", "openai")
    api_key = header_map.get("x-byok-key") or os.getenv("BYOK_API_KEY")
    default_model = get_provider_default_model(provider)
    model = header_map.get("x-byok-model") or os.getenv("BYOK_MODEL") or default_model
    api_base = header_map.get("x-byok-api-base") or os.getenv("BYOK_API_BASE")

    # Clean up empty strings or placeholders
    if api_key in ["", "your_api_key_here"]:
        api_key = None
    if api_base == "":
        api_base = None

    return BYOKConfig(
        provider=provider.lower(),
        api_key=api_key,
        model=model,
        api_base=api_base,
    )


def format_litellm_model(config: BYOKConfig) -> str:
    """
    Map provider + model to LiteLLM model routing format.
    """
    provider = config.provider.lower()
    model = config.model

    if "/" in model:
        # User explicitly specified provider/model (e.g. openrouter/anthropic/claude-3)
        return model

    if provider == "openai":
        return f"openai/{model}"
    elif provider == "anthropic":
        return f"anthropic/{model}"
    elif provider in ["gemini", "google"]:
        return f"gemini/{model}"
    elif provider == "openrouter":
        return f"openrouter/{model}"
    elif provider == "deepseek":
        return f"deepseek/{model}"
    elif provider == "ollama":
        return f"ollama/{model}"
    elif provider == "custom":
        return f"openai/{model}"
    else:
        return model


async def byok_completion(
    messages: list[dict],
    config: Optional[BYOKConfig] = None,
    timeout: float = 45.0,
) -> str:
    """
    Execute text completion across any provider via LiteLLM.
    """
    if config is None:
        config = extract_byok_config()

    litellm_model = format_litellm_model(config)

    # Prepare litellm completion kwargs
    kwargs: Dict[str, Any] = {
        "model": litellm_model,
        "messages": messages,
        "timeout": timeout,
    }

    if config.api_key:
        kwargs["api_key"] = config.api_key

    if config.api_base:
        kwargs["api_base"] = config.api_base

    if config.custom_headers:
        kwargs["extra_headers"] = config.custom_headers

    try:
        response = await litellm.acompletion(**kwargs)
        content = response.choices[0].message.content
        return content or ""
    except litellm.AuthenticationError as e:
        raise ValueError(f"Authentication failed for provider '{config.provider}'. Please check your API key.") from e
    except litellm.NotFoundError as e:
        raise ValueError(f"Model '{config.model}' not found on provider '{config.provider}'.") from e
    except Exception as e:
        raise RuntimeError(f"BYOK LLM completion error ({config.provider}/{config.model}): {str(e)}") from e
