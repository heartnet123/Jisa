import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MangaFileItem } from "./MangaFileItem";
import type { ProcessedManga } from "../types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/projects/p1",
}));

describe("MangaFileItem", () => {
  it("falls back to originalUrl when result_url and inpainted_url are missing on completed item", () => {
    const mockItem: ProcessedManga = {
      id: "j1",
      filename: "test.png",
      originalUrl: "https://example.com/original.png",
      status: "completed",
      progress: 100,
    };

    render(
      <MangaFileItem
        item={mockItem}
        onRemove={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://example.com/original.png");
  });

  it("renders backend status message during active translating status", () => {
    const mockItem: ProcessedManga = {
      id: "j2",
      filename: "test2.png",
      originalUrl: "https://example.com/test2.png",
      status: "translating",
      progress: 60,
      message: "Translating bubble 3 of 5 with LiteLLM...",
    };

    render(
      <MangaFileItem
        item={mockItem}
        onRemove={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByText("Translating bubble 3 of 5 with LiteLLM...")).toBeInTheDocument();
  });
});
