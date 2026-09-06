"use client";

import React, { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Icon } from "@iconify-icon/react";
import { motion, AnimatePresence } from "framer-motion";
import { mangaApi } from "../api/mangaApi";
import type { MangaStatus, ProcessedManga } from "../types";

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
  const router = useRouter();
  const pathname = usePathname();
  const [showText, setShowText] = useState(false);
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
      className="group bg-panel border border-border overflow-hidden transition-all duration-300"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-surface">
        <div className="flex items-center gap-3">
          <Icon icon="solar:file-left-linear" className="text-muted" />
          <div className="flex flex-col">
            <span className="font-mono text-xs uppercase tracking-widest text-subtle font-medium">
              Source File
            </span>
            <span className="font-mono text-xs uppercase tracking-widest truncate max-w-[200px] font-bold text-main">
              {item.filename}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-6 mr-4">
            <div
              className={cn(
                "flex items-center gap-2 px-3 py-1 bg-panel rounded-full border border-border transition-all",
                item.status === "completed" &&
                  "border-green-500/50 bg-green-500/10 text-green-600 dark:text-green-400",
                item.status === "awaiting_review" &&
                  "border-yellow-500/50 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
                hasError && "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400",
                !["completed", "awaiting_review"].includes(item.status) && !hasError &&
                  "border-accent/50 bg-accent-surface text-accent",
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  item.status === "completed"
                    ? "bg-green-500"
                    : item.status === "awaiting_review"
                      ? "bg-yellow-500"
                      : hasError
                        ? "bg-red-500"
                        : "bg-accent",
                )}
              />
              <span className="text-xs font-bold uppercase tracking-wider">
                {item.status === "awaiting_review" ? "needs review" : item.status}
              </span>
            </div>
            <div className="flex gap-2">
              {item.status === "completed" && (
                <div className="flex bg-surface border border-border p-1 rounded">
                  <button
                    onClick={() => setDisplayMode("original")}
                    className={cn(
                      "px-2 py-1 text-xs font-mono transition-all font-medium",
                      displayMode === "original"
                        ? "bg-accent text-white"
                        : "text-muted hover:text-main",
                    )}
                  >
                    RAW
                  </button>
                  <button
                    onClick={() => setDisplayMode("inpainted")}
                    className={cn(
                      "px-2 py-1 text-xs font-mono border-x border-border transition-all font-medium",
                      displayMode === "inpainted"
                        ? "bg-accent text-white"
                        : "text-muted hover:text-main",
                    )}
                  >
                    CLEAN
                  </button>
                  <button
                    onClick={() => setDisplayMode("translated")}
                    className={cn(
                      "px-2 py-1 text-xs font-mono transition-all font-medium",
                      displayMode === "translated"
                        ? "bg-accent text-white"
                        : "text-muted hover:text-main",
                    )}
                  >
                    FINAL
                  </button>
                </div>
              )}
              {item.status === "awaiting_review" && (
                <button
                  onClick={() =>
                    router.push(`/editor/${item.id}?from=${encodeURIComponent(pathname)}`)
                  }
                  className="px-3 py-1.5 min-h-11 bg-accent hover:bg-accent-hover text-white transition-all text-xs font-mono font-bold uppercase tracking-widest flex items-center gap-1.5 rounded"
                >
                  <Icon icon="solar:translation-2-linear" />
                  REVIEW
                </button>
              )}
              <button
                onClick={() => setShowText(!showText)}
                className={cn(
                  "p-2.5 border border-border bg-surface hover:border-accent hover:text-accent transition-all text-xs rounded min-h-11 min-w-11 flex items-center justify-center",
                  showText && "text-accent border-accent bg-accent-surface",
                )}
                title="View AI Results"
              >
                <Icon icon="solar:document-text-linear" />
              </button>
              {item.status !== "completed" && !hasError && (
                <button
                  onClick={handleCancel}
                  className="p-2.5 border border-border bg-surface text-muted hover:text-yellow-600 hover:border-yellow-500 transition-all text-xs rounded min-h-11 min-w-11 flex items-center justify-center"
                  title="Cancel Job"
                >
                  <Icon icon="solar:stop-circle-linear" />
                </button>
              )}
              <button
                onClick={() => onRemove(item.id)}
                className="p-2.5 border border-border bg-surface text-muted hover:text-red-500 hover:border-red-500 transition-all text-xs rounded min-h-11 min-w-11 flex items-center justify-center"
                title="Delete Job"
              >
                <Icon icon="solar:trash-bin-trash-linear" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* AI Results Layer */}
      <div className="relative aspect-[3/4] bg-app overflow-hidden transition-colors font-mono">
        <AnimatePresence mode="wait">
            {hasError ? (
              <motion.div
                key="ai-error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 p-8 flex flex-col justify-center gap-4 bg-app"
              >
                <div className="flex items-center gap-3 text-red-500">
                  <Icon icon="solar:danger-triangle-linear" className="text-3xl" />
                  <span className="text-xs uppercase tracking-widest font-black">
                    Job Stopped
                  </span>
                </div>
                <p className="text-sm text-red-600 dark:text-red-300 font-sans leading-relaxed p-4 bg-red-500/10 border border-red-500/30 rounded">
                  {statusMessage}
                </p>
              </motion.div>
            ) : item.status === "awaiting_review" ? (
              <motion.div
                key="ai-review-gate"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 p-8 flex flex-col justify-center items-center gap-6 bg-app border border-accent/20 text-center"
              >
                <div className="flex flex-col items-center gap-3 text-accent">
                  <Icon
                    icon="solar:shield-warning-linear"
                    className="text-5xl"
                  />
                  <span className="text-xs uppercase tracking-widest font-black">
                    Human Verification Gate
                  </span>
                </div>
                <div className="space-y-2 max-w-xs">
                  <h4 className="text-sm font-bold uppercase tracking-tight text-main">
                    AI Draft Complete
                  </h4>
                  <p className="text-xs text-muted font-mono leading-relaxed uppercase tracking-tighter">
                    Linguistic translation engine awaits manual review and
                    approval prior to typesetting and premium rendering.
                  </p>
                </div>
                <button
                  onClick={() =>
                    router.push(`/editor/${item.id}?from=${encodeURIComponent(pathname)}`)
                  }
                  className="px-5 py-2.5 min-h-11 bg-accent hover:bg-accent-hover text-white font-bold uppercase tracking-widest text-xs font-mono transition-all duration-200 flex items-center gap-2 cursor-pointer rounded"
                >
                  <Icon icon="solar:translation-2-linear" className="text-sm" />
                  Enter Translation Studio
                </button>
              </motion.div>
            ) : showText || ACTIVE_IMAGE_STATUSES.includes(item.status) ? (
              <motion.div
                key="ai-text"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 p-8 flex flex-col gap-6 overflow-y-auto bg-app"
              >
                <div className="space-y-2">
                  <span className="text-xs uppercase tracking-widest text-muted block font-medium">
                    Extracted Text (GLM-OCR)
                  </span>
                  <p className="text-xs text-main font-sans leading-relaxed min-h-[50px] p-3 bg-surface border border-border rounded">
                    {item.ocr_text ||
                      (["segmenting", "ocr"].includes(item.status)
                        ? "Processing OCR..."
                        : "Awaiting data...")}
                  </p>
                </div>
                <div className="space-y-2">
                  <span className="text-xs uppercase tracking-widest text-accent block font-medium">
                    Translated Text (Thai Storytelling)
                  </span>
                  <p className="text-sm text-main font-sans leading-relaxed min-h-[100px] p-3 bg-accent-surface border border-accent/20 rounded">
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
                      className="text-4xl text-accent"
                    />
                    <div>
                      <span className="text-xs text-muted uppercase tracking-widest block mb-2 font-medium">
                        {item.status}...
                      </span>
                      <span className="text-xs text-subtle font-mono tracking-widest">
                        {statusMessage}
                      </span>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      {/* Progress */}
      <div className="relative">
        <div className="h-1 bg-border">
          <motion.div
            className={cn(
              "h-full",
              hasError ? "bg-red-500" : "bg-accent",
            )}
            initial={{ width: 0 }}
            animate={{ width: `${item.progress}%` }}
            transition={{ type: "spring", stiffness: 100, damping: 20 }}
          />
        </div>
      </div>
    </motion.article>
  );
};

// Helper utility for class names within the component file
function cn(...inputs: (string | boolean | undefined)[]) {
  return inputs.filter(Boolean).join(" ");
}
