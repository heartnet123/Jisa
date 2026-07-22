"use client";

import { Icon } from "@iconify-icon/react";
import { motion } from "framer-motion";
import type { BlockItem } from "../types";
import { ThaiText } from "./ThaiText";

interface RegionInspectorCardProps {
  block: BlockItem;
  index: number;
  selected: boolean;
  sourceValue: string;
  translationValue: string;
  dirty: boolean;
  action: "save" | "ocr" | "delete" | null;
  disabled: boolean;
  onDelete: (blockId: string) => void;
  onRerunOcr: (blockId: string) => void;
  onSave: (blockId: string) => void;
  onSelect: (blockId: string) => void;
  onSourceChange: (blockId: string, value: string) => void;
  onTranslationChange: (blockId: string, value: string) => void;
}

export function RegionInspectorCard({
  block,
  index,
  selected,
  sourceValue,
  translationValue,
  dirty,
  action,
  disabled,
  onDelete,
  onRerunOcr,
  onSave,
  onSelect,
  onSourceChange,
  onTranslationChange,
}: RegionInspectorCardProps) {
  const busy = action !== null;

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
        <div className="space-y-3">
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
              className="h-20 w-full resize-none border border-border bg-surface p-3 font-mono text-xs leading-relaxed text-main outline-none transition-colors focus:border-accent disabled:opacity-50"
              placeholder="Enter source text or rerun OCR"
            />
          </div>

          <div>
            <label
              htmlFor={`translation-${block.id}`}
              className="mb-1 block font-mono text-xs uppercase tracking-widest text-accent font-medium"
            >
              Thai translation
            </label>
            <textarea
              id={`translation-${block.id}`}
              value={translationValue}
              disabled={disabled || busy}
              onChange={event => onTranslationChange(block.id, event.target.value)}
              placeholder="พิมพ์คำแปลภาษาไทย..."
              className="h-24 w-full resize-none border border-border bg-surface p-3 text-sm leading-relaxed text-main outline-none transition-colors focus:border-accent disabled:opacity-50"
              style={{ fontFamily: "'Sarabun', 'Segoe UI', Tahoma, sans-serif" }}
            />
          </div>

          {translationValue.trim().length > 0 ? (
            <div className="border border-accent/20 bg-accent-surface p-3">
              <span className="mb-1 block font-mono text-xs uppercase tracking-widest text-accent/80 font-medium">
                Typesetting preview
              </span>
              <ThaiText className="text-sm text-accent font-medium">
                {translationValue}
              </ThaiText>
            </div>
          ) : null}

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
