import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@iconify-icon/react';
import { AnimatePresence } from 'framer-motion';
import type {
  BlockItem,
  ProcessedManga,
  TypesettingOptionsResponse,
  TypesettingSettings,
  TypesetPreviewBounds,
} from '../types';
import { mangaApi } from '../api/mangaApi';
import { RegionCanvas, type MaskPreviewState } from './RegionCanvas';
import { RegionInspectorCard } from './RegionInspectorCard';

interface TranslationEditorProps {
  item: ProcessedManga;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<ProcessedManga>) => void;
}

type RegionAction = 'save' | 'ocr' | 'delete';

const defaultTypesetting = (ts?: TypesettingSettings): TypesettingSettings => ({
  font_name: ts?.font_name ?? null,
  font_size: ts?.font_size ?? null,
  auto_fit: ts?.auto_fit ?? true,
  text_align: ts?.text_align ?? 'center',
  padding_ratio: ts?.padding_ratio ?? 0.10,
});

function initialTextMap(
  blocks: BlockItem[] | undefined,
  field: 'text' | 'translated_text',
): Record<string, string> {
  return Object.fromEntries(
    (blocks ?? []).map(block => [block.id, block[field] ?? '']),
  );
}

function initialTypesettingMap(
  blocks: BlockItem[] | undefined,
): Record<string, TypesettingSettings> {
  return Object.fromEntries(
    (blocks ?? []).map(block => [block.id, defaultTypesetting(block.typesetting)]),
  );
}

function withoutId(values: Set<string>, ids: string | string[]): Set<string> {
  const next = new Set(values);
  const toDelete = Array.isArray(ids) ? ids : [ids];
  toDelete.forEach(id => next.delete(id));
  return next;
}

