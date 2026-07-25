# LiteLLM Config Page Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the `/config` page into a unified control room for all 7 LiteLLM providers, BYOK API Key management, model dropdowns, live connection testing, and real-time translation sandbox testing.

**Architecture:** Update `MangaTranslatorContext` and `byok.ts` to manage BYOK configuration state (`provider`, `apiKey`, `model`, `apiBase`), update headers injected into translation requests, and overhaul `frontend/app/(workspace)/config/page.tsx` to render the 7 providers, password key input, provider-bound model dropdown, connection test button, system instructions, and translation sandbox.

**Tech Stack:** React 19 / Next.js 16, TypeScript, Tailwind CSS, Framer Motion, Iconify Solar Linear icons, FastAPI / LiteLLM backend.

## Global Constraints
- All 7 LiteLLM providers supported: `openai`, `anthropic`, `gemini`, `openrouter`, `deepseek`, `ollama`, `custom`.
- API keys stored in `localStorage` (`jisa_byok_config`) via `byok.ts`.
- Model input changed to `<select>` dropdown populated dynamically based on active provider.
- Quick Presets removed; API Base URL auto-mapped per provider defaults (`default_base`).

---

### Task 1: Extend BYOK State & Header Sync in `byok.ts` & `MangaTranslatorContext.tsx`

**Files:**
- Modify: `frontend/src/features/manga-translator/api/byok.ts`
- Modify: `frontend/src/features/manga-translator/context/MangaTranslatorContext.tsx`

**Interfaces:**
- Consumes: `BYOKConfig` interface from `types/byok.ts`
- Produces: `getBYOKConfig()`, `saveBYOKConfig()`, `getBYOKHeaders()`, `testBYOKConnection()`, synced context state in `MangaTranslatorContext`.

- [ ] **Step 1: Verify `byok.ts` export helper functions**

Check `byok.ts` to ensure `getBYOKConfig`, `saveBYOKConfig`, `getBYOKHeaders`, `testBYOKConnection`, and `fetchBYOKProviders` are exported cleanly.

- [ ] **Step 2: Update `MangaTranslatorContext` state initialization and sync**

Ensure `MangaTranslatorContext` reads saved BYOK config from `getBYOKConfig()` on initial load, syncing `config.provider`, `config.model`, and `apiKey` cleanly.

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc --noEmit` in `frontend` directory.
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit Task 1**

Commit changes for state & helper sync.

---

### Task 2: Redesign `frontend/app/(workspace)/config/page.tsx`

**Files:**
- Modify: `frontend/app/(workspace)/config/page.tsx`

**Interfaces:**
- Consumes: `useMangaTranslator()`, `fetchBYOKProviders()`, `saveBYOKConfig()`, `getBYOKConfig()`, `testBYOKConnection()`, `DEFAULT_PROVIDERS`
- Produces: Redesigned `/config` page layout with Provider Select, API Key password toggle, Model Identifier dropdown, Test Connection button, System Prompt textarea, and Context Translation Sandbox.

- [ ] **Step 1: Implement Provider Dropdown & Dynamic Model Selection**

In `page.tsx`:
- Render AI Provider `<select>` with 7 options (`openai`, `anthropic`, `gemini`, `openrouter`, `deepseek`, `ollama`, `custom`).
- Render API Key `<input type={showKey ? 'text' : 'password'}>` with eye icon toggle button and `* Required` badge when provider `requires_key` is true.
- Render Model Identifier `<select>` populated dynamically from `activeProvider.models` (or `systemHealth.ollama.models` when provider is `ollama`).

- [ ] **Step 2: Implement Test Connection & Save Controls**

Add `handleTestConnection` and `handleSaveConfig` handlers:
- `handleTestConnection`: Sets testing state, calls `testBYOKConnection(byokConfig)`, renders result banner (emerald for success, rose for error with latency and reply).
- `handleSaveConfig`: Calls `saveBYOKConfig(byokConfig)` and updates `MangaTranslatorContext`.

- [ ] **Step 3: Connect System Instructions & Translation Sandbox**

Ensure system prompt textarea updates `config.systemPrompt` and Sandbox "Run Translation Test" button invokes `runSandboxTest()` using active LiteLLM headers.

- [ ] **Step 4: Verify layout responsiveness and styles**

Check styling using dark monochrome theme (`#0b0b0b`, `#121212`, `#1c1c1c`, `#222`), cyan accents (`text-cyan-400`, `bg-cyan-500`), and Iconify icons.

- [ ] **Step 5: Verify build & TypeScript compilation**

Run: `npx tsc --noEmit` in `frontend` directory.
Expected: PASS with 0 errors.

- [ ] **Step 6: Commit Task 2**

Commit redesigned `/config` page.

---

### Task 3: Verification & Integration Test

- [ ] **Step 1: Run frontend build check**

Run: `npm run build` in `frontend` directory (or `npx next build`).
Expected: Successful build without errors.

- [ ] **Step 2: Run backend tests**

Run: `pytest backend/tests/`
Expected: PASS.
