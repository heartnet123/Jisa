# Design Specification: LiteLLM Configuration Page Integration

**Date**: 2026-07-23  
**Status**: Approved  
**Topic**: Aligning Frontend `/config` Page with LiteLLM Backend Capabilities  

---

## 1. Overview
The goal of this update is to align the JISA frontend `/config` page (`app/(workspace)/config/page.tsx`) with the LiteLLM backend router (`backend/byok.py`). Currently, the `/config` page only exposes 3 hardcoded providers (`openai`, `ollama`, `anthropic`), lacks API Key management, and lacks LiteLLM connection testing. 

This update turns the `/config` page into a unified control room for AI translation model routing, BYOK credentials, system instructions, and real-time translation testing.

---

## 2. Architecture & Data Flow

```
+-----------------------------------------------------------------------------------+
|                            Frontend (/config Page)                                |
|                                                                                   |
|  [Provider Select]  ---> Updates Provider & Model Dropdown Options               |
|  [API Key Input]    ---> Saves to localStorage ('jisa_byok_config')              |
|  [Model Dropdown]   ---> Selects Model ID (e.g. gpt-4o-mini, gemini-1.5-flash)    |
|  [System Prompt]    ---> Saves Translator System Instructions                     |
|                                                                                   |
|  [Test Connection]  ---> Calls POST /api/byok/test                                |
|  [Run Sandbox]      ---> Calls POST /api/translate with X-BYOK-* Headers          |
+-----------------------------------------------------------------------------------+
                                        |
                                        v
+-----------------------------------------------------------------------------------+
|                             Backend (LiteLLM Router)                              |
|                                                                                   |
|  extract_byok_config() <--- Reads X-BYOK-Provider, X-BYOK-Key, X-BYOK-Model       |
|  format_litellm_model() ---> Formats routing string (e.g. "openai/gpt-4o-mini")   |
|  litellm.acompletion()  ---> Routes completion call to Target AI Provider         |
+-----------------------------------------------------------------------------------+
```

---

## 3. Detailed Component Specifications

### 3.1 Card 1: LiteLLM Provider & Credentials (`/config` Left Column)
1. **AI Provider Select**:
   - Supports 7 preset providers from `PRESET_PROVIDERS`:
     - OpenAI (`openai`)
     - Anthropic (`anthropic`)
     - Google Gemini (`gemini`)
     - OpenRouter (`openrouter`)
     - DeepSeek (`deepseek`)
     - Ollama (Local) (`ollama`)
     - Custom OpenAI-Compatible (`custom`)
   - Changing provider automatically resets the selected model to the provider's default model and updates API Key requirement status (`requires_key`).

2. **API Key Input**:
   - Text input with password hide/show eye-toggle button.
   - Stored safely in browser `localStorage` under key `jisa_byok_config` via `byok.ts`.
   - Sent to backend as header `X-BYOK-Key`.
   - Visual indicator showing `* Required` for API key-based providers or `Optional` for Ollama/Custom.

3. **Model Identifier Dropdown**:
   - `<select>` dropdown populated dynamically based on the active provider's preset models:
     - OpenAI: `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo`, `o3-mini`
     - Anthropic: `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, `claude-3-opus-20240229`
     - Gemini: `gemini-1.5-flash`, `gemini-1.5-pro`, `gemini-2.0-flash-exp`
     - OpenRouter: `anthropic/claude-3.5-sonnet`, `google/gemini-flash-1.5`, `deepseek/deepseek-r1`, `meta-llama/llama-3.3-70b-instruct`
     - DeepSeek: `deepseek-chat`, `deepseek-reasoner`
     - Ollama: Populated dynamically from local Ollama health check (`systemHealth.ollama.models`), falling back to default presets (`llama3.2`, `mistral`, `qwen2.5-coder`).
     - Custom: `default` or user-defined text input fallback.

4. **API Base URL**:
   - Automatically mapped under the hood to the provider's default base URL (`default_base`).
   - Removes visual clutter while ensuring correct backend routing.

5. **Test Connection & Save Controls**:
   - **Test Connection Button**: Calls `testBYOKConnection(config)` in `byok.ts` which posts to backend test endpoint. Displays real-time status banner (success/error message + provider reply).
   - **Save Config Button**: Persists configuration to `localStorage` and updates global `MangaTranslatorContext`.

---

### 3.2 Card 2: Linguistic Profile & Font (`/config` Left Column)
1. **Primary Typesetting Font**:
   - Preserves font selection buttons (`Itim Regular` active, `IanNNNN Cow` placeholder).
2. **System Instructions (Translator Prompt)**:
   - Textarea for editing system prompt (`systemPrompt`).
   - Synced with `MangaTranslatorContext` state.

---

### 3.3 Card 3: Context Translation Sandbox (`/config` Right Column)
1. **Japanese Dialogue Input**:
   - Japanese test dialogue textarea (`sandboxText`).
2. **Run Translation Test Button**:
   - Executes `runSandboxTest` which translates dialogue using current LiteLLM provider, API key, model, and system prompt.
3. **Thai Output Draft & Speed Badge**:
   - Displays translated Thai output using `ThaiText` component.
   - Shows latency in milliseconds (`SPEED: XXXms`).

---

## 4. Error Handling & Edge Cases
- **Missing API Key**: If provider requires key and key is empty, show validation prompt before running test/sandbox.
- **Offline / Local Ollama Down**: Fall back gracefully to preset models list if health check fails.
- **LiteLLM Connection Error**: Display formatted error message in status banner (e.g. invalid API key, model not found).

---

## 5. Verification & Testing Strategy
1. **Unit Testing**:
   - Verify `byok.ts` correctly saves and loads config from `localStorage`.
   - Verify `X-BYOK-*` headers are attached to API requests.
2. **Manual Verification**:
   - Select each of the 7 providers in `/config` and verify model options update dynamically.
   - Test "Test Connection" button with valid and invalid API key.
   - Execute sandbox translation and verify Thai response rendering.
