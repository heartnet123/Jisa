import sys
import unittest
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from byok import (
    BYOKConfig,
    extract_byok_config,
    format_litellm_model,
    PRESET_PROVIDERS,
)

class TestBYOK(unittest.TestCase):
    def test_extract_byok_config_from_headers(self):
        headers = {
            "x-byok-provider": "anthropic",
            "x-byok-key": "sk-ant-test-key",
            "x-byok-model": "claude-3-5-sonnet-20241022",
            "x-byok-api-base": "https://api.anthropic.com",
        }
        config = extract_byok_config(headers=headers)
        self.assertEqual(config.provider, "anthropic")
        self.assertEqual(config.api_key, "sk-ant-test-key")
        self.assertEqual(config.model, "claude-3-5-sonnet-20241022")
        self.assertEqual(config.api_base, "https://api.anthropic.com")

    def test_extract_byok_config_env_fallback(self):
        os_env = {
            "BYOK_PROVIDER": "gemini",
            "BYOK_API_KEY": "AIzaSyTestKey",
            "BYOK_MODEL": "gemini-1.5-flash",
            "BYOK_API_BASE": "https://generativelanguage.googleapis.com",
        }
        import os
        for k, v in os_env.items():
            os.environ[k] = v

        config = extract_byok_config(headers={})
        self.assertEqual(config.provider, "gemini")
        self.assertEqual(config.api_key, "AIzaSyTestKey")
        self.assertEqual(config.model, "gemini-1.5-flash")
        self.assertEqual(config.api_base, "https://generativelanguage.googleapis.com")

    def test_format_litellm_model(self):
        cfg_openai = BYOKConfig(provider="openai", model="gpt-4o")
        self.assertEqual(format_litellm_model(cfg_openai), "openai/gpt-4o")

        cfg_anthropic = BYOKConfig(provider="anthropic", model="claude-3-5-sonnet-20241022")
        self.assertEqual(format_litellm_model(cfg_anthropic), "anthropic/claude-3-5-sonnet-20241022")

        cfg_ollama = BYOKConfig(provider="ollama", model="llama3.2")
        self.assertEqual(format_litellm_model(cfg_ollama), "ollama/llama3.2")

        cfg_explicit = BYOKConfig(provider="custom", model="openrouter/meta-llama/llama-3-70b")
        self.assertEqual(format_litellm_model(cfg_explicit), "openrouter/meta-llama/llama-3-70b")

    def test_preset_providers_list(self):
        self.assertGreaterEqual(len(PRESET_PROVIDERS), 5)
        provider_ids = [p["id"] for p in PRESET_PROVIDERS]
        self.assertIn("openai", provider_ids)
        self.assertIn("anthropic", provider_ids)
        self.assertIn("gemini", provider_ids)
        self.assertIn("ollama", provider_ids)
        self.assertIn("openrouter", provider_ids)

    def test_env_configuration_overrides(self):
        import importlib
        import os
        from unittest.mock import patch
        import byok

        with patch.dict(os.environ, {
            "OLLAMA_URL": "http://remote-ollama:11434",
            "CUSTOM_PROVIDER_BASE": "http://custom-ai:9000/v1",
            "BYOK_DEFAULT_MODEL": "claude-3-5-sonnet",
        }, clear=False):
            importlib.reload(byok)
            self.assertEqual(byok.DEFAULT_FALLBACK_MODEL, "claude-3-5-sonnet")
            prov_map = {p["id"]: p["default_base"] for p in byok.PRESET_PROVIDERS}
            self.assertEqual(prov_map["ollama"], "http://remote-ollama:11434")
            self.assertEqual(prov_map["custom"], "http://custom-ai:9000/v1")

        importlib.reload(byok)

    def test_env_configuration_empty_or_unset_fallback(self):
        import importlib
        import os
        from unittest.mock import patch
        import byok

        with patch.dict(os.environ, {
            "OLLAMA_URL": "",
            "CUSTOM_PROVIDER_BASE": "  ",
            "BYOK_DEFAULT_MODEL": "",
        }, clear=False):
            importlib.reload(byok)
            self.assertEqual(byok.DEFAULT_FALLBACK_MODEL, "gpt-5.4-mini")
            prov_map = {p["id"]: p["default_base"] for p in byok.PRESET_PROVIDERS}
            self.assertEqual(prov_map["ollama"], "http://localhost:11434")
            self.assertEqual(prov_map["custom"], "http://localhost:8000/v1")

        importlib.reload(byok)


if __name__ == "__main__":
    unittest.main()
