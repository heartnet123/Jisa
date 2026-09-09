import { useEffect, useState } from "react";
import { Icon } from "@iconify-icon/react";
import { motion } from "framer-motion";
import type {
  BlockItem,
  TextAlign,
  TypesettingOptionsResponse,
  TypesettingSettings,
} from "../types";

interface RegionInspectorCardProps {
  block: BlockItem;
  index: number;
  selected: boolean;
  sourceValue: string;
  translationValue: string;
  typesettingValue: TypesettingSettings;
  typesettingOptions?: TypesettingOptionsResponse | null;
  previewStatus?: {
    resolved_font_size?: number;
    auto_shrunk?: boolean;
    overflow?: boolean;
    truncated?: boolean;
    lines?: string[];
    loading?: boolean;
    error?: string | null;
  } | null;
  dirty: boolean;
  saveStatus?: "idle" | "unsaved" | "saving" | "saved";
  action: "save" | "ocr" | "delete" | null;
  disabled: boolean;
  onDelete: (blockId: string) => void;
  onRerunOcr: (blockId: string) => void;
  onSave: (blockId: string) => void;
  onSelect: (blockId: string) => void;
  onSourceChange: (blockId: string, value: string) => void;
  onTranslationChange: (blockId: string, value: string) => void;
  onTypesettingChange: (blockId: string, settings: TypesettingSettings) => void;
}

