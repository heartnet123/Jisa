import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import ProjectWorkspace from "./ProjectWorkspace";
import { MangaTranslatorContext } from "../context/MangaTranslatorContext";
import type { MangaTranslatorContextType } from "../context/MangaTranslatorContext";
import type { ProcessedManga, Project } from "../types";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => "/projects/p1",
}));

const createMockContextValue = (overrides?: Partial<MangaTranslatorContextType>): MangaTranslatorContextType => ({
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

describe("ProjectWorkspace", () => {
  it("renders manga cards sorted by sequence_id and verifies DOM filename ordering", () => {
    const mockProject: Project = {
      id: "p1",
      name: "Chapter 1",
      created_at: new Date().toISOString(),
      job_ids: ["j2", "j1"],
      page_order: ["j2", "j1"],
    };

    const mockFiles: ProcessedManga[] = [
      {
        id: "j1",
        filename: "page01.png",
        originalUrl: "/uploads/page01.png",
        status: "completed",
        progress: 100,
        project_id: "p1",
        sequence_id: 0,
      },
      {
        id: "j2",
        filename: "page02.png",
        originalUrl: "/uploads/page02.png",
        status: "completed",
        progress: 100,
        project_id: "p1",
        sequence_id: 1,
      },
    ];

    const contextValue = createMockContextValue({
      files: mockFiles,
      projects: [mockProject],
    });

    render(
      <MangaTranslatorContext.Provider value={contextValue}>
        <ProjectWorkspace projectId="p1" />
      </MangaTranslatorContext.Provider>
    );

    const pageBadges = screen.getAllByText(/#\d+/);
    expect(pageBadges[0].textContent).toBe("#1");
    expect(pageBadges[1].textContent).toBe("#2");

    const filenames = screen.getAllByText(/page\d+\.png/).map((el) => el.textContent);
    expect(filenames).toEqual(["page01.png", "page02.png"]);
  });

  it("filters sheets by status and updates aria-pressed state when status filter tabs are clicked", () => {
    const mockProject: Project = {
      id: "p1",
      name: "Chapter 1",
      created_at: new Date().toISOString(),
      job_ids: ["j1", "j2", "j3"],
      page_order: ["j1", "j2", "j3"],
    };

    const mockFiles: ProcessedManga[] = [
      {
        id: "j1",
        filename: "completed_page.png",
        originalUrl: "/uploads/page01.png",
        status: "completed",
        progress: 100,
        project_id: "p1",
        sequence_id: 0,
      },
      {
        id: "j2",
        filename: "review_page.png",
        originalUrl: "/uploads/page02.png",
        status: "awaiting_review",
        progress: 100,
        project_id: "p1",
        sequence_id: 1,
      },
      {
        id: "j3",
        filename: "failed_page.png",
        originalUrl: "/uploads/page03.png",
        status: "failed",
        progress: 50,
        project_id: "p1",
        sequence_id: 2,
      },
    ];

    const contextValue = createMockContextValue({
      files: mockFiles,
      projects: [mockProject],
    });

    render(
      <MangaTranslatorContext.Provider value={contextValue}>
        <ProjectWorkspace projectId="p1" />
      </MangaTranslatorContext.Provider>
    );

    // Initial state (All filter active) shows all 3 files
    expect(screen.getAllByText("completed_page.png")[0]).toBeInTheDocument();
    expect(screen.getAllByText("review_page.png")[0]).toBeInTheDocument();
    expect(screen.getAllByText("failed_page.png")[0]).toBeInTheDocument();

    // Click 'Processed' filter button and assert aria-pressed
    const processedBtn = screen.getByTitle(/Filter catalogue by Processed sheets/i);
    expect(processedBtn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(processedBtn);
    expect(processedBtn.getAttribute("aria-pressed")).toBe("true");

    expect(screen.getByText("completed_page.png")).toBeInTheDocument();
    expect(screen.queryByText("review_page.png")).not.toBeInTheDocument();
    expect(screen.queryByText("failed_page.png")).not.toBeInTheDocument();
  });

  it("routes to standalone editor on REVIEW click and does not render nested editor", () => {
    const mockProject: Project = {
      id: "p1",
      name: "Chapter 1",
      created_at: new Date().toISOString(),
      job_ids: ["j1"],
      page_order: ["j1"],
    };

    const mockFiles: ProcessedManga[] = [
      {
        id: "j1",
        filename: "review_page.png",
        originalUrl: "/uploads/page01.png",
        status: "awaiting_review",
        progress: 100,
        project_id: "p1",
        sequence_id: 0,
      },
    ];

    const contextValue = createMockContextValue({
      files: mockFiles,
      projects: [mockProject],
    });

    render(
      <MangaTranslatorContext.Provider value={contextValue}>
        <ProjectWorkspace projectId="p1" />
      </MangaTranslatorContext.Provider>
    );

    const reviewBtn = screen.getByRole("button", { name: /^review$/i });
    expect(reviewBtn).toBeInTheDocument();
    fireEvent.click(reviewBtn);

    expect(mockPush).toHaveBeenCalledWith("/editor/j1?from=%2Fprojects%2Fp1");

    const studioBtn = screen.getByRole("button", { name: /enter translation studio/i });
    expect(studioBtn).toBeInTheDocument();
    fireEvent.click(studioBtn);
    expect(mockPush).toHaveBeenCalledWith("/editor/j1?from=%2Fprojects%2Fp1");

    expect(screen.queryByText(/Region inspector/i)).not.toBeInTheDocument();
  });
});

