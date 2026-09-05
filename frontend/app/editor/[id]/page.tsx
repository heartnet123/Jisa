'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@iconify-icon/react';
import { useMangaTranslator } from '@/features/manga-translator/context/MangaTranslatorContext';
import { mangaApi } from '@/features/manga-translator/api/mangaApi';
import { TranslationEditor } from '@/features/manga-translator/components/TranslationEditor';
import type { ProcessedManga, Project } from '@/features/manga-translator/types';

function EditorView() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const id = (params?.id as string) || '';
  const from = searchParams?.get('from') || '/projects';

  const { files, projects, handleUpdate } = useMangaTranslator();

  const contextItem = useMemo(() => files.find(f => f.id === id), [files, id]);
  const [fetchedItem, setFetchedItem] = useState<ProcessedManga | null>(null);
  const [loading, setLoading] = useState(!contextItem);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (contextItem) {
      setLoading(false);
      return;
    }

    if (!id) {
      setFetchError('Missing item identifier');
      setLoading(false);
      return;
    }

    let isSubscribed = true;
    setLoading(true);
    setFetchError(null);

    mangaApi.checkStatus(id)
      .then((data) => {
        if (!isSubscribed) return;
        setFetchedItem(data);
        setLoading(false);
      })
      .catch((err) => {
        if (!isSubscribed) return;
        console.error('Failed to load manga item:', err);
        setFetchError(err instanceof Error ? err.message : 'Item not found');
        setLoading(false);
      });

    return () => {
      isSubscribed = false;
    };
  }, [id, contextItem]);

  const activeItem = contextItem || fetchedItem;

  const project: Project | null = useMemo(() => {
    if (!activeItem?.project_id) return null;
    return projects.find(p => p.id === activeItem.project_id) || null;
  }, [activeItem?.project_id, projects]);

  const orderedPages: ProcessedManga[] = useMemo(() => {
    if (!activeItem) return [];
    if (!project) return [activeItem];

    const projectFiles = files.filter(f => f.project_id === project.id);
    if (projectFiles.length === 0) return [activeItem];

    if (project.page_order && project.page_order.length > 0) {
      const fileMap = new Map(projectFiles.map(f => [f.id, f]));
      const sorted: ProcessedManga[] = [];

      for (const pageId of project.page_order) {
        const f = fileMap.get(pageId);
        if (f) {
          sorted.push(f);
          fileMap.delete(pageId);
        }
      }
      for (const remaining of fileMap.values()) {
        sorted.push(remaining);
      }
      return sorted;
    }

    return [...projectFiles].sort((a, b) => (a.sequence_id ?? 0) - (b.sequence_id ?? 0));
  }, [activeItem, project, files]);

  const handleClose = () => {
    router.push(from);
  };

  const handleNavigatePage = (targetId: string) => {
    router.push(`/editor/${targetId}?from=${encodeURIComponent(from)}`);
  };

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-app font-mono text-sm text-muted">
        <Icon icon="eos-icons:loading" className="mr-3 text-2xl animate-spin text-accent" />
        <span>Loading translation studio…</span>
      </div>
    );
  }

  if (fetchError || !activeItem) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-app font-mono text-sm text-red-400 p-6 text-center">
        <Icon icon="solar:danger-triangle-linear" className="text-3xl text-red-500" />
        <span>{fetchError || 'Manga page not found'}</span>
        <button
          type="button"
          onClick={handleClose}
          className="rounded border border-border bg-panel px-4 py-2 text-xs uppercase text-main hover:border-accent transition-colors"
        >
          Return to Workspace
        </button>
      </div>
    );
  }

  return (
    <TranslationEditor
      item={activeItem}
      project={project}
      pages={orderedPages}
      onNavigatePage={handleNavigatePage}
      onClose={handleClose}
      onUpdate={handleUpdate}
    />
  );
}

export default function StandaloneEditorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-app font-mono text-sm text-muted">
          <Icon icon="eos-icons:loading" className="mr-3 text-2xl animate-spin text-accent" />
          <span>Initializing studio…</span>
        </div>
      }
    >
      <EditorView />
    </Suspense>
  );
}
