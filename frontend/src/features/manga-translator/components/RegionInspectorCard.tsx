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
          ? "border-cyan-500/60 bg-[#151b22]"
          : "border-[#222] bg-[#0d0d0d] hover:border-[#333]"
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-400">
            Region {index + 1}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-[#666]">
            {block.source}
          </span>
        </div>
        {dirty ? (
          <span className="flex items-center gap-1 font-mono text-[9px] uppercase text-yellow-400">
            <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
            Unsaved
          </span>
        ) : translationValue.trim().length === 0 ? (
          <span className="flex items-center gap-1 font-mono text-[9px] uppercase text-yellow-500">
            <Icon icon="mdi:alert-outline" /> Empty draft
          </span>
        ) : null}
      </div>

      {selected ? (
        <div className="space-y-3">
          <div>
            <label
              htmlFor={`source-${block.id}`}
              className="mb-1 block font-mono text-[9px] uppercase tracking-widest text-[#777]"
            >
              Source text
            </label>
            <textarea
              id={`source-${block.id}`}
              value={sourceValue}
              disabled={disabled || busy}
              onChange={event => onSourceChange(block.id, event.target.value)}
              className="h-20 w-full resize-none border border-[#333] bg-[#101010] p-3 font-mono text-xs leading-relaxed text-[#ddd] outline-none transition-colors focus:border-cyan-500 disabled:opacity-50"
              placeholder="Enter source text or rerun OCR"
            />
          </div>

          <div>
            <label
              htmlFor={`translation-${block.id}`}
              className="mb-1 block font-mono text-[9px] uppercase tracking-widest text-cyan-500/70"
            >
              Thai translation
            </label>
            <textarea
              id={`translation-${block.id}`}
              value={translationValue}
              disabled={disabled || busy}
              onChange={event => onTranslationChange(block.id, event.target.value)}
              placeholder="พิมพ์คำแปลภาษาไทย..."
              className="h-24 w-full resize-none border border-[#333] bg-[#121212] p-3 text-sm leading-relaxed text-cyan-50 outline-none transition-colors focus:border-cyan-500 disabled:opacity-50"
              style={{ fontFamily: "'Sarabun', 'Segoe UI', Tahoma, sans-serif" }}
            />
          </div>

          {translationValue.trim().length > 0 ? (
            <div className="border border-cyan-500/10 bg-cyan-950/10 p-3">
              <span className="mb-1 block font-mono text-[9px] uppercase tracking-widest text-cyan-500/40">
                Typesetting preview
              </span>
              <ThaiText className="text-sm text-cyan-400">
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
              className="flex min-h-10 items-center justify-center gap-1 border border-[#333] px-2 font-mono text-[10px] font-bold uppercase text-cyan-400 hover:border-cyan-500 disabled:opacity-40"
            >
              <Icon icon={action === "ocr" ? "eos-icons:loading" : "mdi:text-recognition"} />
              Re-OCR
            </button>
            <button
              type="button"
              disabled={disabled || busy || !dirty}
              onClick={event => {
                event.stopPropagation();
                onSave(block.id);
              }}
              className="flex min-h-10 items-center justify-center gap-1 bg-cyan-500 px-2 font-mono text-[10px] font-bold uppercase text-black hover:bg-cyan-400 disabled:bg-[#222] disabled:text-[#666]"
            >
              <Icon icon={action === "save" ? "eos-icons:loading" : "mdi:content-save-outline"} />
              Save
            </button>
            <button
              type="button"
              disabled={disabled || busy}
              onClick={event => {
                event.stopPropagation();
                onDelete(block.id);
              }}
              className="flex min-h-10 items-center justify-center gap-1 border border-red-500/40 px-2 font-mono text-[10px] font-bold uppercase text-red-400 hover:border-red-400 disabled:opacity-40"
            >
              <Icon icon={action === "delete" ? "eos-icons:loading" : "mdi:trash-can-outline"} />
              Delete
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="line-clamp-2 whitespace-pre-wrap font-mono text-xs leading-relaxed text-[#888]">
            {sourceValue || "No source text."}
          </p>
          <p className="line-clamp-2 text-xs leading-relaxed text-cyan-400/70">
            {translationValue || "No translation yet."}
          </p>
        </div>
      )}
    </motion.article>
  );
}
