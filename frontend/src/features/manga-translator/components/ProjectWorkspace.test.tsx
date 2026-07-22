import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
