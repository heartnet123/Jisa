import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    blocks,
    previewOverlays,
    onChange,
    onCommit,
  }: {
    maskPreviewState: string;
    maskPreviewUrl?: string;
    showMaskPreview: boolean;
    onToggleMaskPreview?: () => void;
    blocks: BlockItem[];
    previewOverlays?: Record<string, { base64?: string }>;
    onChange: (blocks: BlockItem[]) => void;
    onCommit: (blocks: BlockItem[]) => void;
  }) => (
    <div>
      <button type="button" onClick={onToggleMaskPreview}>
        Canvas mask preview
      </button>
      <span data-testid="typeset-overlay">{previewOverlays?.['region-1']?.base64}</span>
      <span data-testid="canvas-x">{blocks[0]?.box.x}</span>
      <span data-testid="mask-state">{maskPreviewState}</span>
      <span data-testid="mask-url">{maskPreviewUrl ?? ""}</span>
      <span data-testid="mask-visible">{String(showMaskPreview)}</span>
      <button type="button" onClick={() => {
        const moved = blocks.map(region => ({ ...region, box: { ...region.box, x: region.box.x + 0.1 } }));
        onChange(moved);
        onCommit(moved);
      }}>Move canvas region</button>
      <button type="button" onClick={() => onChange(blocks.map(region => ({
        ...region, box: { ...region.box, x: region.box.x + 0.1 },
      })))}>Drag canvas region</button>
      <button type="button" onClick={() => onCommit(blocks)}>Commit canvas region</button>
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

  it("waits for slow geometry saves before requesting a typeset preview", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    api.replaceRegions.mockImplementationOnce((_id, regions) => new Promise(resolve => {
      finish = () => resolve({ region_mode: "manual_override", regions });
    }));
    renderEditor();
    await selectRegion(user);
    await waitFor(() => expect(api.generateTypesetPreview).toHaveBeenCalled());
    api.generateTypesetPreview.mockClear();
    await user.click(screen.getByText("Move canvas region"));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(api.generateTypesetPreview).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "ยืนยัน" })).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(api.generateTypesetPreview).toHaveBeenCalledOnce());
    await user.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(api.approveTranslation).toHaveBeenCalledOnce());
  });

  it("regenerates typeset preview when drag-then-commit finishes saving", async () => {
    const user = userEvent.setup();
    let finishSave!: () => void;
    api.replaceRegions.mockImplementationOnce((_id, regions) => new Promise(resolve => {
      finishSave = () => resolve({ region_mode: "manual_override", regions });
    }));
    renderEditor();
    await selectRegion(user);
    await waitFor(() => expect(api.generateTypesetPreview).toHaveBeenCalledTimes(1));
    api.generateTypesetPreview.mockClear();

    // Drag first (sets state, triggers effect with revision N)
    await user.click(screen.getByText("Drag canvas region"));
    // Then commit (increments revision to N+1, starts save)
    await user.click(screen.getByText("Commit canvas region"));

    // Wait 300ms (timer fires, awaits geometry save)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(api.generateTypesetPreview).not.toHaveBeenCalled();

    // Finish geometry save -> preview MUST be requested
    await act(async () => finishSave());
    await waitFor(() => expect(api.generateTypesetPreview).toHaveBeenCalledTimes(1));
  });

  it("does not request preview while dragging before commit occurs", async () => {
    const user = userEvent.setup();
    renderEditor();
    await selectRegion(user);
    await waitFor(() => expect(api.generateTypesetPreview).toHaveBeenCalledTimes(1));
    api.generateTypesetPreview.mockClear();

    // User drags region (onChange fires, but onCommit has not fired)
    await user.click(screen.getByText("Drag canvas region"));

    // User pauses drag for 350ms (> 250ms debounce)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });

    // Preview MUST NOT be requested with stale server coordinates while uncommitted
    expect(api.generateTypesetPreview).not.toHaveBeenCalled();

    // User releases mouse / commits
    await user.click(screen.getByText("Commit canvas region"));
    await waitFor(() => expect(api.generateTypesetPreview).toHaveBeenCalledTimes(1));
  });

  it("serializes saves and keeps newer geometry and text drafts", async () => {
    const user = userEvent.setup();
    const finishes: Array<() => void> = [];
    api.replaceRegions.mockImplementation((_id, regions) => new Promise(resolve => {
      finishes.push(() => resolve({ region_mode: "manual_override", regions }));
    }));
    renderEditor();
    await selectRegion(user);
    fireEvent.change(screen.getByLabelText("Thai translation"), { target: { value: "unsaved draft" } });
    await user.click(screen.getByText("Move canvas region"));
    await user.click(screen.getByText("Move canvas region"));
    expect(api.replaceRegions).toHaveBeenCalledOnce();
    await act(async () => finishes[0]());
    expect(api.replaceRegions).toHaveBeenCalledTimes(2);
    expect(Number(screen.getByTestId("canvas-x").textContent)).toBeCloseTo(0.3);
    await act(async () => finishes[1]());
    expect(Number(screen.getByTestId("canvas-x").textContent)).toBeCloseTo(0.3);
    expect(screen.getByLabelText("Thai translation")).toHaveValue("unsaved draft");
    await user.click(screen.getByRole("button", { name: "ยืนยัน" }));
    await waitFor(() => expect(api.approveTranslation).toHaveBeenCalledWith("job-1", { "region-1": "unsaved draft" }));
  });

  it("discards an in-flight typeset response after geometry changes", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    api.generateTypesetPreview.mockImplementationOnce((_job, _region, req) => new Promise(resolve => {
      finish = () => resolve({ client_revision: req.client_revision, mime_type: "image/png", overlay_base64: "stale", bounds_px: { x: 1, y: 1, width: 10, height: 10 }, lines: [], resolved_font_size: 20, auto_shrunk: false, overflow: false, truncated: false });
    }));
    renderEditor();
    await selectRegion(user);
    await waitFor(() => expect(api.generateTypesetPreview).toHaveBeenCalledOnce());
    await user.click(screen.getByText("Move canvas region"));
    await act(async () => finish());
    expect(screen.getByTestId("typeset-overlay")).not.toHaveTextContent("stale");
    await waitFor(() => expect(api.generateTypesetPreview).toHaveBeenCalledTimes(2));
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

  it.each(["Move", "Drag"])("ignores a mask response after %s and allows regeneration", async action => {
    const user = userEvent.setup();
    let resolve!: (value: { url: string; revision: number }) => void;
    api.generateMaskPreview.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const { onUpdate } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Canvas mask preview" }));
    await user.click(screen.getByRole("button", { name: `${action} canvas region` }));
    await act(async () => { resolve({ url: "/old-mask.png", revision: 1 }); });

    expect(screen.getByTestId("mask-visible")).toHaveTextContent("false");
    expect(screen.getByTestId("mask-state")).toHaveTextContent("stale");
    expect(onUpdate).not.toHaveBeenCalledWith("job-1", expect.objectContaining({ mask_preview_url: "/old-mask.png" }));
    await user.click(screen.getByRole("button", { name: "Canvas mask preview" }));
    expect(screen.getByTestId("mask-url")).toHaveTextContent("mask.png?v=2");
    expect(screen.getByTestId("mask-visible")).toHaveTextContent("true");
  });

  it("ignores an old mask error after a newer preview succeeds", async () => {
    const user = userEvent.setup();
    let reject!: (reason: Error) => void;
    api.generateMaskPreview.mockReturnValueOnce(new Promise((_done, fail) => { reject = fail; }));
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Canvas mask preview" }));
    await user.click(screen.getByRole("button", { name: "Move canvas region" }));
    await user.click(screen.getByRole("button", { name: "Canvas mask preview" }));
    await act(async () => { reject(new Error("stale request failed")); });

    expect(screen.getByTestId("mask-state")).toHaveTextContent("ready");
    expect(screen.getByTestId("mask-visible")).toHaveTextContent("true");
    expect(screen.queryByText("stale request failed")).not.toBeInTheDocument();
  });

  it("ignores a mask response belonging to the previous page", async () => {
    const user = userEvent.setup();
    let resolve!: (value: { url: string; revision: number }) => void;
    api.generateMaskPreview.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const onUpdate = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(<TranslationEditor item={item} onClose={onClose} onUpdate={onUpdate} />);
    await user.click(screen.getByRole("button", { name: "Canvas mask preview" }));
    rerender(<TranslationEditor item={{ ...item, id: "job-2" }} onClose={onClose} onUpdate={onUpdate} />);
    await act(async () => { resolve({ url: "/previous-page-mask.png", revision: 1 }); });

    expect(screen.getByTestId("mask-state")).toHaveTextContent("idle");
    expect(screen.getByTestId("mask-visible")).toHaveTextContent("false");
    expect(onUpdate).not.toHaveBeenCalled();
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

  it("adjusts font size and padding using stepper controls", async () => {
    const user = userEvent.setup();
    renderEditor();
    await selectRegion(user);

    const fontInput = screen.getByLabelText("Max Size") as HTMLInputElement;
    expect(fontInput.value).toBe("20");

    await user.click(screen.getByRole("button", { name: "Increase font size" }));
    expect(fontInput.value).toBe("21");

    await user.click(screen.getByRole("button", { name: "Decrease font size" }));
    expect(fontInput.value).toBe("20");

    const paddingInput = screen.getByLabelText("Padding") as HTMLInputElement;
    expect(paddingInput.value).toBe("10");

    await user.click(screen.getByRole("button", { name: "Increase padding" }));
    expect(paddingInput.value).toBe("11");

    await user.click(screen.getByRole("button", { name: "Decrease padding" }));
    expect(paddingInput.value).toBe("10");

    // Allows clearing text and typing custom values without instant auto-clamping
    await user.clear(fontInput);
    await user.type(fontInput, "15");
    expect(fontInput.value).toBe("15");
    fireEvent.blur(fontInput);
    expect(fontInput.value).toBe("15");

    // Clamps values below minimum (min is 8) on blur
    await user.clear(fontInput);
    await user.type(fontInput, "2");
    expect(fontInput.value).toBe("2");
    fireEvent.blur(fontInput);
    expect(fontInput.value).toBe("8");

    // Clamps values above maximum (max is 72) on blur
    await user.clear(fontInput);
    await user.type(fontInput, "100");
    expect(fontInput.value).toBe("100");
    fireEvent.blur(fontInput);
    expect(fontInput.value).toBe("72");
  });

  it("syncs Auto-fit with max size and unchecks Auto-fit when font size is manually changed", async () => {
    const user = userEvent.setup();
    api.generateTypesetPreview.mockImplementation(async (_jobId, _regionId, req) => ({
      client_revision: req.client_revision,
      mime_type: "image/png",
      overlay_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      bounds_px: { x: 100, y: 320, width: 300, height: 160 },
      lines: ["Line 1"],
      resolved_font_size: req.typesetting.auto_fit ? 14 : req.typesetting.font_size ?? 20,
      auto_shrunk: false,
      overflow: false,
      truncated: false,
    }));
    renderEditor();
    await selectRegion(user);

    const autoFitCheckbox = screen.getByRole("checkbox", { name: "Auto-fit" }) as HTMLInputElement;
    expect(autoFitCheckbox.checked).toBe(true);

    const fontInput = screen.getByLabelText("Max Size") as HTMLInputElement;
    await waitFor(() => expect(fontInput.value).toBe("14"));
    await waitFor(() =>
      expect(api.generateTypesetPreview).toHaveBeenLastCalledWith(
        "job-1",
        "region-1",
        expect.objectContaining({
          typesetting: expect.objectContaining({ auto_fit: true }),
        }),
      ),
    );

    // Disabling Auto-fit keeps the resolved size as the manual font size.
    await user.click(autoFitCheckbox);
    expect(autoFitCheckbox.checked).toBe(false);
    expect(screen.getByLabelText("Font Size")).toHaveValue("14");

    // Re-checking Auto-fit keeps the synced max size.
    await user.click(autoFitCheckbox);
    expect(autoFitCheckbox.checked).toBe(true);
    await waitFor(() => expect(screen.getByLabelText("Max Size")).toHaveValue("14"));

    // Manually changing font size unchecks Auto-fit and uses the displayed value as its baseline.
    await user.click(screen.getByRole("button", { name: "Increase font size" }));
    expect(autoFitCheckbox.checked).toBe(false);
    expect(screen.getByLabelText("Font Size")).toHaveValue("15");
  });

  it("keeps Auto-fit checked when the max size is blurred without a value change", async () => {
    const user = userEvent.setup();
    renderEditor();
    await selectRegion(user);

    const autoFitCheckbox = screen.getByRole("checkbox", { name: "Auto-fit" }) as HTMLInputElement;
    const fontInput = screen.getByLabelText("Max Size") as HTMLInputElement;
    await waitFor(() => expect(fontInput.value).toBe("20"));

    fireEvent.blur(fontInput);
    expect(autoFitCheckbox.checked).toBe(true);
    expect(screen.getByLabelText("Max Size")).toBeInTheDocument();
  });

  it("auto-saves translation change after debounce timeout", async () => {
    renderEditor();
    const user = userEvent.setup();
    await selectRegion(user);

    const input = screen.getByLabelText("Thai translation");
    fireEvent.change(input, { target: { value: "auto-saved translation" } });

    expect(api.patchRegion).not.toHaveBeenCalled();
    expect(screen.getByText("Unsaved")).toBeInTheDocument();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 750));
    });

    await waitFor(() =>
      expect(api.patchRegion).toHaveBeenCalledWith("job-1", "region-1", {
        translated_text: "auto-saved translation",
      }),
    );
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("debounces rapid inputs into single auto-save call", async () => {
    renderEditor();
    const user = userEvent.setup();
    await selectRegion(user);

    const input = screen.getByLabelText("Thai translation");
    fireEvent.change(input, { target: { value: "a" } });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
    });
    fireEvent.change(input, { target: { value: "ab" } });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
    });
    fireEvent.change(input, { target: { value: "abc" } });

    expect(api.patchRegion).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 750));
    });

    await waitFor(() => expect(api.patchRegion).toHaveBeenCalledOnce());
    expect(api.patchRegion).toHaveBeenCalledWith("job-1", "region-1", {
      translated_text: "abc",
    });
  });

  it("auto-saves source text change after debounce timeout", async () => {
    renderEditor();
    const user = userEvent.setup();
    await selectRegion(user);

    const input = screen.getByLabelText("Source text");
    fireEvent.change(input, { target: { value: "auto-saved source" } });

    expect(api.patchRegion).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 750));
    });

    await waitFor(() =>
      expect(api.patchRegion).toHaveBeenCalledWith("job-1", "region-1", {
        text: "auto-saved source",
      }),
    );
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });

  it("auto-saves typesetting change after debounce timeout", async () => {
    renderEditor();
    const user = userEvent.setup();
    await selectRegion(user);

    await user.click(screen.getByRole("button", { name: "Increase font size" }));
    expect(api.patchRegion).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 750));
    });

    await waitFor(() =>
      expect(api.patchRegion).toHaveBeenCalledWith(
        "job-1",
        "region-1",
        expect.objectContaining({
          typesetting: expect.objectContaining({ font_size: 21, auto_fit: false }),
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  });

  it("flushes pending auto-save immediately when switching region selection", async () => {
    const user = userEvent.setup();
    const block2: BlockItem = {
      id: "region-2",
      box: { x: 0.5, y: 0.5, width: 0.2, height: 0.1 },
      source: "detected",
      text: "second source",
      translated_text: "second translation",
    };
    render(
      <TranslationEditor
        item={{ ...item, blocks: [block, block2] }}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Region 1"));
    const input = screen.getByLabelText("Thai translation");
    fireEvent.change(input, { target: { value: "draft 1" } });

    expect(api.patchRegion).not.toHaveBeenCalled();

    // Switch selection to Region 2 without waiting for debounce timeout
    await user.click(screen.getByText("Region 2"));

    // Region 1 must be immediately flushed
    await waitFor(() =>
      expect(api.patchRegion).toHaveBeenCalledWith("job-1", "region-1", {
        translated_text: "draft 1",
      }),
    );
  });

  it("manual save button immediately saves and cancels pending debounce", async () => {
    renderEditor();
    const user = userEvent.setup();
    await selectRegion(user);

    const input = screen.getByLabelText("Thai translation");
    fireEvent.change(input, { target: { value: "manual save draft" } });

    const saveBtn = screen.getByRole("button", { name: "Save" });
    await user.click(saveBtn);

    await waitFor(() =>
      expect(api.patchRegion).toHaveBeenCalledWith("job-1", "region-1", {
        translated_text: "manual save draft",
      }),
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 800));
    });
    expect(api.patchRegion).toHaveBeenCalledOnce();
  });

  it("flushes pending auto-save immediately on Exit button click before closing", async () => {
    const onClose = vi.fn();
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(
      <TranslationEditor
        item={{ ...item, blocks: item.blocks?.map(region => ({ ...region })) }}
        onClose={onClose}
        onUpdate={onUpdate}
      />,
    );
    await selectRegion(user);

    const input = screen.getByLabelText("Thai translation");
    fireEvent.change(input, { target: { value: "exit flush text" } });

    expect(api.patchRegion).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Exit" }));

    await waitFor(() =>
      expect(api.patchRegion).toHaveBeenCalledWith("job-1", "region-1", {
        translated_text: "exit flush text",
      }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("flushes pending auto-save before page navigation", async () => {
    const user = userEvent.setup();
    const onNavigatePage = vi.fn().mockResolvedValue(undefined);
    const page1 = { id: "job-1", filename: "page1.png" };
    const page2 = { id: "job-2", filename: "page2.png" };
    render(
      <TranslationEditor
        item={{ ...item, blocks: item.blocks?.map(region => ({ ...region })) }}
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        pages={[page1, page2]}
        onNavigatePage={onNavigatePage}
      />,
    );
    await selectRegion(user);

    const input = screen.getByLabelText("Thai translation");
    fireEvent.change(input, { target: { value: "page nav text" } });

    expect(api.patchRegion).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Next >" }));

    await waitFor(() =>
      expect(api.patchRegion).toHaveBeenCalledWith("job-1", "region-1", {
        translated_text: "page nav text",
      }),
    );
    expect(onNavigatePage).toHaveBeenCalledWith("job-2");
  });

  it("displays error indicator on card when auto-save fails", async () => {
    api.patchRegion.mockRejectedValueOnce(new Error("Network disconnect"));
    renderEditor();
    const user = userEvent.setup();
    await selectRegion(user);

    const input = screen.getByLabelText("Thai translation");
    fireEvent.change(input, { target: { value: "failing text" } });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 750));
    });

    await waitFor(() => expect(screen.getByText("Save failed")).toBeInTheDocument());
  });
});