export function RegionInspectorCard({
  block,
  index,
  selected,
  sourceValue,
  translationValue,
  typesettingValue,
  typesettingOptions,
  previewStatus,
  dirty,
  saveStatus,
  action,
  disabled,
  onDelete,
  onRerunOcr,
  onSave,
  onSelect,
  onSourceChange,
  onTranslationChange,
  onTypesettingChange,
}: RegionInspectorCardProps) {
  const isSaving = saveStatus === "saving" || action === "save";
  const isSaved = saveStatus === "saved" && !dirty && !isSaving;
  const busy = action !== null;

  const fontSizeMin = typesettingOptions?.font_size.min ?? 8;
  const fontSizeMax = typesettingOptions?.font_size.max ?? 72;
  const currentFontSize = typesettingValue.font_size ?? 20;

  const currentPaddingRatio = typesettingValue.padding_ratio ?? 0.1;
  const currentPaddingPercent = Math.round(currentPaddingRatio * 100);
  const paddingMinPercent = Math.round((typesettingOptions?.padding_ratio.min ?? 0.0) * 100);
  const paddingMaxPercent = Math.round((typesettingOptions?.padding_ratio.max ?? 0.30) * 100);
  const paddingStepPercent = Math.max(1, Math.round((typesettingOptions?.padding_ratio.step ?? 0.01) * 100));

  const [fontSizeInput, setFontSizeInput] = useState<string>(String(currentFontSize));
  const [paddingInput, setPaddingInput] = useState<string>(String(currentPaddingPercent));

  const handleFontChange = (fontName: string) => {
    onTypesettingChange(block.id, {
      ...typesettingValue,
      font_name: fontName === "" ? null : fontName,
    });
  };

  const handleAutoFitChange = (autoFit: boolean) => {
    if (autoFit) {
      const resolvedFontSize = previewStatus?.resolved_font_size;
      const nextSize = resolvedFontSize ?? currentFontSize;
      setFontSizeInput(String(nextSize));
      onTypesettingChange(block.id, {
        ...typesettingValue,
        auto_fit: true,
        font_size: nextSize,
      });
    } else {
      setFontSizeInput(String(currentFontSize));
      onTypesettingChange(block.id, {
        ...typesettingValue,
        auto_fit: false,
        font_size: currentFontSize,
      });
    }
  };

  const handleFontSizeChange = (size: number) => {
    setFontSizeInput(String(size));
    onTypesettingChange(block.id, {
      ...typesettingValue,
      auto_fit: false,
      font_size: size,
    });
  };

  const handleAlignChange = (align: TextAlign) => {
    onTypesettingChange(block.id, {
      ...typesettingValue,
      text_align: align,
    });
  };

  const handlePaddingChange = (padding: number) => {
    onTypesettingChange(block.id, {
      ...typesettingValue,
      padding_ratio: padding,
    });
  };

  useEffect(() => {
    setFontSizeInput(String(currentFontSize));
  }, [currentFontSize]);

  useEffect(() => {
    setPaddingInput(String(currentPaddingPercent));
  }, [currentPaddingPercent]);

  const commitFontSize = (valStr: string) => {
    let num = parseInt(valStr, 10);
    if (isNaN(num)) {
      num = currentFontSize;
    }
    const clamped = Math.max(fontSizeMin, Math.min(fontSizeMax, num));
    setFontSizeInput(String(clamped));
    if (clamped !== currentFontSize) {
      handleFontSizeChange(clamped);
    }
  };

  const commitPadding = (valStr: string) => {
    let num = parseInt(valStr, 10);
    if (isNaN(num)) {
      num = currentPaddingPercent;
    }
    const clamped = Math.max(paddingMinPercent, Math.min(paddingMaxPercent, num));
    setPaddingInput(String(clamped));
    const newRatio = Number((clamped / 100).toFixed(2));
    if (newRatio !== (typesettingValue.padding_ratio ?? 0.1)) {
      handlePaddingChange(newRatio);
    }
  };

  return (
    <motion.article
      layout
      id={`segment-${block.id}`}
      onClick={() => onSelect(block.id)}
      className={`border p-4 transition-colors ${
        selected
          ? "border-accent/60 bg-accent-surface"
          : "border-border bg-panel hover:border-border-strong"
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="border border-accent/20 bg-accent-surface px-2 py-0.5 font-mono text-[10px] font-bold text-accent">
            Region {index + 1}
          </span>
          <span className="font-mono text-xs uppercase tracking-wider text-muted">
            {block.source}
          </span>
        </div>
        {isSaving ? (
          <span className="flex items-center gap-1 font-mono text-xs uppercase text-accent font-medium">
            <Icon icon="eos-icons:loading" className="text-xs animate-spin" />
            Saving…
          </span>
        ) : isSaved ? (
          <span className="flex items-center gap-1 font-mono text-xs uppercase text-emerald-500 font-medium">
            <Icon icon="solar:check-circle-linear" className="text-xs" />
            Saved
          </span>
        ) : dirty ? (
          <span className="flex items-center gap-1 font-mono text-xs uppercase text-yellow-500 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
            Unsaved
          </span>
        ) : translationValue.trim().length === 0 ? (
          <span className="flex items-center gap-1 font-mono text-xs uppercase text-yellow-500 font-medium">
            <Icon icon="solar:danger-triangle-linear" /> Empty draft
          </span>
        ) : null}
      </div>

      {selected ? (
        <div className="space-y-4">
          <div>
            <label
              htmlFor={`source-${block.id}`}
              className="mb-1 block font-mono text-xs uppercase tracking-widest text-muted font-medium"
            >
              Source text
            </label>
            <textarea
              id={`source-${block.id}`}
              value={sourceValue}
              disabled={disabled || busy}
              onChange={event => onSourceChange(block.id, event.target.value)}
              className="h-16 w-full resize-none border border-border bg-surface p-2.5 font-mono text-xs leading-relaxed text-main outline-none transition-colors focus:border-accent disabled:opacity-50"
              placeholder="Enter source text or rerun OCR"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label
                htmlFor={`translation-${block.id}`}
                className="font-mono text-xs uppercase tracking-widest text-accent font-medium"
              >
                Thai translation
              </label>
              <span className="font-mono text-[10px] text-muted">
                Press Enter for explicit line break
              </span>
            </div>
            <textarea
              id={`translation-${block.id}`}
              value={translationValue}
              disabled={disabled || busy}
              onChange={event => onTranslationChange(block.id, event.target.value)}
              placeholder="พิมพ์คำแปลภาษาไทย..."
              className="h-20 w-full resize-none border border-border bg-surface p-2.5 text-sm leading-relaxed text-main outline-none transition-colors focus:border-accent disabled:opacity-50"
              style={{ fontFamily: "'Sarabun', 'Segoe UI', Tahoma, sans-serif" }}
            />
          </div>

          {/* Typesetting Controls */}
          <div className="rounded border border-border bg-surface p-3 space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="font-mono text-xs uppercase tracking-wider font-bold text-main">
                Typesetting Controls
              </span>
              {previewStatus?.loading ? (
                <span className="flex items-center gap-1 font-mono text-[10px] text-accent">
                  <Icon icon="eos-icons:loading" /> Rendering...
                </span>
              ) : previewStatus?.overflow ? (
                <span className="flex items-center gap-1 rounded bg-yellow-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-yellow-500">
                  <Icon icon="solar:danger-triangle-bold" /> Overflow
                </span>
              ) : previewStatus?.truncated ? (
                <span className="flex items-center gap-1 rounded bg-red-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-red-500">
                  <Icon icon="solar:danger-triangle-bold" /> Truncated
                </span>
              ) : previewStatus?.auto_shrunk ? (
                <span className="flex items-center gap-1 rounded bg-blue-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-blue-400">
                  Auto-shrunk ({previewStatus.resolved_font_size}pt)
                </span>
              ) : previewStatus?.resolved_font_size ? (
                <span className="flex items-center gap-1 rounded bg-green-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-green-400">
                  Fits ({previewStatus.resolved_font_size}pt)
                </span>
              ) : null}
            </div>

            {/* Font Selector */}
            <div>
              <label htmlFor={`font-${block.id}`} className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-muted">
                Font Family
              </label>
              <select
                id={`font-${block.id}`}
                value={typesettingValue.font_name ?? ""}
                disabled={disabled || busy}
                onChange={e => handleFontChange(e.target.value)}
                className="w-full border border-border bg-panel px-2.5 py-1.5 font-mono text-xs text-main outline-none focus:border-accent disabled:opacity-50"
              >
                <option value="">Project Default ({typesettingOptions?.default_font_name ?? "Itim-Regular.ttf"})</option>
                {(typesettingOptions?.fonts ?? []).map(font => (
                  <option key={font.name} value={font.name}>
                    {font.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Font Size & Padding */}
            <div className="grid grid-cols-2 gap-3 items-center">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label htmlFor={`fontsize-${block.id}`} className="font-mono text-[11px] uppercase tracking-wider text-muted">
                    {typesettingValue.auto_fit ? "Max Size" : "Font Size"}
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={typesettingValue.auto_fit}
                      disabled={disabled || busy}
                      onChange={e => handleAutoFitChange(e.target.checked)}
                      className="accent-accent h-3 w-3"
                    />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted hover:text-main">
                      Auto-fit
                    </span>
                  </label>
                </div>
                <div className="flex items-center border border-border bg-panel p-0.5 rounded">
                  <button
                    type="button"
                    disabled={disabled || busy || currentFontSize <= fontSizeMin}
                    onClick={() => {
                      const next = Math.max(fontSizeMin, currentFontSize - 1);
                      setFontSizeInput(String(next));
                      handleFontSizeChange(next);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded font-mono text-xs font-bold text-muted hover:bg-surface hover:text-main disabled:opacity-30 transition-colors"
                    aria-label="Decrease font size"
                  >
                    &lt;
                  </button>
                  <div className="flex flex-1 items-center justify-center font-mono text-xs font-bold text-accent">
                    <input
                      id={`fontsize-${block.id}`}
                      type="text"
                      inputMode="numeric"
                      value={fontSizeInput}
                      disabled={disabled || busy}
                      onChange={e => setFontSizeInput(e.target.value)}
                      onBlur={() => commitFontSize(fontSizeInput)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                      className="w-8 bg-transparent text-right font-mono text-xs font-bold text-accent outline-none disabled:opacity-50"
                    />
                    <span className="ml-0.5">pt</span>
                  </div>
                  <button
                    type="button"
                    disabled={disabled || busy || currentFontSize >= fontSizeMax}
                    onClick={() => {
                      const next = Math.min(fontSizeMax, currentFontSize + 1);
                      setFontSizeInput(String(next));
                      handleFontSizeChange(next);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded font-mono text-xs font-bold text-muted hover:bg-surface hover:text-main disabled:opacity-30 transition-colors"
                    aria-label="Increase font size"
                  >
                    &gt;
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor={`padding-${block.id}`} className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-muted">
                  Padding
                </label>
                <div className="flex items-center border border-border bg-panel p-0.5 rounded">
                  <button
                    type="button"
                    disabled={disabled || busy || currentPaddingPercent <= paddingMinPercent}
                    onClick={() => {
                      const nextPct = Math.max(paddingMinPercent, currentPaddingPercent - paddingStepPercent);
                      setPaddingInput(String(nextPct));
                      handlePaddingChange(Number((nextPct / 100).toFixed(2)));
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded font-mono text-xs font-bold text-muted hover:bg-surface hover:text-main disabled:opacity-30 transition-colors"
                    aria-label="Decrease padding"
                  >
                    &lt;
                  </button>
                  <div className="flex flex-1 items-center justify-center font-mono text-xs font-bold text-accent">
                    <input
                      id={`padding-${block.id}`}
                      type="text"
                      inputMode="numeric"
                      value={paddingInput}
                      disabled={disabled || busy}
                      onChange={e => setPaddingInput(e.target.value)}
                      onBlur={() => commitPadding(paddingInput)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        }
                      }}
                      className="w-7 bg-transparent text-right font-mono text-xs font-bold text-accent outline-none disabled:opacity-50"
                    />
                    <span className="ml-0.5">%</span>
                  </div>
                  <button
                    type="button"
                    disabled={disabled || busy || currentPaddingPercent >= paddingMaxPercent}
                    onClick={() => {
                      const nextPct = Math.min(paddingMaxPercent, currentPaddingPercent + paddingStepPercent);
                      setPaddingInput(String(nextPct));
                      handlePaddingChange(Number((nextPct / 100).toFixed(2)));
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded font-mono text-xs font-bold text-muted hover:bg-surface hover:text-main disabled:opacity-30 transition-colors"
                    aria-label="Increase padding"
                  >
                    &gt;
                  </button>
                </div>
              </div>
            </div>

            {/* Alignment */}
            <div>
              <span id={`alignment-label-${block.id}`} className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-muted">
                Alignment
              </span>
              <div
                role="group"
                aria-labelledby={`alignment-label-${block.id}`}
                className="flex border border-border bg-panel p-0.5 rounded"
              >
                {(["left", "center", "right"] as TextAlign[]).map(align => (
                  <button
                    key={align}
                    type="button"
                    disabled={disabled || busy}
                    onClick={() => handleAlignChange(align)}
                    aria-label={`Align text ${align}`}
                    aria-pressed={typesettingValue.text_align === align}
                    className={`flex-1 py-1 text-center font-mono text-xs uppercase tracking-wider transition-colors ${
                      typesettingValue.text_align === align
                        ? "bg-accent font-bold text-white"
                        : "text-muted hover:text-main"
                    }`}
                  >
                    {align[0]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={disabled || busy}
              onClick={event => {
                event.stopPropagation();
                onRerunOcr(block.id);
              }}
              className="flex min-h-11 items-center justify-center gap-1 border border-border bg-surface px-2 font-mono text-xs font-bold uppercase text-accent hover:border-accent disabled:opacity-40"
            >
              <Icon icon={action === "ocr" ? "eos-icons:loading" : "solar:text-square-linear"} />
              Re-OCR
            </button>
            <button
              type="button"
              disabled={disabled || busy || !dirty || isSaving}
              onClick={event => {
                event.stopPropagation();
                onSave(block.id);
              }}
              className="flex min-h-11 items-center justify-center gap-1 bg-accent px-2 font-mono text-xs font-bold uppercase text-white hover:bg-accent-hover disabled:bg-panel disabled:text-muted"
            >
              <Icon icon={isSaving ? "eos-icons:loading" : "solar:diskette-linear"} className={isSaving ? "animate-spin" : ""} />
              {isSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={disabled || busy}
              onClick={event => {
                event.stopPropagation();
                onDelete(block.id);
              }}
              className="flex min-h-11 items-center justify-center gap-1 border border-red-500/40 bg-surface px-2 font-mono text-xs font-bold uppercase text-red-500 hover:border-red-500 disabled:opacity-40"
            >
              <Icon icon={action === "delete" ? "eos-icons:loading" : "solar:trash-bin-trash-linear"} />
              Delete
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="line-clamp-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted">
            {sourceValue || "No source text."}
          </p>
          <p className="line-clamp-2 text-xs leading-relaxed text-accent">
            {translationValue || "No translation yet."}
          </p>
        </div>
      )}
    </motion.article>
  );
}
