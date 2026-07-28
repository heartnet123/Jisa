import React, { useContext } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MangaTranslatorContext, MangaTranslatorProvider } from "./MangaTranslatorContext";
import type { ProcessedManga, SystemHealth } from "../types";

const apiMocks = vi.hoisted(() => ({
  listJobs: vi.fn(),
  listProjects: vi.fn(),
  getSystemHealth: vi.fn(),
  uploadBatch: vi.fn(),
  deleteJob: vi.fn(),
}));

vi.mock("../api/mangaApi", () => ({
  API_BASE_URL: "http://localhost:8000",
  mangaApi: apiMocks,
}));

class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  readyState = MockEventSource.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, EventListenerOrEventListenerObject>();

  addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    this.listeners.set(type, listener);
  });

  close = vi.fn();
}

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function createFile(name: string) {
  return new File(["content"], name, { type: "image/png" });
}

function createJob(overrides: Partial<ProcessedManga>): ProcessedManga {
  return {
    id: overrides.id ?? "job-id",
    filename: overrides.filename ?? "page.png",
    originalUrl: overrides.originalUrl ?? "/uploads/page.png",
    status: overrides.status ?? "queued",
    progress: overrides.progress ?? 5,
    ...overrides,
  } as ProcessedManga;
}

function TestHarness({ filesToUpload }: { filesToUpload: File[] }) {
  const ctx = useContext(MangaTranslatorContext);
  if (!ctx) {
    throw new Error("MangaTranslatorContext missing");
  }

  return (
    <div>
      <button type="button" onClick={() => void ctx.uploadBatch(filesToUpload, "project-1")}>upload</button>
      <div data-testid="files">{ctx.files.map((file) => file.filename).join("|")}</div>
      <div data-testid="ids">{ctx.files.map((file) => file.id).join("|")}</div>
      {ctx.files.map((file) => (
        <button key={file.id} type="button" onClick={() => void ctx.handleRemove(file.id)}>
          remove {file.filename}
        </button>
      ))}
    </div>
  );
}

