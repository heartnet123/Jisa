import { Icon } from "@iconify-icon/react";
import { motion } from "framer-motion";
import type {
  BlockItem,
  TextAlign,
  TypesettingOptionsResponse,
  TypesettingSettings,
  TypesetPreviewResponse,
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
  const busy = action !== null;

  const handleFontChange = (fontName: string) => {
    onTypesettingChange(block.id, {
      ...typesettingValue,
      font_name: fontName === "" ? null : fontName,
    });
  };

  const handleAutoFitChange = (autoFit: boolean) => {
    onTypesettingChange(block.id, {
      ...typesettingValue,
      auto_fit: autoFit,
    });
  };

  const handleFontSizeChange = (size: number) => {
    onTypesettingChange(block.id, {
      ...typesettingValue,
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

  const fontSizeMin = typesettingOptions?.font_size.min ?? 8;
  const fontSizeMax = typesettingOptions?.font_size.max ?? 72;
  const currentFontSize = typesettingValue.font_size ?? 20;

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
        {dirty ? (
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

            {/* Auto-fit and Font Size */}
            <div className="grid grid-cols-2 gap-3 items-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={typesettingValue.auto_fit}
                  disabled={disabled || busy}
                  onChange={e => handleAutoFitChange(e.target.checked)}
                  className="accent-accent"
                />
                <span className="font-mono text-xs text-main">Auto-fit text</span>
              </label>

              <div>
                <label htmlFor={`fontsize-${block.id}`} className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-muted">
                  {typesettingValue.auto_fit ? "Max Size" : "Font Size"}
                </label>
                <div className="flex items-center border border-border bg-panel p-0.5 rounded">
                  <button
                    type="button"
                    disabled={disabled || busy || currentFontSize <= fontSizeMin}
                    onClick={() => handleFontSizeChange(Math.max(fontSizeMin, currentFontSize - 1))}
                    className="flex h-7 w-7 items-center justify-center rounded font-mono text-xs font-bold text-muted hover:bg-surface hover:text-main disabled:opacity-30 transition-colors"
                    aria-label="Decrease font size"
                  >
                    &lt;
                  </button>
                  <div className="flex flex-1 items-center justify-center font-mono text-xs font-bold text-accent">
                    <input
                      id={`fontsize-${block.id}`}
                      type="number"
                      min={fontSizeMin}
                      max={fontSizeMax}
                      value={currentFontSize}
                      disabled={disabled || busy}
                      onChange={e => {
                        const val = Number(e.target.value);
                        if (!isNaN(val)) {
                          handleFontSizeChange(Math.max(fontSizeMin, Math.min(fontSizeMax, val)));
                        }
                      }}
                      className="w-8 bg-transparent text-right font-mono text-xs font-bold text-accent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
                    />
                    <span className="ml-0.5">pt</span>
                  </div>
                  <button
                    type="button"
                    disabled={disabled || busy || currentFontSize >= fontSizeMax}
                    onClick={() => handleFontSizeChange(Math.min(fontSizeMax, currentFontSize + 1))}
                    className="flex h-7 w-7 items-center justify-center rounded font-mono text-xs font-bold text-muted hover:bg-surface hover:text-main disabled:opacity-30 transition-colors"
                    aria-label="Increase font size"
                  >
                    &gt;
                  </button>
                </div>
              </div>
            </div>

            {/* Alignment & Padding */}
            <div className="grid grid-cols-2 gap-3 items-center">
              <div>
                <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-muted">
                  Alignment
                </label>
                <div className="flex border border-border bg-panel p-0.5 rounded">
                  {(["left", "center", "right"] as TextAlign[]).map(align => (
                    <button
                      key={align}
                      type="button"
                      disabled={disabled || busy}
                      onClick={() => handleAlignChange(align)}
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

              <div>
                <label htmlFor={`padding-${block.id}`} className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-muted">
                  Padding
                </label>
                <div className="flex items-center border border-border bg-panel p-0.5 rounded">
                  <button
                    type="button"
                    disabled={disabled || busy || Math.round((typesettingValue.padding_ratio ?? 0.1) * 100) <= 0}
                    onClick={() => {
                      const currentPct = Math.round((typesettingValue.padding_ratio ?? 0.1) * 100);
                      const nextPct = Math.max(0, currentPct - 1);
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
                      type="number"
                      min={0}
                      max={30}
                      value={Math.round((typesettingValue.padding_ratio ?? 0.1) * 100)}
                      disabled={disabled || busy}
                      onChange={e => {
                        const val = Number(e.target.value);
                        if (!isNaN(val)) {
                          const clamped = Math.max(0, Math.min(30, val));
                          handlePaddingChange(Number((clamped / 100).toFixed(2)));
                        }
                      }}
                      className="w-7 bg-transparent text-right font-mono text-xs font-bold text-accent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:opacity-50"
                    />
                    <span className="ml-0.5">%</span>
                  </div>
                  <button
                    type="button"
                    disabled={disabled || busy || Math.round((typesettingValue.padding_ratio ?? 0.1) * 100) >= 30}
                    onClick={() => {
                      const currentPct = Math.round((typesettingValue.padding_ratio ?? 0.1) * 100);
                      const nextPct = Math.min(30, currentPct + 1);
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
              disabled={disabled || busy || !dirty}
              onClick={event => {
                event.stopPropagation();
                onSave(block.id);
              }}
              className="flex min-h-11 items-center justify-center gap-1 bg-accent px-2 font-mono text-xs font-bold uppercase text-white hover:bg-accent-hover disabled:bg-panel disabled:text-muted"
            >
              <Icon icon={action === "save" ? "eos-icons:loading" : "solar:diskette-linear"} />
              Save
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
