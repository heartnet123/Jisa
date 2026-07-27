import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import ProjectWorkspace from "./ProjectWorkspace";
import { MangaTranslatorContext } from "../context/MangaTranslatorContext";
import type { ProcessedManga, Project } from "../types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

describe("ProjectWorkspace", () => {
  it("renders manga cards sorted by sequence_id", () => {
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
        status: "queued",
        progress: 0,
        project_id: "p1",
        sequence_id: 1,
      },
    ];

    const contextValue: any = {
      files: mockFiles,
      projects: [mockProject],
      config: { provider: "ollama", model: "test", systemPrompt: "" },
      byokConfig: null,
      setByokConfig: vi.fn(),
      handleDeleteProject: vi.fn(),
      handleMovePageTo: vi.fn(),
      setFiles: vi.fn(),
    };

    render(
      <MangaTranslatorContext.Provider value={contextValue}>
        <ProjectWorkspace projectId="p1" />
      </MangaTranslatorContext.Provider>
    );

    const pageBadges = screen.getAllByText(/#\d+/);
    expect(pageBadges[0].textContent).toBe("#1");
    expect(pageBadges[1].textContent).toBe("#2");

    expect(screen.getAllByText("page01.png")[0]).toBeInTheDocument();
    expect(screen.getAllByText("page02.png")[0]).toBeInTheDocument();
  });

  it("filters sheets by status when status filter tabs are clicked", () => {
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

    const contextValue: any = {
      files: mockFiles,
      projects: [mockProject],
      config: { provider: "ollama", model: "test", systemPrompt: "" },
      byokConfig: null,
      setByokConfig: vi.fn(),
      handleDeleteProject: vi.fn(),
      handleMovePageTo: vi.fn(),
      setFiles: vi.fn(),
    };

    render(
      <MangaTranslatorContext.Provider value={contextValue}>
        <ProjectWorkspace projectId="p1" />
      </MangaTranslatorContext.Provider>
    );

    // Initial state (All filter active) shows all 3 files
    expect(screen.getAllByText("completed_page.png")[0]).toBeInTheDocument();
    expect(screen.getAllByText("review_page.png")[0]).toBeInTheDocument();
    expect(screen.getAllByText("failed_page.png")[0]).toBeInTheDocument();

    // Click 'Awaiting Review' filter tab
    const awaitingReviewBtn = screen.getByRole("button", { name: /Awaiting Review/i });
    fireEvent.click(awaitingReviewBtn);

    expect(screen.getByText("review_page.png")).toBeInTheDocument();
    expect(screen.queryByText("completed_page.png")).not.toBeInTheDocument();
    expect(screen.queryByText("failed_page.png")).not.toBeInTheDocument();

    // Click 'Completed' filter tab
    const completedBtn = screen.getByRole("button", { name: /Completed/i });
    fireEvent.click(completedBtn);

    expect(screen.getByText("completed_page.png")).toBeInTheDocument();
    expect(screen.queryByText("review_page.png")).not.toBeInTheDocument();
    expect(screen.queryByText("failed_page.png")).not.toBeInTheDocument();
  });
});

