'use client';

import React, { useState, useCallback } from 'react';
import { Icon } from '@iconify-icon/react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { mangaApi } from '../api/mangaApi';
import type { ProcessedManga, TranslationConfig } from '../types';
import { MangaFileItem } from './MangaFileItem';

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/tiff'];

/**
 * Utility for Tailwind class merging
 */
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const MangaTranslator: React.FC = () => {
  const [files, setFiles] = useState<ProcessedManga[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [config, setConfig] = useState<TranslationConfig>({
    provider: 'ollama',
    model: 'llama3:latest',
    systemPrompt: 'Translate this Japanese manga text to English while maintaining the original tone and context.',
  });

  const uploadBatch = useCallback(async (fileList: File[]) => {
    setIsUploading(true);

    const uploads = fileList.map(async (file) => {
      const localUrl = URL.createObjectURL(file);
      const pendingJobId = `${file.name}-${Date.now()}`;

      setFiles(prev => [
        {
          id: pendingJobId,
          filename: file.name,
          originalUrl: localUrl,
          original_url: localUrl,
          status: 'uploading',
          progress: 1,
          message: 'Uploading image.',
        },
        ...prev,
      ]);

      try {
        const response = await mangaApi.upload(file, config);
        const newManga: ProcessedManga = {
          id: response.id,
          filename: file.name,
          originalUrl: localUrl,
          original_url: localUrl,
          status: 'queued',
          progress: 5,
          message: 'Queued for translation.',
        };

        setFiles(prev => prev.map(f => f.id === pendingJobId ? newManga : f));
      } catch (err) {
        console.error('Upload failed for', file.name, err);
        setFiles(prev => prev.map(f =>
          f.id === pendingJobId
            ? {
                ...f,
                status: 'failed',
                progress: 0,
                error: err instanceof Error ? err.message : 'Upload failed',
              }
            : f,
        ));
      }
    });

    await Promise.all(uploads);
    setIsUploading(false);
  }, [config]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter(file =>
      ALLOWED_IMAGE_TYPES.includes(file.type),
    );
    uploadBatch(droppedFiles);
  }, [uploadBatch]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleUpdate = useCallback((id: string, updates: Partial<ProcessedManga>) => {
    setFiles(prev =>
      prev.map(f => {
        if (f.id !== id) return f;
        const status = updates.status ?? f.status;
        return {
          ...f,
          ...updates,
          status,
          originalUrl: updates.originalUrl ?? updates.original_url ?? f.originalUrl,
          original_url: updates.original_url ?? updates.originalUrl ?? f.original_url,
        };
      }),
    );
  }, []);

  const handleRemove = useCallback((id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] font-sans p-6 lg:p-12 selection:bg-cyan-500/30">
      <header className="max-w-7xl mx-auto mb-12 flex justify-between items-end border-b border-[#222] pb-8">
        <div>
          <h1 className="text-4xl font-black tracking-tighter uppercase italic flex items-center gap-3">
            <Icon icon="mdi:translate-variant" className="text-cyan-500" />
            AI Manga Translator
          </h1>
          <p className="text-[#888] font-mono text-sm mt-2 uppercase tracking-widest">
            Experimental // Local-First // RTX-Accelerated
          </p>
        </div>
        
        <div className="flex gap-4">
          <div className="flex flex-col items-end gap-1">
             <span className="text-[10px] font-mono text-cyan-500 uppercase tracking-widest">Target Model: {config.model}</span>
             <button className="flex items-center gap-2 px-4 py-2 border border-[#333] bg-[#111] hover:bg-[#1a1a1a] transition-all text-xs uppercase tracking-widest font-mono group">
               <Icon icon="mdi:cog" className="group-hover:rotate-180 transition-transform duration-500" />
               Configuration
             </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto space-y-12">
        {/* Upload Zone */}
        <section
          onDrop={onDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = ALLOWED_IMAGE_TYPES.join(',');
            input.onchange = (e) => {
              const fileList = Array.from((e.target as HTMLInputElement).files || []);
              uploadBatch(fileList);
            };
            input.click();
          }}
          className={cn(
            "relative group cursor-pointer border-2 border-dashed transition-all duration-500 flex flex-col items-center justify-center p-16",
            isDragging ? "border-cyan-500 bg-cyan-500/5" : "border-[#333] hover:border-[#444] bg-[#0d0d0d]",
            isUploading && "animate-pulse cursor-wait"
          )}
        >
          <div className="absolute inset-0 opacity-0 group-hover:opacity-10 dark:opacity-[0.02] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-cyan-500 via-transparent to-transparent" />
          
          <div className="relative z-10 text-center">
            <Icon 
              icon={isUploading ? "eos-icons:loading" : "mdi:cloud-upload-outline"}
              className={cn("text-5xl mb-6 transition-transform duration-500", isDragging && "scale-110 text-cyan-500")}
            />
            <h3 className="text-xl font-bold uppercase tracking-tight mb-2">
              {isUploading ? "Uploading Batch..." : "Drop manga files here"}
            </h3>
            <p className="text-[#666] font-mono text-xs uppercase tracking-tighter">Support: JPG // PNG // WEBP // Multiple Selection</p>
          </div>
        </section>

        {/* Processed Grid */}
        <div className="grid grid-cols-1 gap-12">
          <AnimatePresence initial={false}>
            {files.map((file) => (
              <MangaFileItem 
                key={file.id} 
                item={file} 
                onUpdate={handleUpdate} 
                onRemove={handleRemove} 
              />
            ))}
          </AnimatePresence>
        </div>
      </main>

      <footer className="max-w-7xl mx-auto mt-24 pt-12 border-t border-[#222] text-center">
        <p className="text-[#333] font-mono text-[10px] uppercase tracking-[0.3em] flex items-center justify-center gap-4">
          <span className="flex items-center gap-1"><Icon icon="logos:nextjs-icon" /> Next.js 16</span>
          <span className="flex items-center gap-1"><Icon icon="logos:fastapi" /> FastAPI</span>
          <span className="flex items-center gap-1 text-cyan-500"><Icon icon="mdi:nvidia" /> RTX 4060 Ready</span>
        </p>
      </footer>
    </div>
  );
};

export default MangaTranslator;