export const TranslationEditor: React.FC<TranslationEditorProps> = ({
  item,
  onClose,
  onUpdate,
}) => {
  const [blocks, setBlocks] = useState<BlockItem[]>(() => item.blocks || []);
  const savedBlocksRef = useRef(blocks);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [editedSources, setEditedSources] = useState<Record<string, string>>(() =>
    initialTextMap(item.blocks, 'text'),
  );
  const [editedTranslations, setEditedTranslations] = useState<Record<string, string>>(
    () => initialTextMap(item.blocks, 'translated_text'),
  );
  const [editedTypesetting, setEditedTypesetting] = useState<Record<string, TypesettingSettings>>(
    () => initialTypesettingMap(item.blocks),
  );
  const [dirtySourceIds, setDirtySourceIds] = useState<Set<string>>(() => new Set());
  const [dirtyTranslationIds, setDirtyTranslationIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [dirtyTypesettingIds, setDirtyTypesettingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [typesettingOptions, setTypesettingOptions] = useState<TypesettingOptionsResponse | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, {
    base64?: string;
    bounds?: TypesetPreviewBounds;
    lines?: string[];
    resolved_font_size?: number;
    auto_shrunk?: boolean;
    overflow?: boolean;
    truncated?: boolean;
    loading?: boolean;
    error?: string | null;
  }>>({});
  const clientRevisionsRef = useRef<Record<string, number>>({});

  const [isSavingRegions, setIsSavingRegions] = useState(false);
  const [activeRegionAction, setActiveRegionAction] = useState<{
    blockId: string;
    action: RegionAction;
  } | null>(null);
  const [regionError, setRegionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [maskPreviewUrl, setMaskPreviewUrl] = useState<string | undefined>(
    item.mask_preview_url,
  );
  const [maskPreviewState, setMaskPreviewState] = useState<MaskPreviewState>(
    item.mask_preview_url ? 'ready' : 'idle',
  );
  const [showMaskPreview, setShowMaskPreview] = useState(Boolean(item.mask_preview_url));

  const [typesettingOptionsError, setTypesettingOptionsError] = useState<string | null>(null);

  useEffect(() => {
    mangaApi.getTypesettingOptions()
      .then(opts => {
        setTypesettingOptions(opts);
        setTypesettingOptionsError(null);
      })
      .catch(err => {
        console.error('Failed to load typesetting options:', err);
        setTypesettingOptionsError(err instanceof Error ? err.message : 'Failed to load typesetting options');
      });
  }, []);

  const selectedBlock = selectedBlockId ? blocks.find(b => b.id === selectedBlockId) : null;
  const selectedTranslation = selectedBlockId ? editedTranslations[selectedBlockId] : undefined;
  const selectedTypesetting = selectedBlockId ? editedTypesetting[selectedBlockId] : undefined;

  useEffect(() => {
    if (!selectedBlockId || !selectedBlock) return;
    const blockId = selectedBlockId;

    const rev = (clientRevisionsRef.current[blockId] ?? 0) + 1;
    clientRevisionsRef.current[blockId] = rev;

    setPreviewCache(prev => ({
      ...prev,
      [blockId]: {
        ...prev[blockId],
        loading: true,
        error: null,
      },
    }));

    const timer = setTimeout(async () => {
      try {
        const res = await mangaApi.generateTypesetPreview(item.id, blockId, {
          client_revision: rev,
          translated_text: editedTranslations[blockId] ?? '',
          typesetting: editedTypesetting[blockId] ?? defaultTypesetting(selectedBlock.typesetting),
        });

        if (clientRevisionsRef.current[blockId] === res.client_revision) {
          const currentTypesetting = editedTypesetting[blockId] ?? defaultTypesetting(selectedBlock.typesetting);
          if (
            currentTypesetting.auto_fit &&
            res.resolved_font_size !== undefined &&
            currentTypesetting.font_size !== res.resolved_font_size
          ) {
            setEditedTypesetting(previous => ({
              ...previous,
              [blockId]: {
                ...(previous[blockId] ?? currentTypesetting),
                font_size: res.resolved_font_size,
              },
            }));
          }

          setPreviewCache(prev => ({
            ...prev,
            [blockId]: {
              mimeType: res.mime_type,
              base64: res.overlay_base64,
              bounds: res.bounds_px,
              lines: res.lines,
              resolved_font_size: res.resolved_font_size,
              auto_shrunk: res.auto_shrunk,
              overflow: res.overflow,
              truncated: res.truncated,
              loading: false,
              error: null,
            },
          }));
        }
      } catch (err) {
        if (clientRevisionsRef.current[blockId] === rev) {
          setPreviewCache(prev => ({
            ...prev,
            [blockId]: {
              ...prev[blockId],
              loading: false,
              error: err instanceof Error ? err.message : 'Preview failed',
            },
          }));
        }
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [
    item.id,
    selectedBlockId,
    selectedTranslation,
    selectedTypesetting?.font_name,
    selectedTypesetting?.auto_fit,
    selectedTypesetting?.auto_fit ? undefined : selectedTypesetting?.font_size,
    selectedTypesetting?.text_align,
    selectedTypesetting?.padding_ratio,
    selectedBlock?.box.x,
    selectedBlock?.box.y,
    selectedBlock?.box.width,
    selectedBlock?.box.height,
  ]);

  const updateTextMapsForRegions = (regions: BlockItem[]) => {
    setEditedSources(previous =>
      Object.fromEntries(
        regions.map(block => [block.id, previous[block.id] ?? block.text ?? '']),
      ),
    );
    setEditedTranslations(previous =>
      Object.fromEntries(
        regions.map(block => [
          block.id,
          previous[block.id] ?? block.translated_text ?? '',
        ]),
      ),
    );
    setEditedTypesetting(previous =>
      Object.fromEntries(
        regions.map(block => [
          block.id,
          previous[block.id] ?? defaultTypesetting(block.typesetting),
        ]),
      ),
    );
  };

  const handleRegionCommit = async (nextBlocks: BlockItem[]): Promise<boolean> => {
    setIsSavingRegions(true);
    setRegionError(null);
    try {
      const saved = await mangaApi.replaceRegions(item.id, nextBlocks);
      savedBlocksRef.current = saved.regions;
      setBlocks(saved.regions);
      updateTextMapsForRegions(saved.regions);
      const savedIds = new Set(saved.regions.map(block => block.id));
      setDirtySourceIds(previous =>
        new Set([...previous].filter(blockId => savedIds.has(blockId))),
      );
      setDirtyTranslationIds(previous =>
        new Set([...previous].filter(blockId => savedIds.has(blockId))),
      );
      setDirtyTypesettingIds(previous =>
        new Set([...previous].filter(blockId => savedIds.has(blockId))),
      );
      onUpdate(item.id, {
        blocks: saved.regions,
        region_mode: saved.region_mode,
      });
      return true;
    } catch (err) {
      console.error('Failed to save regions:', err);
      setBlocks(savedBlocksRef.current);
      setRegionError(err instanceof Error ? err.message : 'Failed to save regions');
      return false;
    } finally {
      setIsSavingRegions(false);
    }
  };

  const handleCanvasCommit = async (nextBlocks: BlockItem[]) => {
    if (maskPreviewUrl || maskPreviewState === 'ready') {
      setMaskPreviewState('stale');
    }
    setShowMaskPreview(false);
    setMaskPreviewUrl(undefined);
    onUpdate(item.id, { mask_preview_url: undefined });
    return handleRegionCommit(nextBlocks);
  };

  const handleSelect = (blockId: string | null) => {
    setSelectedBlockId(blockId);
    if (blockId) {
      document.getElementById(`segment-${blockId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  };

  const handleSourceChange = (blockId: string, value: string) => {
    setEditedSources(previous => ({ ...previous, [blockId]: value }));
    setDirtySourceIds(previous => new Set(previous).add(blockId));
  };

  const handleTranslationChange = (blockId: string, value: string) => {
    setEditedTranslations(previous => ({ ...previous, [blockId]: value }));
    setDirtyTranslationIds(previous => new Set(previous).add(blockId));
  };

  const handleTypesettingChange = (blockId: string, settings: TypesettingSettings) => {
    setEditedTypesetting(previous => ({ ...previous, [blockId]: settings }));
    setDirtyTypesettingIds(previous => new Set(previous).add(blockId));
  };

  const persistDirtyBlocks = async (onlyIds?: string[]) => {
    const requestedIds = onlyIds
      ? new Set(onlyIds)
      : new Set([...dirtySourceIds, ...dirtyTranslationIds, ...dirtyTypesettingIds]);
    const ids = blocks
      .map(block => block.id)
      .filter(id => requestedIds.has(id));

    if (ids.length === 0) {
      return { blocks, translations: editedTranslations };
    }

    const updates = await Promise.all(
      ids.map(async blockId => {
        const patch: {
          text?: string;
          translated_text?: string;
          typesetting?: TypesettingSettings;
        } = {};
        if (dirtySourceIds.has(blockId)) patch.text = editedSources[blockId] ?? '';
        if (dirtyTranslationIds.has(blockId)) {
          patch.translated_text = editedTranslations[blockId] ?? '';
        }
        if (dirtyTypesettingIds.has(blockId)) {
          patch.typesetting = editedTypesetting[blockId];
        }
        return mangaApi.patchRegion(item.id, blockId, patch);
      }),
    );
    const updatedById = new Map(updates.map(block => [block.id, block]));
    const nextBlocks = blocks.map(block => updatedById.get(block.id) ?? block);
    const nextSources = { ...editedSources };
    const nextTranslations = { ...editedTranslations };
    const nextTypesetting = { ...editedTypesetting };
    for (const updated of updates) {
      nextSources[updated.id] = updated.text ?? '';
      nextTranslations[updated.id] = updated.translated_text ?? '';
      if (updated.typesetting) {
        nextTypesetting[updated.id] = defaultTypesetting(updated.typesetting);
      }
    }

    savedBlocksRef.current = nextBlocks;
    setBlocks(nextBlocks);
    setEditedSources(nextSources);
    setEditedTranslations(nextTranslations);
    setEditedTypesetting(nextTypesetting);
    setDirtySourceIds(previous => withoutId(previous, ids));
    setDirtyTranslationIds(previous => withoutId(previous, ids));
    setDirtyTypesettingIds(previous => withoutId(previous, ids));
    onUpdate(item.id, { blocks: nextBlocks });
    return { blocks: nextBlocks, translations: nextTranslations };
  };

  const handleSaveBlock = async (blockId: string) => {
    setActiveRegionAction({ blockId, action: 'save' });
    setRegionError(null);
    try {
      await persistDirtyBlocks([blockId]);
    } catch (err) {
      console.error('Failed to save region text:', err);
      setRegionError(err instanceof Error ? err.message : 'Failed to save region text');
    } finally {
      setActiveRegionAction(null);
    }
  };

  const handleRerunOcr = async (blockId: string) => {
    setActiveRegionAction({ blockId, action: 'ocr' });
    setRegionError(null);
    try {
      const updated = await mangaApi.rerunRegionOcr(item.id, blockId);
      const nextBlocks = blocks.map(block => (block.id === blockId ? updated : block));
      savedBlocksRef.current = nextBlocks;
      setBlocks(nextBlocks);
      setEditedSources(previous => ({
        ...previous,
        [blockId]: updated.text ?? '',
      }));
      setEditedTranslations(previous => ({
        ...previous,
        [blockId]: updated.translated_text ?? '',
      }));
      setDirtySourceIds(previous => withoutId(previous, blockId));
      setDirtyTranslationIds(previous => withoutId(previous, blockId));
      setDirtyTypesettingIds(previous => withoutId(previous, blockId));
      onUpdate(item.id, { blocks: nextBlocks });
    } catch (err) {
      console.error('Failed to rerun OCR:', err);
      setRegionError(err instanceof Error ? err.message : 'Failed to rerun OCR');
    } finally {
      setActiveRegionAction(null);
    }
  };

  const handleDeleteBlock = async (blockId: string) => {
    setActiveRegionAction({ blockId, action: 'delete' });
    const nextBlocks = blocks.filter(block => block.id !== blockId);
    setBlocks(nextBlocks);
    setSelectedBlockId(null);
    const saved = await handleCanvasCommit(nextBlocks);
    if (saved) {
      setEditedSources(previous => {
        const next = { ...previous };
        delete next[blockId];
        return next;
      });
      setEditedTranslations(previous => {
        const next = { ...previous };
        delete next[blockId];
        return next;
      });
      setEditedTypesetting(previous => {
        const next = { ...previous };
        delete next[blockId];
        return next;
      });
      setDirtySourceIds(previous => withoutId(previous, blockId));
      setDirtyTranslationIds(previous => withoutId(previous, blockId));
      setDirtyTypesettingIds(previous => withoutId(previous, blockId));
    }
    setActiveRegionAction(null);
  };

  const handleToggleMaskPreview = async () => {
    if (maskPreviewState === 'ready' && maskPreviewUrl) {
      setShowMaskPreview(current => !current);
      return;
    }

    setMaskPreviewState('loading');
    setRegionError(null);
    try {
      const preview = await mangaApi.generateMaskPreview(item.id);
      setMaskPreviewUrl(preview.url);
      setMaskPreviewState('ready');
      setShowMaskPreview(true);
      onUpdate(item.id, {
        mask_preview_url: preview.url,
        preview_revision: preview.revision,
      });
    } catch (err) {
      console.error('Failed to generate mask preview:', err);
      setMaskPreviewState('error');
      setShowMaskPreview(false);
      setRegionError(err instanceof Error ? err.message : 'Failed to generate mask preview');
    }
  };

  const handleApprove = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const persisted = await persistDirtyBlocks();
      await mangaApi.approveTranslation(item.id, persisted.translations);
      onUpdate(item.id, {
        status: 'inpainting',
        progress: 60,
        message: 'Review approved. Inpainting in progress...',
        blocks: persisted.blocks.map(block => ({
          ...block,
          translated_text: persisted.translations[block.id],
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

  const hasDirtyText = dirtySourceIds.size > 0 || dirtyTranslationIds.size > 0 || dirtyTypesettingIds.size > 0;
  const controlsDisabled = isSavingRegions || isSubmitting || activeRegionAction !== null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-app font-sans selection:bg-accent-surface">
      <header className="z-10 flex items-center justify-between gap-3 border-b border-border bg-surface px-3 py-3 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Icon icon="solar:translation-2-linear" className="text-xl text-accent" />
          <h2 className="hidden font-mono text-lg font-bold uppercase tracking-tight sm:block text-main">
            Translation Studio <span className="text-muted">{'//'}</span> HITL Review
          </h2>
          <span className="truncate rounded border border-accent/30 bg-accent-surface px-2 py-0.5 font-mono text-xs text-accent font-medium">
            {item.filename}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex min-h-11 items-center gap-1.5 rounded border border-border bg-surface px-3 py-2 font-mono text-xs font-bold uppercase tracking-widest text-main transition-colors hover:border-red-500 hover:bg-red-500/10 hover:text-red-500"
        >
          <Icon icon="solar:close-square-linear" />
          Exit
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="min-h-0 flex-1 overflow-hidden">
          <RegionCanvas
            imageUrl={item.originalUrl}
            blocks={blocks}
            selectedBlockId={selectedBlockId}
            previewOverlays={previewCache}
            disabled={controlsDisabled}
            maskPreviewUrl={maskPreviewUrl}
            maskPreviewState={maskPreviewState}
            showMaskPreview={showMaskPreview}
            onChange={setBlocks}
            onCommit={handleCanvasCommit}
            onSelect={handleSelect}
            onToggleMaskPreview={handleToggleMaskPreview}
          />
        </div>

        <aside className="flex h-[45%] w-full flex-col overflow-hidden border-t border-border bg-panel lg:h-auto lg:w-[480px] lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between border-b border-border bg-surface p-4">
            <span className="font-mono text-xs font-bold uppercase tracking-widest text-muted">
              Region inspector
            </span>
            <span className="font-mono text-xs uppercase tracking-widest text-accent font-bold">
              {isSavingRegions
                ? 'Saving layout…'
                : hasDirtyText
                  ? 'Unsaved text'
                  : `${blocks.length} Regions`}
            </span>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {blocks.length === 0 ? (
              <div role="status" className="border border-dashed border-border bg-surface p-6 text-center rounded">
                <Icon icon="solar:crop-minimalistic-linear" className="mb-2 text-2xl text-muted" />
                <p className="font-mono text-xs uppercase tracking-wider text-muted font-medium">
                  No text regions
                </p>
                <p className="mt-2 text-xs text-subtle">
                  Choose Add region, then drag over a speech bubble.
                </p>
              </div>
            ) : null}
            <AnimatePresence initial={false}>
              {blocks.map((block, index) => (
                <RegionInspectorCard
                  key={block.id}
                  block={block}
                  index={index}
                  selected={selectedBlockId === block.id}
                  sourceValue={editedSources[block.id] ?? ''}
                  translationValue={editedTranslations[block.id] ?? ''}
                  typesettingValue={editedTypesetting[block.id] ?? defaultTypesetting(block.typesetting)}
                  typesettingOptions={typesettingOptions}
                  previewStatus={previewCache[block.id]}
                  dirty={dirtySourceIds.has(block.id) || dirtyTranslationIds.has(block.id) || dirtyTypesettingIds.has(block.id)}
                  action={
                    activeRegionAction?.blockId === block.id
                      ? activeRegionAction.action
                      : null
                  }
                  disabled={controlsDisabled}
                  onDelete={handleDeleteBlock}
                  onRerunOcr={handleRerunOcr}
                  onSave={handleSaveBlock}
                  onSelect={handleSelect}
                  onSourceChange={handleSourceChange}
                  onTranslationChange={handleTranslationChange}
                  onTypesettingChange={handleTypesettingChange}
                />
              ))}
            </AnimatePresence>
          </div>

          <div className="space-y-3 border-t border-border bg-surface p-4">
            {submitError ? (
              <div role="alert" className="flex items-center gap-2 border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500 rounded">
                <Icon icon="solar:danger-triangle-linear" className="text-base" />
                <span>{submitError}</span>
              </div>
            ) : null}
            {regionError ? (
              <div role="alert" className="flex items-center gap-2 border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500 rounded">
                <Icon icon="solar:danger-triangle-linear" className="text-base" />
                <span>{regionError}</span>
              </div>
            ) : null}
            {typesettingOptionsError ? (
              <div role="alert" className="flex items-center gap-2 border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-500 rounded">
                <Icon icon="solar:danger-triangle-linear" className="text-base" />
                <span>{typesettingOptionsError}</span>
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleApprove}
              disabled={controlsDisabled}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded bg-accent py-3 font-mono text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-accent-hover disabled:bg-panel disabled:text-muted"
            >
              {isSubmitting ? (
                <>
                  <Icon icon="eos-icons:loading" className="text-lg" />
                  Saving and approving…
                </>
              ) : (
                <>
                  <Icon icon="solar:check-circle-linear" className="text-lg" />
                  ยืนยัน
                </>
              )}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
