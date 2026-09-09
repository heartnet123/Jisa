import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@iconify-icon/react';
import { AnimatePresence } from 'framer-motion';
import type {
  BlockItem,
  ProcessedManga,
  Project,
  TypesettingOptionsResponse,
  TypesettingSettings,
  TypesetPreviewBounds,
} from '../types';
import { mangaApi } from '../api/mangaApi';
import { RegionCanvas, type MaskPreviewState } from './RegionCanvas';
import { RegionInspectorCard } from './RegionInspectorCard';

export function getPageWindow(curr: number, total: number): number[] {
  if (total <= 0) return [];
  const count = Math.min(5, total);
  const start = Math.max(1, Math.min(curr - 2, total - count + 1));
  const end = Math.min(total, start + count - 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

interface TranslationEditorProps {
  item: ProcessedManga;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<ProcessedManga>) => void;
  project?: Project | null;
  pages?: ProcessedManga[];
  onNavigatePage?: (targetId: string) => Promise<void> | void;
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

const AUTOSAVE_DEBOUNCE_MS = 700;

export const TranslationEditor: React.FC<TranslationEditorProps> = ({
  item,
  onClose,
  onUpdate,
  project,
  pages,
  onNavigatePage,
}) => {
  const [blocks, setBlocks] = useState<BlockItem[]>(() => item.blocks || []);
  const savedBlocksRef = useRef(blocks);
  const geometrySaveRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const geometryRevisionRef = useRef(0);
  const [savedLayoutRevision, setSavedLayoutRevision] = useState(0);
  const pageRef = useRef(item.id);
  pageRef.current = item.id;

  const waitForGeometry = async () => {
    let pending;
    do {
      pending = geometrySaveRef.current;
      if (!await pending) throw new Error('Layout save failed. Save layout before continuing.');
    } while (pending !== geometrySaveRef.current);
  };
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
  const [saveStatusMap, setSaveStatusMap] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const autoSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const savedTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const inFlightPromisesRef = useRef<Record<string, Promise<void>>>({});
  const needsResaveRef = useRef<Set<string>>(new Set());

  const dirtySourceIdsRef = useRef(dirtySourceIds);
  dirtySourceIdsRef.current = dirtySourceIds;
  const dirtyTranslationIdsRef = useRef(dirtyTranslationIds);
  dirtyTranslationIdsRef.current = dirtyTranslationIds;
  const dirtyTypesettingIdsRef = useRef(dirtyTypesettingIds);
  dirtyTypesettingIdsRef.current = dirtyTypesettingIds;
  const editedSourcesRef = useRef(editedSources);
  editedSourcesRef.current = editedSources;
  const editedTranslationsRef = useRef(editedTranslations);
  editedTranslationsRef.current = editedTranslations;
  const editedTypesettingRef = useRef(editedTypesetting);
  editedTypesettingRef.current = editedTypesetting;
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

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
  const maskRequestRef = useRef(0);

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

  const clearAllTimers = () => {
    Object.values(autoSaveTimersRef.current).forEach(clearTimeout);
    autoSaveTimersRef.current = {};
    Object.values(savedTimersRef.current).forEach(clearTimeout);
    savedTimersRef.current = {};
  };

  useEffect(() => {
    clearAllTimers();
    setSaveStatusMap({});
    setBlocks(item.blocks || []);
    savedBlocksRef.current = item.blocks || [];
    geometryRevisionRef.current += 1;
    geometrySaveRef.current = Promise.resolve(true);
    setIsSavingRegions(false);
    setSavedLayoutRevision(0);
    setSelectedBlockId(null);
    setEditedSources(initialTextMap(item.blocks, 'text'));
    setEditedTranslations(initialTextMap(item.blocks, 'translated_text'));
    setEditedTypesetting(initialTypesettingMap(item.blocks));
    setDirtySourceIds(new Set());
    setDirtyTranslationIds(new Set());
    setDirtyTypesettingIds(new Set());
    setPreviewCache({});
    setMaskPreviewUrl(item.mask_preview_url);
    setMaskPreviewState(item.mask_preview_url ? 'ready' : 'idle');
    setShowMaskPreview(Boolean(item.mask_preview_url));
    setSubmitError(null);
    setRegionError(null);
    return () => {
      maskRequestRef.current += 1;
      clearAllTimers();
    };
  }, [item.id]);

  const currentPageIndex = pages && pages.length > 0 ? pages.findIndex(p => p.id === item.id) : -1;
  const isSwitchingPageRef = useRef(false);
  const hasDirtyDrafts = () =>
    dirtySourceIdsRef.current.size > 0 ||
    dirtyTranslationIdsRef.current.size > 0 ||
    dirtyTypesettingIdsRef.current.size > 0;

  const handlePageChange = async (targetIndex: number) => {
    if (!pages || targetIndex < 0 || targetIndex >= pages.length || isSwitchingPageRef.current) return;
    const targetPage = pages[targetIndex];
    if (!targetPage || targetPage.id === item.id) return;

    isSwitchingPageRef.current = true;
    try {
      clearAllTimers();
      if (hasDirtyDrafts()) {
        await persistDirtyBlocks();
      }
      if (onNavigatePage) {
        await onNavigatePage(targetPage.id);
      }
    } catch (err) {
      console.error('Failed to auto-save before navigating:', err);
      setSubmitError(err instanceof Error ? err.message : 'Failed to switch page');
    } finally {
      isSwitchingPageRef.current = false;
    }
  };

  const selectedBlock = selectedBlockId ? blocks.find(b => b.id === selectedBlockId) : null;
  const selectedTranslation = selectedBlockId ? editedTranslations[selectedBlockId] : undefined;
  const selectedTypesetting = selectedBlockId ? editedTypesetting[selectedBlockId] : undefined;

  useEffect(() => {
    if (!selectedBlockId || !selectedBlock) return;
    const blockId = selectedBlockId;
    let canceled = false;

    const savedBlock = savedBlocksRef.current.find(b => b.id === blockId);
    const isUnsaved =
      !savedBlock ||
      savedBlock.box.x !== selectedBlock.box.x ||
      savedBlock.box.y !== selectedBlock.box.y ||
      savedBlock.box.width !== selectedBlock.box.width ||
      savedBlock.box.height !== selectedBlock.box.height;

    if (isUnsaved) {
      setPreviewCache(prev => ({
        ...prev,
        [blockId]: {
          loading: false,
          error: null,
        },
      }));
      return;
    }

    const rev = (clientRevisionsRef.current[blockId] ?? 0) + 1;
    clientRevisionsRef.current[blockId] = rev;

    setPreviewCache(prev => ({
      ...prev,
      [blockId]: {
        loading: true,
        error: null,
      },
    }));

    const timer = setTimeout(async () => {
      try {
        await waitForGeometry();
        if (canceled) return;
        const activeRevision = geometryRevisionRef.current;
        const res = await mangaApi.generateTypesetPreview(item.id, blockId, {
          client_revision: rev,
          translated_text: editedTranslations[blockId] ?? '',
          typesetting: editedTypesetting[blockId] ?? defaultTypesetting(selectedBlock.typesetting),
        });

        if (!canceled && geometryRevisionRef.current === activeRevision && clientRevisionsRef.current[blockId] === res.client_revision) {
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
        if (!canceled && clientRevisionsRef.current[blockId] === rev) {
          setPreviewCache(prev => ({
            ...prev,
            [blockId]: {
              loading: false,
              error: err instanceof Error ? err.message : 'Preview failed',
            },
          }));
        }
      }
    }, 250);

    return () => { canceled = true; clearTimeout(timer); };
  }, [
    item.id,
    savedLayoutRevision,
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

  const handleRegionCommit = (nextBlocks: BlockItem[]): Promise<boolean> => {
    const revision = ++geometryRevisionRef.current;
    const previousSave = geometrySaveRef.current;
    const jobId = item.id;
    setIsSavingRegions(true);
    setRegionError(null);
    let save!: Promise<boolean>;
    save = (async () => {
    try {
      await previousSave;
      const saved = await mangaApi.replaceRegions(jobId, nextBlocks);
      if (pageRef.current !== jobId) return true;
      savedBlocksRef.current = saved.regions;
      setSavedLayoutRevision(r => r + 1);
      if (revision !== geometryRevisionRef.current) return true;
      setBlocks(current => current === nextBlocks ? saved.regions : current);
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
      if (pageRef.current === jobId && revision === geometryRevisionRef.current) {
        setRegionError(err instanceof Error ? err.message : 'Failed to save regions');
      }
      return false;
    } finally {
      if (pageRef.current === jobId && geometrySaveRef.current === save) setIsSavingRegions(false);
    }
    })();
    geometrySaveRef.current = save;
    return save;
  };

  const invalidateMaskPreview = () => {
    maskRequestRef.current += 1;
    setMaskPreviewState('stale');
    setShowMaskPreview(false);
    setMaskPreviewUrl(undefined);
  };

  const handleCanvasCommit = async (nextBlocks: BlockItem[]) => {
    setPreviewCache({});
    invalidateMaskPreview();
    onUpdate(item.id, { mask_preview_url: undefined });
    return handleRegionCommit(nextBlocks);
  };

  const isBlockDirty = (blockId: string) =>
    dirtySourceIds.has(blockId) ||
    dirtyTranslationIds.has(blockId) ||
    dirtyTypesettingIds.has(blockId);

  const isBlockDirtyRef = (blockId: string) =>
    dirtySourceIdsRef.current.has(blockId) ||
    dirtyTranslationIdsRef.current.has(blockId) ||
    dirtyTypesettingIdsRef.current.has(blockId);

  const clearSavedTimer = (blockId: string) => {
    if (savedTimersRef.current[blockId]) {
      clearTimeout(savedTimersRef.current[blockId]);
      delete savedTimersRef.current[blockId];
    }
    setSaveStatusMap(prev => {
      if (prev[blockId] !== 'saved') return prev;
      const next = { ...prev };
      delete next[blockId];
      return next;
    });
  };

  const saveBlock = async (blockId: string, manual = false): Promise<void> => {
    if (autoSaveTimersRef.current[blockId]) {
      clearTimeout(autoSaveTimersRef.current[blockId]);
      delete autoSaveTimersRef.current[blockId];
    }
    if (!isBlockDirtyRef(blockId)) return;

    if (inFlightPromisesRef.current[blockId]) {
      if (manual) setActiveRegionAction({ blockId, action: 'save' });
      needsResaveRef.current.add(blockId);
      try {
        await inFlightPromisesRef.current[blockId];
      } finally {
        if (manual) setActiveRegionAction(null);
      }
      return;
    }

    if (manual) setActiveRegionAction({ blockId, action: 'save' });
    setSaveStatusMap(prev => ({ ...prev, [blockId]: 'saving' }));
    setRegionError(null);

    const promise = (async () => {
      try {
        await persistDirtyBlocks([blockId]);
        setSaveStatusMap(prev => ({ ...prev, [blockId]: 'saved' }));
        if (savedTimersRef.current[blockId]) clearTimeout(savedTimersRef.current[blockId]);
        savedTimersRef.current[blockId] = setTimeout(() => clearSavedTimer(blockId), 2000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to save region text';
        console.error('Save failed:', err);
        setRegionError(msg);
        setSaveStatusMap(prev => ({ ...prev, [blockId]: 'error' }));
      } finally {
        delete inFlightPromisesRef.current[blockId];
        if (manual) setActiveRegionAction(null);

        if (needsResaveRef.current.delete(blockId)) {
          void saveBlock(blockId, false);
        }
      }
    })();

    inFlightPromisesRef.current[blockId] = promise;
    await promise;
  };

  const scheduleAutoSave = (blockId: string) => {
    clearSavedTimer(blockId);
    setSaveStatusMap(prev => {
      if (prev[blockId] !== 'error') return prev;
      const next = { ...prev };
      delete next[blockId];
      return next;
    });

    if (autoSaveTimersRef.current[blockId]) {
      clearTimeout(autoSaveTimersRef.current[blockId]);
    }
    autoSaveTimersRef.current[blockId] = setTimeout(() => {
      delete autoSaveTimersRef.current[blockId];
      void saveBlock(blockId);
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  const handleSelect = (blockId: string | null) => {
    if (selectedBlockId && selectedBlockId !== blockId) {
      void saveBlock(selectedBlockId);
    }
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
    scheduleAutoSave(blockId);
  };

  const handleTranslationChange = (blockId: string, value: string) => {
    setEditedTranslations(previous => ({ ...previous, [blockId]: value }));
    setDirtyTranslationIds(previous => new Set(previous).add(blockId));
    scheduleAutoSave(blockId);
  };

  const handleTypesettingChange = (blockId: string, settings: TypesettingSettings) => {
    setEditedTypesetting(previous => ({ ...previous, [blockId]: settings }));
    setDirtyTypesettingIds(previous => new Set(previous).add(blockId));
    scheduleAutoSave(blockId);
  };

  const persistDirtyBlocks = async (onlyIds?: string[]) => {
    if (!onlyIds) {
      await Promise.all(Object.values(inFlightPromisesRef.current));
    }
    const requestedIds = onlyIds
      ? new Set(onlyIds)
      : new Set([
          ...dirtySourceIdsRef.current,
          ...dirtyTranslationIdsRef.current,
          ...dirtyTypesettingIdsRef.current,
        ]);
    const ids = blocksRef.current
      .map(block => block.id)
      .filter(id => requestedIds.has(id));

    if (ids.length === 0) {
      return { blocks: blocksRef.current, translations: editedTranslationsRef.current };
    }

    const patches = ids.map(blockId => {
      const patch: {
        text?: string;
        translated_text?: string;
        typesetting?: TypesettingSettings;
      } = {};
      const sourceDirty = dirtySourceIdsRef.current.has(blockId);
      const translationDirty = dirtyTranslationIdsRef.current.has(blockId);
      const typesettingDirty = dirtyTypesettingIdsRef.current.has(blockId);

      if (sourceDirty) patch.text = editedSourcesRef.current[blockId] ?? '';
      if (translationDirty) patch.translated_text = editedTranslationsRef.current[blockId] ?? '';
      if (typesettingDirty) patch.typesetting = editedTypesettingRef.current[blockId];

      return { blockId, patch, sourceDirty, translationDirty, typesettingDirty };
    });

    const updates = await Promise.all(
      patches.map(async ({ blockId, patch }) => mangaApi.patchRegion(item.id, blockId, patch)),
    );
    const updatedById = new Map(updates.map(block => [block.id, block]));
    const nextBlocks = blocksRef.current.map(block => updatedById.get(block.id) ?? block);

    savedBlocksRef.current = nextBlocks;
    setBlocks(nextBlocks);

    setEditedSources(prev => {
      const next = { ...prev };
      for (const p of patches) {
        if (p.sourceDirty && prev[p.blockId] === p.patch.text) {
          const updated = updatedById.get(p.blockId);
          if (updated) next[p.blockId] = updated.text ?? '';
        }
      }
      return next;
    });

    setEditedTranslations(prev => {
      const next = { ...prev };
      for (const p of patches) {
        if (p.translationDirty && prev[p.blockId] === p.patch.translated_text) {
          const updated = updatedById.get(p.blockId);
          if (updated) next[p.blockId] = updated.translated_text ?? '';
        }
      }
      return next;
    });

    setEditedTypesetting(prev => {
      const next = { ...prev };
      for (const p of patches) {
        if (
          p.typesettingDirty &&
          JSON.stringify(prev[p.blockId]) === JSON.stringify(p.patch.typesetting)
        ) {
          const updated = updatedById.get(p.blockId);
          if (updated?.typesetting) next[p.blockId] = defaultTypesetting(updated.typesetting);
        }
      }
      return next;
    });

    setDirtySourceIds(prev => {
      const next = new Set(prev);
      for (const p of patches) {
        if (p.sourceDirty && editedSourcesRef.current[p.blockId] === p.patch.text) {
          next.delete(p.blockId);
        }
      }
      return next;
    });

    setDirtyTranslationIds(prev => {
      const next = new Set(prev);
      for (const p of patches) {
        if (
          p.translationDirty &&
          editedTranslationsRef.current[p.blockId] === p.patch.translated_text
        ) {
          next.delete(p.blockId);
        }
      }
      return next;
    });

    setDirtyTypesettingIds(prev => {
      const next = new Set(prev);
      for (const p of patches) {
        if (
          p.typesettingDirty &&
          JSON.stringify(editedTypesettingRef.current[p.blockId]) ===
            JSON.stringify(p.patch.typesetting)
        ) {
          next.delete(p.blockId);
        }
      }
      return next;
    });

    onUpdate(item.id, { blocks: nextBlocks });
    return { blocks: nextBlocks, translations: editedTranslationsRef.current };
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

    const request = ++maskRequestRef.current;
    setMaskPreviewState('loading');
    setRegionError(null);
    try {
      await waitForGeometry();
      if (request !== maskRequestRef.current) return;
      const preview = await mangaApi.generateMaskPreview(item.id);
      if (request !== maskRequestRef.current) return;
      setMaskPreviewUrl(preview.url);
      setMaskPreviewState('ready');
      setShowMaskPreview(true);
      onUpdate(item.id, {
        mask_preview_url: preview.url,
        preview_revision: preview.revision,
      });
    } catch (err) {
      if (request !== maskRequestRef.current) return;
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
      clearAllTimers();
      await waitForGeometry();
      if (pageRef.current !== item.id) return;
      const persisted = await persistDirtyBlocks();
      await waitForGeometry();
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
      if (pages && currentPageIndex >= 0 && currentPageIndex < pages.length - 1 && onNavigatePage) {
        await onNavigatePage(pages[currentPageIndex + 1].id);
      } else {
        onClose();
      }
    } catch (err) {
      console.error('Failed to approve translation:', err);
      setSubmitError(err instanceof Error ? err.message : 'Failed to approve translation');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExit = async () => {
    clearAllTimers();
    if (hasDirtyDrafts()) {
      try {
        await persistDirtyBlocks();
      } catch (err) {
        console.error('Failed to auto-save on exit:', err);
      }
    }
    onClose();
  };

  const hasDirtyText = dirtySourceIds.size > 0 || dirtyTranslationIds.size > 0 || dirtyTypesettingIds.size > 0;
  const controlsDisabled = isSavingRegions || isSubmitting || activeRegionAction !== null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-app font-sans selection:bg-accent-surface">
      <header className="z-10 flex items-center justify-between border-b border-border bg-surface px-6 py-3">
        <h1 className="font-mono text-sm font-bold uppercase tracking-wider text-main">
          {project?.name ?? "Manga Project"}
        </h1>

        <button
          type="button"
          onClick={handleExit}
          className="rounded border border-border bg-panel px-3 py-1.5 font-mono text-xs font-bold uppercase text-main transition-colors hover:border-red-500 hover:bg-red-500/10 hover:text-red-500"
        >
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
            onChange={nextBlocks => {
              geometryRevisionRef.current += 1;
              setPreviewCache({});
              invalidateMaskPreview();
              setBlocks(nextBlocks);
            }}
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
                : Object.values(saveStatusMap).includes('saving')
                  ? 'Saving changes…'
                  : hasDirtyText
                    ? 'Unsaved text'
                    : Object.values(saveStatusMap).includes('saved')
                      ? 'All changes saved'
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
                  dirty={isBlockDirty(block.id)}
                  saveStatus={saveStatusMap[block.id] ?? (isBlockDirty(block.id) ? 'unsaved' : 'idle')}
                  action={
                    activeRegionAction?.blockId === block.id
                      ? activeRegionAction.action
                      : null
                  }
                  disabled={controlsDisabled}
                  onDelete={handleDeleteBlock}
                  onRerunOcr={handleRerunOcr}
                  onSave={blockId => void saveBlock(blockId, true)}
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

      {pages && pages.length > 0 && currentPageIndex >= 0 ? (
        <footer className="z-10 flex flex-wrap min-h-14 items-center justify-between gap-3 border-t border-border bg-surface px-4 py-2 sm:px-6">
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-muted uppercase font-bold">Jump to:</span>
            <select
              value={currentPageIndex >= 0 ? currentPageIndex : 0}
              onChange={(e) => handlePageChange(Number(e.target.value))}
              disabled={controlsDisabled}
              className="rounded border border-border bg-panel px-3 py-1.5 font-mono text-xs text-main focus:border-accent focus:outline-none"
            >
              {pages.map((p, idx) => (
                <option key={p.id} value={idx}>
                  Page {idx + 1}: {p.filename}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1 font-mono text-xs">
            <button
              type="button"
              disabled={controlsDisabled || currentPageIndex <= 0}
              onClick={() => handlePageChange(currentPageIndex - 1)}
              className="flex h-8 items-center gap-1 rounded border border-border bg-panel px-3 font-bold uppercase text-main disabled:opacity-30 hover:border-accent transition-colors"
            >
              &lt; Prev
            </button>

            {getPageWindow(currentPageIndex + 1, pages.length).map((pageNum) => (
              <button
                type="button"
                key={pageNum}
                disabled={controlsDisabled}
                onClick={() => handlePageChange(pageNum - 1)}
                className={`h-8 min-w-8 rounded border px-2.5 font-bold transition-colors ${
                  pageNum === currentPageIndex + 1
                    ? "border-accent bg-accent text-white"
                    : "border-border bg-panel text-muted hover:text-main"
                }`}
              >
                {pageNum}
              </button>
            ))}

            <button
              type="button"
              disabled={controlsDisabled || currentPageIndex >= pages.length - 1}
              onClick={() => handlePageChange(currentPageIndex + 1)}
              className="flex h-8 items-center gap-1 rounded border border-border bg-panel px-3 font-bold uppercase text-main disabled:opacity-30 hover:border-accent transition-colors"
            >
              Next &gt;
            </button>
          </div>

          <button
            type="button"
            onClick={handleApprove}
            disabled={controlsDisabled}
            className="flex min-h-9 items-center justify-center gap-1.5 rounded bg-accent px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-accent-hover disabled:bg-panel disabled:text-muted"
          >
            {isSubmitting ? (
              <>
                <Icon icon="eos-icons:loading" className="text-sm animate-spin" />
                <span>Approving…</span>
              </>
            ) : (
              <>
                <Icon icon="solar:check-circle-linear" className="text-sm" />
                <span>
                  {pages && currentPageIndex >= 0 && currentPageIndex < pages.length - 1
                    ? "Approve & Next"
                    : "Approve"}
                </span>
              </>
            )}
          </button>
        </footer>
      ) : null}
    </div>
  );
};
