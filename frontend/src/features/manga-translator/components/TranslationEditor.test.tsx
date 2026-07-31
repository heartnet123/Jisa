import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mangaApi } from "../api/mangaApi";
import type { BlockItem, ProcessedManga } from "../types";
import { TranslationEditor } from "./TranslationEditor";

vi.mock("../api/mangaApi", () => ({
  mangaApi: {
    replaceRegions: vi.fn(),
    patchRegion: vi.fn(),
    rerunRegionOcr: vi.fn(),
    generateMaskPreview: vi.fn(),
    approveTranslation: vi.fn(),
    getTypesettingOptions: vi.fn(),
    generateTypesetPreview: vi.fn(),
  },
}));

vi.mock("@iconify-icon/react", () => ({
  Icon: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    article: ({
      children,
      layout,
      ...props
    }: HTMLAttributes<HTMLElement> & { layout?: boolean }) => (
      <article data-layout={layout ? "true" : undefined} {...props}>
        {children}
      </article>
    ),
  },
}));

vi.mock("./RegionCanvas", () => ({
  RegionCanvas: ({
    maskPreviewState,
    maskPreviewUrl,
    showMaskPreview,
    onToggleMaskPreview,
  }: {
    maskPreviewState: string;
    maskPreviewUrl?: string;
    showMaskPreview: boolean;
    onToggleMaskPreview?: () => void;
  }) => (
    <div>
      <button type="button" onClick={onToggleMaskPreview}>
        Canvas mask preview
      </button>
      <span data-testid="mask-state">{maskPreviewState}</span>
      <span data-testid="mask-url">{maskPreviewUrl ?? ""}</span>
      <span data-testid="mask-visible">{String(showMaskPreview)}</span>
    </div>
  ),
}));

const block: BlockItem = {
  id: "region-1",
  box: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
  source: "detected",
  text: "original source",
  translated_text: "original translation",
};

const item: ProcessedManga = {
  id: "job-1",
  filename: "page.png",
  originalUrl: "/page.png",
  status: "awaiting_review",
  progress: 55,
  blocks: [block],
  region_mode: "detected",
};

const api = vi.mocked(mangaApi);

function renderEditor() {
  const onClose = vi.fn();
  const onUpdate = vi.fn();
  render(
    <TranslationEditor
      item={{ ...item, blocks: item.blocks?.map(region => ({ ...region })) }}
      onClose={onClose}
      onUpdate={onUpdate}
    />,
  );
  return { onClose, onUpdate };
}

async function selectRegion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText("Region 1"));
}

describe("TranslationEditor", () => {
  beforeEach(() => {
    api.getTypesettingOptions.mockResolvedValue({
      fonts: [{ name: "Itim-Regular.ttf", label: "Itim (Regular)" }],
      default_font_name: "Itim-Regular.ttf",
      font_size: { min: 8, max: 72 },
      padding_ratio: { min: 0.0, max: 0.30, step: 0.01, default: 0.10 },
      alignments: ["left", "center", "right"],
    });
    api.generateTypesetPreview.mockImplementation(async (_jobId, _regionId, req) => ({
      client_revision: req.client_revision,
      mime_type: "image/png",
      overlay_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      bounds_px: { x: 100, y: 320, width: 300, height: 160 },
      lines: ["Line 1"],
      resolved_font_size: 20,
      auto_shrunk: false,
      overflow: false,
      truncated: false,
    }));
    api.replaceRegions.mockImplementation(async (_jobId, regions) => ({
      region_mode: "manual_override",
      regions,
    }));
    api.patchRegion.mockImplementation(async (_jobId, _regionId, updates) => {
      const sourceChanged = Object.hasOwn(updates, "text");
      const translationChanged = Object.hasOwn(updates, "translated_text");
      return {
        ...block,
        text: sourceChanged ? (updates.text ?? undefined) : block.text,
        translated_text: translationChanged
          ? (updates.translated_text ?? undefined)
          : sourceChanged
            ? undefined
            : block.translated_text,
      };
    });
    api.rerunRegionOcr.mockResolvedValue({
      ...block,
      text: "OCR refreshed source",
      translated_text: undefined,
    });
    api.generateMaskPreview.mockResolvedValue({
      url: "http://localhost:8000/uploads/mask.png?v=2",
      revision: 2,
    });
    api.approveTranslation.mockResolvedValue({ status: "inpainting" });
  });

  it("saves an edited source through the selected-region patch", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEditor();
    await selectRegion(user);

    const source = screen.getByLabelText("Source text");
    fireEvent.change(source, { target: { value: "corrected source" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.patchRegion).toHaveBeenCalledWith("job-1", "region-1", {
        text: "corrected source",
      }),
    );
    expect(onUpdate).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        blocks: [expect.objectContaining({ text: "corrected source" })],
      }),
    );
  });

  it("reruns OCR only for the selected region and clears stale translation", async () => {
    const user = userEvent.setup();
    renderEditor();
    await selectRegion(user);

    await user.click(screen.getByRole("button", { name: "Re-OCR" }));

    await waitFor(() =>
      expect(api.rerunRegionOcr).toHaveBeenCalledWith("job-1", "region-1"),
    );
    expect(screen.getByLabelText("Source text")).toHaveValue("OCR refreshed source");
    expect(screen.getByLabelText("Thai translation")).toHaveValue("");
  });

  it("generates and displays the shared mask preview", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Canvas mask preview" }));

    await waitFor(() => expect(api.generateMaskPreview).toHaveBeenCalledWith("job-1"));
    expect(screen.getByTestId("mask-state")).toHaveTextContent("ready");
    expect(screen.getByTestId("mask-url")).toHaveTextContent("mask.png?v=2");
    expect(screen.getByTestId("mask-visible")).toHaveTextContent("true");
    expect(onUpdate).toHaveBeenCalledWith("job-1", {
      mask_preview_url: "http://localhost:8000/uploads/mask.png?v=2",
      preview_revision: 2,
    });
  });

  it("deletes a region through canonical collection persistence", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEditor();
    await selectRegion(user);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(api.replaceRegions).toHaveBeenCalledWith("job-1", []));
    expect(onUpdate).toHaveBeenCalledWith("job-1", {
      blocks: [],
      region_mode: "manual_override",
    });
    expect(screen.getByRole("status")).toHaveTextContent("No text regions");
  });

  it("flushes dirty source and translation drafts before approval", async () => {
    const user = userEvent.setup();
    const { onClose, onUpdate } = renderEditor();
    await selectRegion(user);

    const source = screen.getByLabelText("Source text");
    const translation = screen.getByLabelText("Thai translation");
    await user.clear(source);
    await user.type(source, "approved source");
    await user.clear(translation);
    await user.type(translation, "approved translation");
    await user.click(screen.getByRole("button", { name: "ยืนยัน" }));

    await waitFor(() => expect(api.approveTranslation).toHaveBeenCalledOnce());
    expect(api.patchRegion).toHaveBeenCalledWith("job-1", "region-1", {
      text: "approved source",
      translated_text: "approved translation",
    });
    expect(api.approveTranslation).toHaveBeenCalledWith("job-1", {
      "region-1": "approved translation",
    });
    expect(api.patchRegion.mock.invocationCallOrder[0]).toBeLessThan(
      api.approveTranslation.mock.invocationCallOrder[0],
    );
    expect(onUpdate).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "inpainting", progress: 60 }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
});