describe("MangaTranslatorProvider upload reconciliation", () => {
  const systemHealth: SystemHealth = {
    ollama: {
      status: "ok",
      models: [],
      ocr_model: "ocr",
    },
    translation: {
      byok_configured: false,
      model: "gpt-4o-mini",
      page_context_translation: false,
    },
    hardware: {
      cuda_available: false,
      device: "cpu",
      device_name: "cpu",
      torch_version: "2.0.0",
    },
    assets: {
      fonts: [],
    },
    stats: {
      total: 0,
      active: 0,
      awaiting_review: 0,
      completed: 0,
      failed: 0,
    },
  };

  beforeAll(() => {
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("confirm", vi.fn(() => true));
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(() => "blob:mock"),
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(URL, "createObjectURL", {
      value: originalCreateObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: originalRevokeObjectURL,
      configurable: true,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    apiMocks.listJobs.mockResolvedValue([]);
    apiMocks.listProjects.mockResolvedValue([]);
    apiMocks.getSystemHealth.mockResolvedValue(systemHealth);
  });

  it("keeps surrounding files stable instead of appending upload results after them", async () => {
    apiMocks.listJobs.mockResolvedValue([
      createJob({
        id: "keep-start",
        filename: "keep-start.png",
        originalUrl: "/uploads/keep-start.png",
        status: "completed",
        progress: 100,
        project_id: "project-1",
        sequence_id: 100,
      }),
      createJob({
        id: "keep-end",
        filename: "keep-end.png",
        originalUrl: "/uploads/keep-end.png",
        status: "completed",
        progress: 100,
        project_id: "project-1",
        sequence_id: 101,
      }),
    ]);

    apiMocks.uploadBatch.mockResolvedValue({
      id: "batch-1",
      status: "queued",
      jobs: [
        createJob({
          id: "job-page-1",
          filename: "page-1.png",
          originalUrl: "/uploads/page-1.png",
          status: "queued",
          progress: 5,
          project_id: "project-1",
          sequence_id: 0,
        }),
        createJob({
          id: "job-page-2",
          filename: "page-2.png",
          originalUrl: "/uploads/page-2.png",
          status: "queued",
          progress: 5,
          project_id: "project-1",
          sequence_id: 1,
        }),
      ],
    });

    render(
      <MangaTranslatorProvider>
        <TestHarness filesToUpload={[createFile("page-1.png"), createFile("page-2.png")]} />
      </MangaTranslatorProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("files").textContent).toBe("keep-start.png|keep-end.png"));

    fireEvent.click(screen.getByRole("button", { name: "upload" }));

    await waitFor(() =>
      expect(screen.getByTestId("files").textContent).toBe(
        "page-1.png|page-2.png|keep-start.png|keep-end.png",
      ),
    );
  });

  it("prefers filename matches over sequence_id when the server returns jobs in reverse order", async () => {
    apiMocks.uploadBatch.mockResolvedValue({
      id: "batch-2",
      status: "queued",
      jobs: [
        createJob({
          id: "job-page-2",
          filename: "page-2.png",
          originalUrl: "/uploads/page-2.png",
          status: "queued",
          progress: 5,
          project_id: "project-1",
          sequence_id: 0,
        }),
        createJob({
          id: "job-page-1",
          filename: "page-1.png",
          originalUrl: "/uploads/page-1.png",
          status: "queued",
          progress: 5,
          project_id: "project-1",
          sequence_id: 1,
        }),
      ],
    });

    render(
      <MangaTranslatorProvider>
        <TestHarness filesToUpload={[createFile("page-1.png"), createFile("page-2.png")]} />
      </MangaTranslatorProvider>,
    );

    await waitFor(() => expect(apiMocks.listJobs).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "upload" }));

    await waitFor(() => expect(screen.getByTestId("files").textContent).toBe("page-1.png|page-2.png"));
  });

  it("replaces placeholders in place and drops stale duplicates with matching ids", async () => {
    apiMocks.listJobs.mockResolvedValue([
      createJob({
        id: "pending-other",
        filename: "other-batch.png",
        originalUrl: "blob:other-batch",
        status: "uploading",
        progress: 1,
        project_id: "project-1",
        sequence_id: 99,
        message: "Uploading manga page...",
      }),
      createJob({
        id: "job-page-1",
        filename: "stale-page-1.png",
        originalUrl: "/uploads/stale-page-1.png",
        status: "completed",
        progress: 100,
        project_id: "project-1",
        sequence_id: 100,
      }),
      createJob({
        id: "keep-middle",
        filename: "keep-middle.png",
        originalUrl: "/uploads/keep-middle.png",
        status: "completed",
        progress: 100,
        project_id: "project-1",
        sequence_id: 101,
      }),
    ]);

    apiMocks.uploadBatch.mockResolvedValue({
      id: "batch-3",
      status: "queued",
      jobs: [
        createJob({
          id: "job-page-2",
          filename: "page-2.png",
          originalUrl: "/uploads/page-2.png",
          status: "queued",
          progress: 5,
          project_id: "project-1",
          sequence_id: 0,
        }),
        createJob({
          id: "job-page-1",
          filename: "page-1.png",
          originalUrl: "/uploads/page-1.png",
          status: "queued",
          progress: 5,
          project_id: "project-1",
          sequence_id: 1,
        }),
        createJob({
          id: "job-extra",
          filename: "extra.png",
          originalUrl: "/uploads/extra.png",
          status: "queued",
          progress: 5,
          project_id: "project-1",
          sequence_id: 2,
        }),
      ],
    });

    render(
      <MangaTranslatorProvider>
        <TestHarness filesToUpload={[createFile("page-1.png"), createFile("page-2.png")]} />
      </MangaTranslatorProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("files").textContent).toBe("other-batch.png|stale-page-1.png|keep-middle.png"),
    );

    fireEvent.click(screen.getByRole("button", { name: "upload" }));

    await waitFor(() =>
      expect(screen.getByTestId("files").textContent).toBe(
        "page-1.png|page-2.png|other-batch.png|keep-middle.png|extra.png",
      ),
    );

    expect(screen.getByTestId("ids").textContent).toBe("job-page-1|job-page-2|pending-other|keep-middle|job-extra");
  });

  it("appends a matched replacement if the placeholder is removed before the response resolves", async () => {
    let resolveUpload!: (value: { id: string; status: string; jobs: ProcessedManga[] }) => void;
    const uploadPromise = new Promise<{ id: string; status: string; jobs: ProcessedManga[] }>((resolve) => {
      resolveUpload = resolve;
    });

    apiMocks.uploadBatch.mockReturnValue(uploadPromise);
    apiMocks.deleteJob.mockResolvedValue({ status: "ok" });

    render(
      <MangaTranslatorProvider>
        <TestHarness filesToUpload={[createFile("page-1.png")]} />
      </MangaTranslatorProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("files").textContent).toBe(""));

    fireEvent.click(screen.getByRole("button", { name: "upload" }));

    await waitFor(() => expect(screen.getByTestId("files").textContent).toBe("page-1.png"));

    fireEvent.click(screen.getByRole("button", { name: "remove page-1.png" }));

    await waitFor(() => expect(screen.getByTestId("files").textContent).toBe(""));

    resolveUpload({
      id: "batch-deferred",
      status: "queued",
      jobs: [
        createJob({
          id: "job-page-1",
          filename: "page-1.png",
          originalUrl: "/uploads/page-1.png",
          status: "queued",
          progress: 5,
          project_id: "project-1",
          sequence_id: 0,
        }),
      ],
    });

    await waitFor(() => expect(screen.getByTestId("files").textContent).toBe("page-1.png"));
    expect(screen.getByTestId("ids").textContent).toBe("job-page-1");
  });
});
