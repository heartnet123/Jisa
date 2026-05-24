import React, { useState, useEffect } from 'react';
import { Icon } from '@iconify-icon/react';
import { motion, AnimatePresence } from 'framer-motion';
import type { BlockItem, ProcessedManga } from '../types';
import { mangaApi } from '../api/mangaApi';
import { ThaiText } from './ThaiText';

interface TranslationEditorProps {
  item: ProcessedManga;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<ProcessedManga>) => void;
}

export const TranslationEditor: React.FC<TranslationEditorProps> = ({
  item,
  onClose,
  onUpdate,
}) => {
  const [blocks, setBlocks] = useState<BlockItem[]>(item.blocks || []);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [editedTranslations, setEditedTranslations] = useState<Record<string, string>>({});
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    // If blocks are already in the item, use them
    if (item.blocks && item.blocks.length > 0) {
      setBlocks(item.blocks);
      const initialEdits: Record<string, string> = {};
      item.blocks.forEach(b => {
        initialEdits[b.id] = b.translated_text || '';
      });
      setEditedTranslations(initialEdits);
    }
  }, [item.blocks]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setNaturalSize({ w: naturalWidth, h: naturalHeight });
  };

  const handleTranslationChange = (blockId: string, val: string) => {
    setEditedTranslations(prev => ({
      ...prev,
      [blockId]: val,
    }));
  };

  const handleApprove = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await mangaApi.approveTranslation(item.id, editedTranslations);
      onUpdate(item.id, {
        status: 'inpainting',
        progress: 60,
        message: 'Review approved. Inpainting in progress...',
        blocks: blocks.map(b => ({
          ...b,
          translated_text: editedTranslations[b.id],
        })),
      });
      onClose();
    } catch (err) {
      console.error('Failed to approve translation:', err);
      setSubmitError(err instanceof Error ? err.message : 'Failed to approve translation');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#060606]/95 backdrop-blur-md flex flex-col font-sans selection:bg-cyan-500/30 overflow-hidden">
      {/* Top Header Bar */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#222] bg-[#0c0c0c] z-10">
        <div className="flex items-center gap-3">
          <Icon icon="mdi:translate" className="text-xl text-cyan-500" />
          <h2 className="text-lg font-bold tracking-tight uppercase font-mono">
            Translation Studio <span className="text-[#555]">//</span> HITL Review
          </h2>
          <span className="text-[10px] font-mono bg-cyan-950 text-cyan-400 border border-cyan-800/50 px-2 py-0.5 rounded">
            {item.filename}
          </span>
        </div>

        <button
          onClick={onClose}
          className="p-2 border border-[#333] hover:border-red-500 hover:text-red-500 hover:bg-red-500/5 transition-all text-sm rounded font-mono uppercase tracking-widest flex items-center gap-1.5"
        >
          <Icon icon="mdi:close" />
          Exit
        </button>
      </header>

      {/* Main Content Workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Side: Visual Layout Preview */}
        <div className="flex-1 bg-[#090909] p-6 flex items-center justify-center relative overflow-hidden">
          <div className="relative max-w-full max-h-full aspect-[3/4] bg-black border border-[#222] overflow-hidden flex items-center justify-center">
            <img
              src={item.originalUrl}
              alt="Manga Page Visual Context"
              onLoad={handleImageLoad}
              className="max-w-full max-h-full object-contain pointer-events-none select-none filter grayscale-[0.3]"
            />

            {naturalSize.w > 0 && (
              <svg
                viewBox={`0 0 ${naturalSize.w} ${naturalSize.h}`}
                className="absolute inset-0 w-full h-full pointer-events-auto"
              >
                {blocks.map(b => (
                  <g key={b.id}>
                    <rect
                      x={b.box[0]}
                      y={b.box[1]}
                      width={b.box[2]}
                      height={b.box[3]}
                      className={`fill-cyan-500/5 stroke-2 cursor-pointer transition-all duration-300 hover:fill-cyan-500/20 ${
                        selectedBlockId === b.id
                          ? 'stroke-yellow-400 fill-cyan-500/10 stroke-[3px]'
                          : 'stroke-cyan-500'
                      }`}
                      onClick={() => {
                        setSelectedBlockId(b.id);
                        const el = document.getElementById(`segment-${b.id}`);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                    />
                    <text
                      x={b.box[0] + 5}
                      y={b.box[1] + 15}
                      className="fill-black bg-cyan-400 px-1 font-mono text-[8px] font-bold select-none pointer-events-none"
                    >
                      {blocks.indexOf(b) + 1}
                    </text>
                  </g>
                ))}
              </svg>
            )}
          </div>
        </div>

        {/* Right Side: Translation Segments Editor */}
        <div className="w-[480px] border-l border-[#222] bg-[#0c0c0c] flex flex-col overflow-hidden">
          <div className="p-4 border-b border-[#222] bg-[#0e0e0e] flex items-center justify-between">
            <span className="font-mono text-xs text-[#666] uppercase tracking-widest font-bold">
              Segments & Tone Gates
            </span>
            <span className="text-[10px] font-mono text-cyan-500 uppercase tracking-widest">
              {blocks.length} Bubbles Detected
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <AnimatePresence>
              {blocks.map((b, idx) => {
                const isSelected = selectedBlockId === b.id;
                const value = editedTranslations[b.id] ?? '';

                return (
                  <motion.div
                    key={b.id}
                    id={`segment-${b.id}`}
                    onClick={() => setSelectedBlockId(b.id)}
                    className={`p-4 border transition-all duration-300 ${
                      isSelected
                        ? 'bg-[#151b22] border-cyan-500/60 shadow-lg shadow-cyan-500/5'
                        : 'bg-[#0d0d0d] border-[#222] hover:border-[#333]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-[10px] font-bold text-cyan-500 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                        Bubble #{idx + 1}
                      </span>
                      {value.trim().length === 0 && (
                        <span className="text-[9px] font-mono text-yellow-500 uppercase flex items-center gap-1">
                          <Icon icon="mdi:alert-outline" /> Empty Draft
                        </span>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div>
                        <span className="text-[9px] font-mono text-[#555] uppercase tracking-widest block mb-1">
                          Source Segment (Original OCR)
                        </span>
                        <p className="text-xs text-[#888] bg-black/40 border border-[#222] p-2 leading-relaxed whitespace-pre-wrap select-all font-mono font-medium">
                          {b.text || 'No text extracted.'}
                        </p>
                      </div>

                      <div>
                        <span className="text-[9px] font-mono text-cyan-500/70 uppercase tracking-widest block mb-1">
                          Localized Segment (Thai Storytelling)
                        </span>
                        <textarea
                          value={value}
                          onChange={e => handleTranslationChange(b.id, e.target.value)}
                          placeholder="พิมพ์คำแปลภาษาไทย..."
                          className="w-full text-sm text-cyan-50 bg-[#121212] border border-[#333] hover:border-[#444] focus:border-cyan-500 focus:outline-none p-3 h-24 resize-none leading-relaxed transition-colors font-sans"
                          style={{
                            fontFamily: "'Sarabun', 'Segoe UI', Tahoma, sans-serif",
                          }}
                        />
                      </div>

                      {/* Thai Rendering Preview Gate */}
                      {value.trim().length > 0 && (
                        <div className="p-3 bg-cyan-950/10 border border-cyan-500/10 rounded">
                          <span className="text-[9px] font-mono text-cyan-500/40 uppercase tracking-widest block mb-1">
                            Premium Font Stack Preview
                          </span>
                          <div className="p-1">
                            <ThaiText className="text-cyan-400 text-sm">{value}</ThaiText>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* Action Footer Gate */}
          <div className="p-4 border-t border-[#222] bg-[#0d0d0d] space-y-4">
            {submitError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                <Icon icon="mdi:alert" className="text-base" />
                <span>{submitError}</span>
              </div>
            )}

            <button
              onClick={handleApprove}
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 py-3 bg-cyan-500 hover:bg-cyan-400 disabled:bg-[#222] text-black font-bold uppercase tracking-widest font-mono transition-colors shadow-lg shadow-cyan-500/20 disabled:shadow-none"
            >
              {isSubmitting ? (
                <>
                  <Icon icon="eos-icons:loading" className="text-lg" />
                  Generating Localized Publication...
                </>
              ) : (
                <>
                  <Icon icon="mdi:check-decagram" className="text-lg" />
                  Approve & Render Publication
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
