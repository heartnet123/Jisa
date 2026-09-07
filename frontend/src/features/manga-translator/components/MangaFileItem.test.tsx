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

  it("renders statusMessage during inpainting and typesetting", () => {
    const inpaintingItem: ProcessedManga = {
      id: "j3",
      filename: "test3.png",
      originalUrl: "https://example.com/test3.png",
      status: "inpainting",
      progress: 75,
      message: "Cleaning text bubbles with LaMa...",
    };

    const { rerender } = render(
      <MangaFileItem
        item={inpaintingItem}
        onRemove={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getAllByText("Cleaning text bubbles with LaMa...")[0]).toBeInTheDocument();

    const typesettingItem: ProcessedManga = {
      id: "j4",
      filename: "test4.png",
      originalUrl: "https://example.com/test4.png",
      status: "typesetting",
      progress: 90,
      message: "Typesetting Thai text on clean background...",
    };

    rerender(
      <MangaFileItem
        item={typesettingItem}
        onRemove={vi.fn()}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getAllByText("Typesetting Thai text on clean background...")[0]).toBeInTheDocument();
  });
});
