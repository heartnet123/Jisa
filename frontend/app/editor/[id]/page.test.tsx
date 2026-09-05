import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StandaloneEditorPage from "./page";
import { getPageWindow } from "@/features/manga-translator/components/TranslationEditor";
import { MangaTranslatorContext } from "@/features/manga-translator/context/MangaTranslatorContext";
import type { MangaTranslatorContextType } from "@/features/manga-translator/context/MangaTranslatorContext";
import type { ProcessedManga, Project } from "@/features/manga-translator/types";
import { mangaApi } from "@/features/manga-translator/api/mangaApi";

const mockPush = vi.fn();
let mockParamsId = "item-1";
let mockFromParam = "/projects/p1";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: mockParamsId }),
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({
    get: (key: string) => (key === "from" ? mockFromParam : null),
  }),
}));

vi.mock("@/features/manga-translator/api/mangaApi", () => ({
  mangaApi: {
    checkStatus: vi.fn(),
    getTypesettingOptions: vi.fn().mockResolvedValue({ fonts: [], alignments: [] }),
    replaceRegions: vi.fn(),
    patchRegion: vi.fn(),
    approveTranslation: vi.fn(),
    generateTypesetPreview: vi.fn(),
    generateMaskPreview: vi.fn(),
  },
}));

vi.mock("@iconify-icon/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

vi.mock("@/features/manga-translator/components/RegionCanvas", () => ({
  RegionCanvas: () => <div data-testid="region-canvas" />,
}));

const createMockContext = (overrides?: Partial<MangaTranslatorContextType>): MangaTranslatorContextType => ({
  files: [],
  setFiles: vi.fn(),
  projects: [],
  setProjects: vi.fn(),
  activeProjectId: null,
  setActiveProjectId: vi.fn(),
  systemHealth: null,
  setSystemHealth: vi.fn(),
  healthLoading: false,
  setHealthLoading: vi.fn(),
  isUploading: false,
  setIsUploading: vi.fn(),
  isDragging: false,
  setIsDragging: vi.fn(),
  config: { provider: "ollama", model: "test", systemPrompt: "" },
  setConfig: vi.fn(),
  sseStatus: "connected",
  bootstrapError: null,
  activeUploadCount: 0,
  sandboxText: "",
  setSandboxText: vi.fn(),
  sandboxResult: "",
  setSandboxResult: vi.fn(),
  sandboxLoading: false,
  setSandboxLoading: vi.fn(),
  sandboxError: null,
  setSandboxError: vi.fn(),
  sandboxTime: null,
  setSandboxTime: vi.fn(),
  loadInitialData: vi.fn(),
  uploadBatch: vi.fn(),
  handleUpdate: vi.fn(),
  handleRemove: vi.fn(),
  handleMovePage: vi.fn(),
  handleMovePageTo: vi.fn(),
  handleRenameProject: vi.fn(),
  handleDeleteProject: vi.fn(),
  runSandboxTest: vi.fn(),
  activeHITLItem: null,
  setActiveHITLItem: vi.fn(),
  ...overrides,
});

describe("getPageWindow sliding window algorithm", () => {
  it("handles total 0 or negative", () => {
    expect(getPageWindow(1, 0)).toEqual([]);
    expect(getPageWindow(1, -5)).toEqual([]);
  });

  it("handles total less than 5", () => {
    expect(getPageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(getPageWindow(2, 3)).toEqual([1, 2, 3]);
    expect(getPageWindow(3, 3)).toEqual([1, 2, 3]);
  });

  it("handles total 10 at page 1", () => {
    expect(getPageWindow(1, 10)).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles total 10 at page 5 (sliding window)", () => {
    expect(getPageWindow(5, 10)).toEqual([3, 4, 5, 6, 7]);
  });

  it("handles total 10 at page 10 (end boundary)", () => {
    expect(getPageWindow(10, 10)).toEqual([6, 7, 8, 9, 10]);
  });
});

describe("StandaloneEditorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParamsId = "item-1";
    mockFromParam = "/projects/p1";
  });

  it("hydrates from context and renders minimal header without icon or page tag", () => {
    const mockProject: Project = {
      id: "p1",
      name: "One Piece - Chapter 1050",
      created_at: new Date().toISOString(),
      job_ids: ["item-1"],
      page_order: ["item-1"],
    };

    const mockItem: ProcessedManga = {
      id: "item-1",
      filename: "page01.png",
      originalUrl: "/uploads/page01.png",
      status: "awaiting_review",
      progress: 100,
      project_id: "p1",
      sequence_id: 0,
      blocks: [],
    };

    const contextValue = createMockContext({
      files: [mockItem],
      projects: [mockProject],
    });

    render(
      <MangaTranslatorContext.Provider value={contextValue}>
        <StandaloneEditorPage />
      </MangaTranslatorContext.Provider>
    );

    // Minimal header renders Project Title
    expect(screen.getByText("One Piece - Chapter 1050")).toBeInTheDocument();
    // Verify "Translation Studio" or "[page_01.png]" is NOT in header
    expect(screen.queryByText(/Translation Studio/i)).not.toBeInTheDocument();

    // Exit button navigates back to from param
    const exitBtn = screen.getByRole("button", { name: /exit/i });
    fireEvent.click(exitBtn);
    expect(mockPush).toHaveBeenCalledWith("/projects/p1");
  });

  it("fetches via mangaApi.checkStatus when item is not in context", async () => {
    const fetchedItem: ProcessedManga = {
      id: "item-1",
      filename: "page_remote.png",
      originalUrl: "/uploads/remote.png",
      status: "awaiting_review",
      progress: 100,
      blocks: [],
    };

    vi.mocked(mangaApi.checkStatus).mockResolvedValueOnce(fetchedItem);

    const contextValue = createMockContext({
      files: [],
      projects: [],
    });

    render(
      <MangaTranslatorContext.Provider value={contextValue}>
        <StandaloneEditorPage />
      </MangaTranslatorContext.Provider>
    );

    await waitFor(() => {
      expect(mangaApi.checkStatus).toHaveBeenCalledWith("item-1");
      expect(screen.getByText("Manga Project")).toBeInTheDocument();
    });
  });

  it("displays error state when item cannot be fetched", async () => {
    vi.mocked(mangaApi.checkStatus).mockRejectedValueOnce(new Error("Job not found"));

    const contextValue = createMockContext({
      files: [],
      projects: [],
    });

    render(
      <MangaTranslatorContext.Provider value={contextValue}>
        <StandaloneEditorPage />
      </MangaTranslatorContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByText("Job not found")).toBeInTheDocument();
    });

    const returnBtn = screen.getByRole("button", { name: /return to workspace/i });
    fireEvent.click(returnBtn);
    expect(mockPush).toHaveBeenCalledWith("/projects/p1");
  });

  it("renders bottom pagination toolbar and navigates pages on click", async () => {
    const mockProject: Project = {
      id: "p1",
      name: "Chapter 1",
      created_at: new Date().toISOString(),
      job_ids: ["item-1", "item-2", "item-3"],
      page_order: ["item-1", "item-2", "item-3"],
    };

    const mockPages: ProcessedManga[] = [
      { id: "item-1", filename: "p1.png", originalUrl: "/p1.png", status: "awaiting_review", progress: 100, project_id: "p1", sequence_id: 0 },
      { id: "item-2", filename: "p2.png", originalUrl: "/p2.png", status: "awaiting_review", progress: 100, project_id: "p1", sequence_id: 1 },
      { id: "item-3", filename: "p3.png", originalUrl: "/p3.png", status: "awaiting_review", progress: 100, project_id: "p1", sequence_id: 2 },
    ];

    const contextValue = createMockContext({
      files: mockPages,
      projects: [mockProject],
    });

    render(
      <MangaTranslatorContext.Provider value={contextValue}>
        <StandaloneEditorPage />
      </MangaTranslatorContext.Provider>
    );

    // Check pagination pills
    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3" })).toBeInTheDocument();

    // Click Next button -> navigates to item-2
    const nextBtn = screen.getByRole("button", { name: /next >/i });
    fireEvent.click(nextBtn);
    expect(mockPush).toHaveBeenCalledWith("/editor/item-2?from=%2Fprojects%2Fp1");

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledTimes(1);
    });

    // Select page 3 via dropdown -> navigates to item-3
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "2" } });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/editor/item-3?from=%2Fprojects%2Fp1");
    });
  });
});
