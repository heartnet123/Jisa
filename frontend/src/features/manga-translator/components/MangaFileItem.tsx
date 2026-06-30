"use client";

import React, { useState, useEffect } from "react";
import { Icon } from "@iconify-icon/react";
import { motion, AnimatePresence } from "framer-motion";
import { mangaApi } from "../api/mangaApi";
import type { MangaStatus, ProcessedManga } from "../types";
import { TranslationEditor } from "./TranslationEditor";

interface MangaFileItemProps {
  item: ProcessedManga;
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<ProcessedManga>) => void;
}

const ACTIVE_IMAGE_STATUSES: MangaStatus[] = [
  "segmenting",
  "ocr",
  "translating",
  "inpainting",
  "typesetting",
];

const TERMINAL_ERROR_STATUSES: MangaStatus[] = ["error", "failed", "canceled"];

export const MangaFileItem: React.FC<MangaFileItemProps> = ({
  item,
  onRemove,
  onUpdate,
}) => {
  const [showText, setShowText] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<
    "translated" | "inpainted" | "original"
  >("translated");
  const hasError = TERMINAL_ERROR_STATUSES.includes(item.status);
  const statusMessage =
    item.error ??
    item.message ??
    (item.status === "completed"
      ? "Translation completed."
      : `${item.progress}% Synthesis Logic`);

  const handleCancel = async () => {
    try {
      await mangaApi.cancelJob(item.id);
      onUpdate(item.id, { status: "canceled", message: "Job canceled by user." });
    } catch (err) {
      console.error("Failed to cancel job:", err);
    }
  };

  useEffect(() => {
    if (
      item.status === "completed" ||
      item.status === "uploading" ||
      item.status === "awaiting_review" ||
      TERMINAL_ERROR_STATUSES.includes(item.status)
    ) {
      return;
    }

    const poll = async () => {
      try {
        const response = await mangaApi.checkStatus(item.id);
        onUpdate(item.id, {
          status: response.status,
          progress: response.progress,
          result_url: response.result_url,
          inpainted_url: response.inpainted_url,
          originalUrl: response.originalUrl,
          ocr_text: response.ocr_text,
          translated_text: response.translated_text,
          error: response.error,
          message: response.message,
        });
      } catch (err) {
        console.error("Polling error:", err);
      }
    };

    const interval = setInterval(() => {
      poll();
    }, 2000);

    return () => clearInterval(interval);
  }, [item.id, item.status, onUpdate]);

  const activeImage =
    displayMode === "translated"
      ? item.result_url || item.originalUrl
      : displayMode === "inpainted"
        ? item.inpainted_url || item.originalUrl
        : item.originalUrl;

  const activeLabel =
    displayMode === "translated"
      ? "Final Translated"
      : displayMode === "inpainted"
        ? "Cleaned (Inpainted)"
        : "Original";

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="group bg-[#0d0d0d] border border-[#222] overflow-hidden shadow-2xl hover:border-cyan-500/30 transition-all duration-500"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[#222] bg-[#111]">
        <div className="flex items-center gap-3">
          <Icon icon="mdi:file-image" className="text-[#888]" />
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-widest text-[#444]">
              Source File
            </span>
            <span className="font-mono text-xs uppercase tracking-widest truncate max-w-[200px] font-bold">
              {item.filename}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-6 mr-4">
            <div
              className={cn(
                "flex items-center gap-2 px-3 py-1 bg-[#1a1a1a] rounded-full border border-[#333] transition-all",
                item.status === "completed" &&
                  "border-green-500/50 bg-green-500/5 text-green-500",
                hasError && "border-red-500/50 bg-red-500/5 text-red-500",
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  item.status === "completed"
                    ? "bg-green-500"
                    : hasError
                      ? "bg-red-500"
                      : "bg-cyan-500 animate-pulse",
                )}
              />
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">
                {item.status}
              </span>
            </div>
            <div className="flex gap-2">
              {item.status === "completed" && (
                <div className="flex bg-[#111] border border-[#333] p-1 rounded">
                  <button
                    onClick={() => setDisplayMode("original")}
                    className={cn(
                      "px-2 py-1 text-[9px] font-mono transition-all",
                      displayMode === "original"
                        ? "bg-cyan-500 text-black"
                        : "text-[#888] hover:text-white",
                    )}
                  >
                    RAW
                  </button>
                  <button
                    onClick={() => setDisplayMode("inpainted")}
                    className={cn(
                      "px-2 py-1 text-[9px] font-mono border-x border-[#333] transition-all",
                      displayMode === "inpainted"
                        ? "bg-cyan-500 text-black"
                        : "text-[#888] hover:text-white",
                    )}
                  >
                    CLEAN
                  </button>
                  <button
                    onClick={() => setDisplayMode("translated")}
                    className={cn(
                      "px-2 py-1 text-[9px] font-mono transition-all",
                      displayMode === "translated"
                        ? "bg-cyan-500 text-black"
                        : "text-[#888] hover:text-white",
                    )}
                  >
                    FINAL
                  </button>
                </div>
              )}
              {item.status === "awaiting_review" && (
                <button
                  onClick={() => setIsEditorOpen(true)}
                  className="px-3 py-1 bg-cyan-500 hover:bg-cyan-400 text-black border border-cyan-500 transition-all text-[9px] font-mono font-black uppercase tracking-widest flex items-center gap-1.5"
                >
                  <Icon icon="mdi:translate" />
                  REVIEW
                </button>
              )}
              <button
                onClick={() => setShowText(!showText)}
                className={cn(
                  "p-2 border border-[#333] hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all text-xs",
                  showText && "text-cyan-500 border-cyan-500/50 bg-cyan-500/5",
                )}
                title="View AI Results"
              >
                <Icon icon="mdi:script-text" />
              </button>
              {item.status !== "completed" && !hasError && (
                <button
                  onClick={handleCancel}
                  className="p-2 border border-[#333] text-[#444] hover:text-yellow-500 hover:border-yellow-500 transition-all text-xs"
                  title="Cancel Job"
                >
                  <Icon icon="mdi:stop-circle-outline" />
                </button>
              )}
              <button
                onClick={() => onRemove(item.id)}
                className="p-2 border border-[#333] text-[#444] hover:text-red-500 hover:border-red-500 transition-all text-xs"
                title="Delete Job"
              >
                <Icon icon="mdi:delete-outline" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 bg-black gap-[1px] relative">
        {/* Original */}
        <div className="relative aspect-[3/4] bg-[#080808] overflow-hidden flex items-center justify-center">
          <div className="absolute top-4 left-4 z-10 px-2 py-1 bg-black/80 backdrop-blur-md border border-[#333] text-[9px] font-mono uppercase tracking-[0.2em] text-[#888]">
            Raw Input
          </div>
          <img
            src={item.originalUrl || item.result_url || item.inpainted_url || ""}
            alt="Original"
            className="w-full h-full object-contain filter grayscale-[0.5]"
          />
        </div>

        {/* AI Results Layer */}
        <div className="relative aspect-[3/4] bg-[#080808] overflow-hidden transition-colors font-mono">
          <div className="absolute top-4 left-4 z-10 px-2 py-1 bg-cyan-500/20 backdrop-blur-md border border-cyan-500/30 text-[9px] font-mono uppercase tracking-[0.2em] text-cyan-500">
            Pipeline Result
          </div>

          <AnimatePresence mode="wait">
            {hasError ? (
              <motion.div
                key="ai-error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 p-8 flex flex-col justify-center gap-4 bg-[#0a0a0a]"
              >
                <div className="flex items-center gap-3 text-red-500">
                  <Icon icon="mdi:alert-octagon-outline" className="text-3xl" />
                  <span className="text-[10px] uppercase tracking-[0.3em] font-black">
                    Job Stopped
                  </span>
                </div>
                <p className="text-sm text-red-100 font-sans leading-relaxed p-4 bg-red-500/10 border border-red-500/30">
                  {statusMessage}
                </p>
              </motion.div>
            ) : item.status === "awaiting_review" ? (
              <motion.div
                key="ai-review-gate"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 p-8 flex flex-col justify-center items-center gap-6 bg-[#0a0a0a] border border-cyan-500/20 text-center"
              >
                <div className="flex flex-col items-center gap-3 text-cyan-500">
                  <Icon
                    icon="mdi:shield-lock-outline"
                    className="text-5xl animate-pulse shadow-[0_0_20px_rgba(6,182,212,0.2)]"
                  />
                  <span className="text-[9px] uppercase tracking-[0.4em] font-black">
                    Human Verification Gate
                  </span>
                </div>
                <div className="space-y-2 max-w-xs">
                  <h4 className="text-xs font-bold uppercase tracking-tight">
                    AI Draft Complete
                  </h4>
                  <p className="text-[10px] text-[#666] font-mono leading-relaxed uppercase tracking-tighter">
                    Linguistic translation engine awaits manual review and
                    approval prior to typesetting and premium rendering.
                  </p>
                </div>
                <button
                  onClick={() => setIsEditorOpen(true)}
                  className="px-5 py-2 bg-cyan-500 hover:bg-cyan-400 text-black font-bold uppercase tracking-widest text-[10px] font-mono transition-all duration-300 shadow-lg shadow-cyan-500/20 flex items-center gap-2 hover:scale-[1.02] cursor-pointer"
                >
                  <Icon icon="mdi:translate" className="text-xs" />
                  Enter Translation Studio
                </button>
              </motion.div>
            ) : showText || ACTIVE_IMAGE_STATUSES.includes(item.status) ? (
              <motion.div
                key="ai-text"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 p-8 flex flex-col gap-6 overflow-y-auto bg-[#0a0a0a]"
              >
                <div className="space-y-2">
                  <span className="text-[9px] uppercase tracking-widest text-[#444] block">
                    Extracted Text (GLM-OCR)
                  </span>
                  <p className="text-xs text-[#888] font-sans leading-relaxed min-h-[50px] p-3 bg-[#111] border border-[#222]">
                    {item.ocr_text ||
                      (["segmenting", "ocr"].includes(item.status)
                        ? "Processing OCR..."
                        : "Awaiting data...")}
                  </p>
                </div>
                <div className="space-y-2">
                  <span className="text-[9px] uppercase tracking-widest text-cyan-500 block">
                    Translated Text (Thai Storytelling)
                  </span>
                  <p className="text-sm text-cyan-100 font-sans leading-relaxed min-h-[100px] p-3 bg-cyan-950/20 border border-cyan-500/20 shadow-inner">
                    {item.translated_text ||
                      (item.status === "translating"
                        ? "Translating to Thai (Vibe Check)..."
                        : "Awaiting data...")}
                  </p>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="ai-image"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full h-full flex items-center justify-center relative p-1"
              >
                {item.status === "completed" ? (
                  <img
                    key={activeImage}
                    src={activeImage || item.originalUrl}
                    alt={activeLabel}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <Icon
                      icon="eos-icons:bubble-loading"
                      className="text-4xl text-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.3)]"
                    />
                    <div>
                      <span className="text-[10px] text-[#888] uppercase tracking-[0.4em] block mb-2">
                        {item.status}...
                      </span>
                      <span className="text-[10px] text-[#444] font-mono tracking-widest">
                        {statusMessage}
                      </span>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Progress & Error */}
      <div className="relative">
        <div className="h-1 bg-[#1a1a1a]">
          <motion.div
            className={cn(
              "h-full shadow-[0_0_15px_rgba(6,182,212,0.8)]",
              hasError ? "bg-red-500" : "bg-cyan-500",
            )}
            initial={{ width: 0 }}
            animate={{ width: `${item.progress}%` }}
            transition={{ type: "spring", stiffness: 100, damping: 20 }}
          />
        </div>
        {(item.error || item.message) && (
          <div
            className={cn(
              "px-4 py-2 border-t text-[10px] font-mono uppercase tracking-widest",
              hasError
                ? "bg-red-500/10 border-red-500/20 text-red-500"
                : "bg-[#111] border-[#222] text-[#888]",
            )}
          >
            {hasError ? "Critical Error: " : "Job Status: "}
            {statusMessage}
          </div>
        )}
      </div>

      {isEditorOpen && (
        <TranslationEditor
          item={item}
          onClose={() => setIsEditorOpen(false)}
          onUpdate={onUpdate}
        />
      )}
    </motion.article>
  );
};

// Helper utility for class names within the component file
function cn(...inputs: (string | boolean | undefined)[]) {
  return inputs.filter(Boolean).join(" ");
}
