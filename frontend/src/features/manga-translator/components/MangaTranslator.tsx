'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Icon } from '@iconify-icon/react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { mangaApi, API_BASE_URL } from '../api/mangaApi';
import type { ProcessedManga, TranslationConfig, Project } from '../types';
import { MangaFileItem } from './MangaFileItem';
import { TranslationEditor } from './TranslationEditor';
import { ThaiText } from './ThaiText';

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/tiff'];

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type TabType = 'overview' | 'archive' | 'config' | 'projects';

export const MangaTranslator: React.FC = () => {
  // Navigation & UI tabs
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  
  // Projects State
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  
  // Job Queue & uploads
  const [files, setFiles] = useState<ProcessedManga[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  // Translation Config State
  const [config, setConfig] = useState<TranslationConfig>({
    provider: 'openai',
    model: 'gpt-5.4-mini',
    systemPrompt: 'Translate this Japanese manga text to English while maintaining the original tone and context.',
  });

  // System Health States
  const [systemHealth, setSystemHealth] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  // Archive & Table Search/Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Inspector Modal
  const [inspectItem, setInspectItem] = useState<ProcessedManga | null>(null);
  const [inspectMode, setInspectMode] = useState<'translated' | 'inpainted' | 'original'>('translated');

  // Translation Sandbox
  const [sandboxText, setSandboxText] = useState('「お前はもう死んでいる。」');
  const [sandboxResult, setSandboxResult] = useState('');
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [sandboxTime, setSandboxTime] = useState<number | null>(null);

  // HITL Editor trigger from table
  const [activeHITLItem, setActiveHITLItem] = useState<ProcessedManga | null>(null);

  // Fetch all jobs and system health on mount
  const loadInitialData = useCallback(async () => {
    try {
      const allJobs = await mangaApi.listJobs();
      setFiles(allJobs);
    } catch (err) {
      console.error('Failed to load jobs list:', err);
    }

    try {
      const allProjects = await mangaApi.listProjects();
      setProjects(allProjects);
    } catch (err) {
      console.error('Failed to load projects list:', err);
    }
    
    try {
      setHealthLoading(true);
      const health = await mangaApi.getSystemHealth();
      setSystemHealth(health);
      if (health.translation) {
        setConfig(prev => ({
          ...prev,
          model: health.translation.model || prev.model,
        }));
      }
    } catch (err) {
      console.error('Failed to load system health:', err);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    // Open Server-Sent Events connection
    const eventSource = new EventSource(`${API_BASE_URL}/api/stream/events`);

    // Helper to resolve absolute URLs
    const resolveUrl = (url: string | undefined): string | undefined => {
      if (!url) return undefined;
      if (url.startsWith("/")) return `${API_BASE_URL}${url}`;
      return url;
    };

    // Listen to jobs updates
    eventSource.addEventListener('jobs', (event) => {
      try {
        const allJobs = JSON.parse(event.data) as ProcessedManga[];
        const resolvedJobs = allJobs.map((job) => ({
          ...job,
          originalUrl: resolveUrl(job.originalUrl) ?? resolveUrl((job as any).original_url) ?? "",
          result_url: resolveUrl(job.result_url),
          inpainted_url: resolveUrl(job.inpainted_url),
        }));

        setFiles(prev => {
          // Preserve local 'uploading' jobs that aren't on the server yet
          const uploadingJobs = prev.filter(f => f.status === 'uploading');
          return [...uploadingJobs, ...resolvedJobs];
        });
      } catch (err) {
        console.error('Error parsing jobs from SSE:', err);
      }
    });

    // Listen to system health updates
    eventSource.addEventListener('health', (event) => {
      try {
        const health = JSON.parse(event.data);
        setSystemHealth(health);
        setHealthLoading(false);
        if (health.translation) {
          setConfig(prev => ({
            ...prev,
            model: health.translation.model || prev.model,
          }));
        }
      } catch (err) {
        console.error('Error parsing health from SSE:', err);
      }
    });

    // Listen to projects updates
    eventSource.addEventListener('projects', (event) => {
      try {
        const allProjects = JSON.parse(event.data) as Project[];
        setProjects(allProjects);
      } catch (err) {
        console.error('Error parsing projects from SSE:', err);
      }
    });

    eventSource.onerror = (err) => {
      console.error('SSE Connection failed/reconnecting:', err);
      setHealthLoading(true);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const uploadBatch = useCallback(async (fileList: File[], projectId?: string) => {
    setIsUploading(true);

    const uploads = fileList.map(async (file) => {
      const localUrl = URL.createObjectURL(file);
      const pendingJobId = `${file.name}-${Date.now()}`;

      // Insert temporary upload block into local state
      const tempManga: ProcessedManga = {
        id: pendingJobId,
        filename: file.name,
        originalUrl: localUrl,
        original_url: localUrl,
        status: 'uploading',
        progress: 1,
        message: 'Uploading manga page...',
        project_id: projectId,
      };

      setFiles(prev => [tempManga, ...prev]);

      try {
        const response = await mangaApi.upload(file, config, projectId);
        const newManga: ProcessedManga = {
          id: response.id,
          filename: file.name,
          originalUrl: localUrl,
          original_url: localUrl,
          status: 'queued',
          progress: 5,
          message: 'Queued for processing.',
          project_id: projectId,
        };

        setFiles(prev => {
          if (prev.some(f => f.id === response.id)) {
            return prev.filter(f => f.id !== pendingJobId);
          }
          return prev.map(f => f.id === pendingJobId ? newManga : f);
        });
      } catch (err) {
        console.error('Upload failed for', file.name, err);
        setFiles(prev => prev.map(f =>
          f.id === pendingJobId
            ? {
                ...f,
                status: 'failed',
                progress: 0,
                error: err instanceof Error ? err.message : 'Upload failed',
                project_id: projectId,
              }
            : f,
        ));
      }
    });

    await Promise.all(uploads);
    setIsUploading(false);
    // Refresh health stats to capture new active counters
    try {
      const health = await mangaApi.getSystemHealth();
      setSystemHealth(health);
    } catch (e) {}
  }, [config]);

  // File drag handlers
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

  // Update item in files array
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

  // Delete item from backend and frontend list
  const handleRemove = useCallback(async (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this translation job and all generated images?')) {
      return;
    }
    try {
      await mangaApi.deleteJob(id);
      setFiles(prev => prev.filter(f => f.id !== id));
      // Refresh health stats
      const health = await mangaApi.getSystemHealth();
      setSystemHealth(health);
    } catch (err) {
      console.error('Delete job failed:', err);
      // Fallback: remove locally if backend errored due to mock state
      setFiles(prev => prev.filter(f => f.id !== id));
    }
  }, []);

  // Run ad-hoc translation test sandbox
  const runSandboxTest = async () => {
    if (!sandboxText.trim()) return;
    setSandboxLoading(true);
    setSandboxError(null);
    setSandboxResult('');
    const startTime = performance.now();
    try {
      const response = await mangaApi.testSandboxTranslation({
        text: sandboxText,
        provider: config.provider,
        model: config.model,
        system_prompt: config.systemPrompt,
      });
      setSandboxResult(response.translated_text);
      setSandboxTime(Math.round(performance.now() - startTime));
    } catch (err: any) {
      setSandboxError(err?.response?.data?.detail || err.message || 'Translation sandbox failed.');
    } finally {
      setSandboxLoading(false);
    }
  };

  // Stats calculation
  const totalUploaded = files.length;
  const activeJobs = files.filter(f => ['queued', 'segmenting', 'ocr', 'translating', 'inpainting', 'typesetting'].includes(f.status));
  const completedJobsCount = files.filter(f => f.status === 'completed').length;
  const awaitingReviewCount = files.filter(f => f.status === 'awaiting_review').length;
  const failedJobsCount = files.filter(f => ['failed', 'error'].includes(f.status)).length;
  
  const successRate = totalUploaded > 0 
    ? Math.round((completedJobsCount / totalUploaded) * 100) 
    : 100;

  // Filtered files for Archives & Queue list
  const filteredFiles = files.filter(f => {
    const matchesSearch = f.filename.toLowerCase().includes(searchQuery.toLowerCase()) || f.id.includes(searchQuery);
    if (!matchesSearch) return false;

    if (statusFilter === 'all') return true;
    if (statusFilter === 'processing') return ['queued', 'segmenting', 'ocr', 'translating', 'inpainting', 'typesetting'].includes(f.status);
    if (statusFilter === 'awaiting_review') return f.status === 'awaiting_review';
    if (statusFilter === 'completed') return f.status === 'completed';
    if (statusFilter === 'failed') return ['failed', 'error'].includes(f.status);
    return true;
  });

  return (
    <div className="flex h-screen bg-[#070707] text-[#ededed] font-sans selection:bg-cyan-500/30 overflow-hidden">
      
      {/* 🚀 SIDEBAR COMMAND CONTROL */}
      <aside className="w-80 border-r border-[#1c1c1c] bg-[#0b0b0b] flex flex-col justify-between shrink-0 select-none z-20">
        <div className="flex flex-col overflow-y-auto">
          {/* Logo & Header */}
          <div className="p-6 border-b border-[#1c1c1c] bg-black/40">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-cyan-500 flex items-center justify-center rounded shadow-[0_0_15px_rgba(6,182,212,0.6)]">
                <Icon icon="mdi:translate-variant" className="text-black text-xl font-bold" />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tighter uppercase italic text-transparent bg-clip-text bg-gradient-to-r from-white via-[#e1e1e1] to-cyan-400">
                  JISA STUDIO
                </h1>
                <p className="text-[10px] text-[#555] font-mono tracking-widest uppercase">
                  Manga Synthesis v1.0
                </p>
              </div>
            </div>

            {/* Health Heartbeat Widget */}
            <div className="mt-6 p-3 bg-[#111] border border-[#222] rounded flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "w-2 h-2 rounded-full",
                  systemHealth?.ollama?.status === 'connected' ? "bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]" : "bg-red-500 shadow-[0_0_8px_#ef4444]"
                )} />
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#aaa]">
                  {systemHealth?.ollama?.status === 'connected' ? "OLLAMA ONLINE" : "OLLAMA OFFLINE"}
                </span>
              </div>
              <span className="text-[9px] font-mono bg-cyan-950 text-cyan-400 border border-cyan-800/40 px-1.5 py-0.5 rounded">
                {systemHealth?.ollama?.ocr_model || "glm-ocr"}
              </span>
            </div>
          </div>

          {/* Navigation Commands */}
          <nav className="p-4 space-y-2 mt-4">
            <span className="px-3 text-[9px] font-mono text-[#444] uppercase tracking-[0.25em] font-black block mb-2">
              Command Suite
            </span>
            <button
              onClick={() => setActiveTab('overview')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded text-left transition-all duration-300 font-mono text-xs uppercase tracking-wider relative group",
                activeTab === 'overview'
                  ? "bg-[#151b22] text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]"
                  : "text-[#888] hover:text-[#eee] hover:bg-[#111]"
              )}
            >
              <Icon icon="mdi:view-dashboard-outline" className={cn("text-lg", activeTab === 'overview' ? "text-cyan-400" : "text-[#555]")} />
              Overview Workspace
              {activeJobs.length > 0 && (
                <span className="absolute right-4 w-4 h-4 bg-cyan-500 text-black text-[9px] font-black font-sans rounded-full flex items-center justify-center animate-pulse">
                  {activeJobs.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('archive')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded text-left transition-all duration-300 font-mono text-xs uppercase tracking-wider relative group",
                activeTab === 'archive'
                  ? "bg-[#151b22] text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]"
                  : "text-[#888] hover:text-[#eee] hover:bg-[#111]"
              )}
            >
              <Icon icon="mdi:folder-multiple-image" className={cn("text-lg", activeTab === 'archive' ? "text-cyan-400" : "text-[#555]")} />
              Archives & Queue
              {awaitingReviewCount > 0 && (
                <span className="absolute right-4 px-1.5 py-0.5 bg-yellow-500 text-black text-[8px] font-black font-sans rounded-full flex items-center justify-center animate-bounce shadow-[0_0_8px_#eab308]">
                  REVIEW
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('projects')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded text-left transition-all duration-300 font-mono text-xs uppercase tracking-wider relative group",
                activeTab === 'projects'
                  ? "bg-[#151b22] text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]"
                  : "text-[#888] hover:text-[#eee] hover:bg-[#111]"
              )}
            >
              <Icon icon="mdi:view-grid-plus-outline" className={cn("text-lg", activeTab === 'projects' ? "text-cyan-400" : "text-[#555]")} />
              Project Workspace
              {projects.length > 0 && (
                <span className="absolute right-4 w-4 h-4 bg-cyan-950 text-cyan-400 border border-cyan-800/40 text-[9px] font-black font-sans rounded-full flex items-center justify-center">
                  {projects.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('config')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded text-left transition-all duration-300 font-mono text-xs uppercase tracking-wider relative group",
                activeTab === 'config'
                  ? "bg-[#151b22] text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]"
                  : "text-[#888] hover:text-[#eee] hover:bg-[#111]"
              )}
            >
              <Icon icon="mdi:tune-variant" className={cn("text-lg", activeTab === 'config' ? "text-cyan-400" : "text-[#555]")} />
              Linguistic Engine
            </button>
          </nav>
        </div>

        {/* Hardware Status Bottom Bar */}
        <div className="p-4 border-t border-[#1c1c1c] bg-black/20 space-y-3 font-mono text-[9px] text-[#555]">
          <span className="text-[#333] uppercase tracking-[0.2em] font-black block">System Profile</span>
          <div className="flex justify-between">
            <span>Hardware:</span>
            <span className="text-cyan-500/80 font-bold">{systemHealth?.hardware?.device_name || "RTX 4060 Ready"}</span>
          </div>
          <div className="flex justify-between">
            <span>CUDA Accel:</span>
            <span className={systemHealth?.hardware?.cuda_available ? "text-green-500" : "text-amber-500"}>
              {systemHealth?.hardware?.cuda_available ? "ACTIVE" : "CPU ONLY"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Torch Framework:</span>
            <span>{systemHealth?.hardware?.torch_version || "PyTorch 2.4.1"}</span>
          </div>
        </div>
      </aside>

      {/* 🖥️ MAIN WORKSPACE VIEWPORT */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#070707] relative">
        <header className="px-8 py-6 border-b border-[#1c1c1c] bg-[#0b0b0b]/40 flex justify-between items-center z-10">
          <div>
            <h2 className="text-lg font-black tracking-tight uppercase font-mono text-white">
              {activeTab === 'overview' && "Dashboard Control center"}
              {activeTab === 'archive' && "Manga Translation Archive Queue"}
              {activeTab === 'projects' && "Project-Scoped Workspaces"}
              {activeTab === 'config' && "Fine-Tuning Configuration & Sandbox"}
            </h2>
            <p className="text-[10px] text-[#666] font-mono uppercase tracking-widest mt-1">
              {activeTab === 'overview' && "Active jobs // Hardware health // Quick uploads"}
              {activeTab === 'archive' && "Interactive catalog // side-by-side inspection // manual triggers"}
              {activeTab === 'projects' && "Create chapters // Scoped batch uploads // Progress tracking"}
              {activeTab === 'config' && "Model selection // prompt editing // sandboxed testing"}
            </p>
          </div>

          <div className="flex gap-3">
            {healthLoading ? (
              <span className="flex items-center gap-1.5 text-xs text-[#555] font-mono">
                <Icon icon="eos-icons:loading" className="text-cyan-500" /> Connecting API...
              </span>
            ) : (
              <button 
                onClick={loadInitialData}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[#222] bg-[#111] hover:bg-[#181818] transition-all rounded text-[10px] font-mono uppercase tracking-widest text-[#aaa] cursor-pointer"
              >
                <Icon icon="mdi:refresh" /> Refresh API
              </button>
            )}
          </div>
        </header>

        {/* Tab View Container */}
        <div className="flex-1 overflow-y-auto p-8 relative">
          <AnimatePresence mode="wait">
            
            {/* 📊 TAB 1: OVERVIEW & DASHBOARD */}
            {activeTab === 'overview' && (
              <motion.div
                key="overview-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
                className="space-y-8 max-w-6xl mx-auto"
              >
                {/* Stats Card Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* Stat Card 1: Completed */}
                  <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-5 rounded-lg relative overflow-hidden group hover:border-green-500/20 transition-all duration-300">
                    <div className="absolute top-0 right-0 p-3 opacity-[0.03] text-6xl text-green-500 font-black">
                      <Icon icon="mdi:checkbox-marked-circle-outline" />
                    </div>
                    <span className="text-[9px] font-mono text-[#555] uppercase tracking-widest font-black block mb-2">
                      Finalized Publications
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black font-mono text-green-400 group-hover:scale-105 transition-transform duration-300">
                        {completedJobsCount}
                      </span>
                      <span className="text-xs text-[#444] font-mono">pages</span>
                    </div>
                    <p className="text-[10px] text-[#666] mt-3 font-mono">typeset and rendered</p>
                  </div>

                  {/* Stat Card 2: Active */}
                  <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-5 rounded-lg relative overflow-hidden group hover:border-cyan-500/20 transition-all duration-300">
                    <div className="absolute top-0 right-0 p-3 opacity-[0.03] text-6xl text-cyan-500 font-black">
                      <Icon icon="eos-icons:loading" />
                    </div>
                    <span className="text-[9px] font-mono text-[#555] uppercase tracking-widest font-black block mb-2">
                      Active Synthesis In-Flight
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className={cn(
                        "text-3xl font-black font-mono group-hover:scale-105 transition-transform duration-300",
                        activeJobs.length > 0 ? "text-cyan-400" : "text-[#777]"
                      )}>
                        {activeJobs.length}
                      </span>
                      <span className="text-xs text-[#444] font-mono">running</span>
                    </div>
                    <p className="text-[10px] text-[#666] mt-3 font-mono">under GPU segmentation</p>
                  </div>

                  {/* Stat Card 3: Awaiting HITL */}
                  <div className={cn(
                    "border p-5 rounded-lg relative overflow-hidden group transition-all duration-300",
                    awaitingReviewCount > 0
                      ? "bg-yellow-950/15 border-yellow-500/35 hover:border-yellow-400/50 shadow-[0_0_15px_rgba(234,179,8,0.03)] cursor-pointer"
                      : "bg-[#0b0b0b] border-[#1c1c1c] hover:border-yellow-500/20"
                  )}
                  onClick={() => awaitingReviewCount > 0 && setActiveTab('archive')}
                  >
                    <div className="absolute top-0 right-0 p-3 opacity-[0.04] text-6xl text-yellow-500 font-black">
                      <Icon icon="mdi:translate" />
                    </div>
                    <span className="text-[9px] font-mono text-[#555] uppercase tracking-widest font-black block mb-2">
                      Human Review Gates
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className={cn(
                        "text-3xl font-black font-mono group-hover:scale-105 transition-transform duration-300",
                        awaitingReviewCount > 0 ? "text-yellow-400 animate-pulse" : "text-[#777]"
                      )}>
                        {awaitingReviewCount}
                      </span>
                      <span className="text-xs text-[#444] font-mono">pending</span>
                    </div>
                    <p className={cn(
                      "text-[10px] mt-3 font-mono",
                      awaitingReviewCount > 0 ? "text-yellow-400/70" : "text-[#666]"
                    )}>
                      {awaitingReviewCount > 0 ? "Click to verify translation studio" : "zero blocks locked"}
                    </p>
                  </div>

                  {/* Stat Card 4: Success Rate */}
                  <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-5 rounded-lg relative overflow-hidden group hover:border-purple-500/20 transition-all duration-300">
                    <div className="absolute top-0 right-0 p-3 opacity-[0.03] text-6xl text-purple-500 font-black">
                      <Icon icon="mdi:percent" />
                    </div>
                    <span className="text-[9px] font-mono text-[#555] uppercase tracking-widest font-black block mb-2">
                      Success Rate (Yield)
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black font-mono text-[#d946ef] group-hover:scale-105 transition-transform duration-300">
                        {successRate}%
                      </span>
                    </div>
                    <p className="text-[10px] text-[#666] mt-3 font-mono">out of {totalUploaded} pages uploaded</p>
                  </div>
                </div>

                {/* Grid layout for Uploader and Live processing files */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left columns (2): Drag Drop Upload */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="p-4 border-b border-[#1c1c1c] bg-[#0c0c0c] flex items-center justify-between rounded-t">
                      <span className="font-mono text-xs text-[#666] uppercase tracking-widest font-bold">
                        Ingestion Console
                      </span>
                      <span className="text-[9px] font-mono text-[#444] uppercase tracking-widest">
                        Drag or click file target
                      </span>
                    </div>

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
                        "relative group cursor-pointer border border-dashed rounded-lg transition-all duration-500 flex flex-col items-center justify-center p-20",
                        isDragging ? "border-cyan-500 bg-cyan-500/5 shadow-[0_0_20px_rgba(6,182,212,0.1)]" : "border-[#222] hover:border-cyan-500/30 bg-[#0a0a0a]",
                        isUploading && "animate-pulse cursor-wait"
                      )}
                    >
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-cyan-500 via-transparent to-transparent transition-opacity duration-500" />
                      
                      <div className="relative z-10 text-center">
                        <div className="w-16 h-16 rounded-full bg-[#111] border border-[#222] group-hover:border-cyan-500/40 flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-all duration-300">
                          <Icon 
                            icon={isUploading ? "eos-icons:loading" : "mdi:cloud-upload-outline"}
                            className={cn("text-3xl text-[#666] transition-colors group-hover:text-cyan-400", isDragging && "text-cyan-500 animate-pulse")}
                          />
                        </div>
                        <h3 className="text-sm font-bold uppercase tracking-tight text-white mb-2 font-mono">
                          {isUploading ? "Uploading Batch..." : "Drop raw manga sheets here"}
                        </h3>
                        <p className="text-[#555] font-mono text-[9px] uppercase tracking-wider">
                          Support: PNG // JPG // WEBP // BMP (Multi-Select)
                        </p>
                      </div>
                    </section>
                  </div>

                  {/* Right Column (1): Active Job Queue Timeline */}
                  <div className="space-y-6">
                    <div className="p-4 border-b border-[#1c1c1c] bg-[#0c0c0c] flex items-center justify-between rounded-t">
                      <span className="font-mono text-xs text-cyan-400 uppercase tracking-widest font-bold">
                        Pipeline Monitor ({activeJobs.length})
                      </span>
                      <span className="w-2 h-2 bg-cyan-500 rounded-full animate-ping" />
                    </div>

                    <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                      <AnimatePresence initial={false}>
                        {activeJobs.length === 0 ? (
                          <div className="p-8 border border-dashed border-[#1c1c1c] text-center text-xs text-[#555] font-mono uppercase">
                            No Active Pipelines
                            <span className="block text-[9px] text-[#444] mt-2 leading-relaxed">
                              Uploaded pages processing automatically under RTX synthetics will display here.
                            </span>
                          </div>
                        ) : (
                          activeJobs.map((file) => (
                            <div 
                              key={file.id} 
                              className="p-4 bg-[#0a0a0a] border border-[#1c1c1c] rounded relative overflow-hidden group shadow"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-mono text-xs truncate max-w-[120px] font-bold text-white uppercase tracking-wider">
                                  {file.filename}
                                </span>
                                <span className="text-[8px] font-mono font-bold bg-[#111] px-2 py-0.5 border border-[#222] uppercase tracking-wider text-cyan-400">
                                  {file.status}
                                </span>
                              </div>
                              <p className="text-[10px] text-[#666] font-mono mb-3 uppercase tracking-tighter">
                                {file.message || "Synthesis initial logic..."}
                              </p>

                              {/* Progress bar */}
                              <div className="h-1 bg-[#111] w-full rounded overflow-hidden">
                                <motion.div 
                                  className="h-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]"
                                  initial={{ width: 0 }}
                                  animate={{ width: `${file.progress}%` }}
                                  transition={{ duration: 0.5 }}
                                />
                              </div>
                            </div>
                          ))
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Grid of full file inspect items in progress */}
                {files.filter(f => f.status === 'awaiting_review' || ['failed', 'error'].includes(f.status)).length > 0 && (
                  <div className="space-y-6 pt-6">
                    <span className="font-mono text-xs text-[#555] uppercase tracking-widest font-black block border-b border-[#1c1c1c] pb-3">
                      Action Items Awaiting Intervention
                    </span>
                    <div className="grid grid-cols-1 gap-8">
                      {files
                        .filter(f => f.status === 'awaiting_review' || ['failed', 'error'].includes(f.status))
                        .map(file => (
                          <MangaFileItem 
                            key={file.id} 
                            item={file} 
                            onUpdate={handleUpdate} 
                            onRemove={handleRemove} 
                          />
                        ))
                      }
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* 📂 TAB 2: ARCHIVES & QUEUE TABLE */}
            {activeTab === 'archive' && (
              <motion.div
                key="archive-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
                className="space-y-6 max-w-6xl mx-auto"
              >
                {/* Search & Filter bar */}
                <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-[#0b0b0b] border border-[#1c1c1c] p-4 rounded-lg">
                  <div className="relative w-full md:w-80">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#555]">
                      <Icon icon="mdi:magnify" />
                    </span>
                    <input
                      type="text"
                      placeholder="Search archive filename or ID..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full text-xs font-mono pl-9 pr-4 py-2 border border-[#222] bg-[#121212] rounded text-white focus:outline-none focus:border-cyan-500 transition-colors"
                    />
                  </div>

                  {/* Filter tabs */}
                  <div className="flex flex-wrap gap-2 w-full md:w-auto">
                    {[
                      { id: 'all', label: 'ALL' },
                      { id: 'processing', label: 'PROCESSING' },
                      { id: 'awaiting_review', label: 'REVIEW REQUIRED' },
                      { id: 'completed', label: 'COMPLETED' },
                      { id: 'failed', label: 'FAILED' }
                    ].map((filt) => (
                      <button
                        key={filt.id}
                        onClick={() => setStatusFilter(filt.id)}
                        className={cn(
                          "px-3 py-1.5 text-[9px] font-mono font-bold rounded uppercase tracking-wider transition-all cursor-pointer border",
                          statusFilter === filt.id
                            ? "bg-cyan-500 text-black border-cyan-500"
                            : "bg-[#111] text-[#888] border-[#222] hover:text-white"
                        )}
                      >
                        {filt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* High density records queue */}
                <div className="bg-[#0b0b0b] border border-[#1c1c1c] rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#1c1c1c] bg-[#111]/60 text-[10px] font-mono text-[#555] uppercase tracking-widest font-black">
                          <th className="py-4 px-6 w-16">Preview</th>
                          <th className="py-4 px-6">Filename & ID</th>
                          <th className="py-4 px-6 w-36">Status</th>
                          <th className="py-4 px-6 w-44">Progress</th>
                          <th className="py-4 px-6 w-44 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1c1c1c] text-xs font-mono">
                        {filteredFiles.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-12 text-center text-[#555] uppercase">
                              No matching files detected in Jisa Archive.
                            </td>
                          </tr>
                        ) : (
                          filteredFiles.map((file) => {
                            const isCompleted = file.status === 'completed';
                            const isAwaitingReview = file.status === 'awaiting_review';
                            const isFailed = ['failed', 'error'].includes(file.status);
                            const isProcessing = ['queued', 'segmenting', 'ocr', 'translating', 'inpainting', 'typesetting'].includes(file.status);

                            return (
                              <tr key={file.id} className="hover:bg-[#111]/30 transition-colors group">
                                {/* Thumbnail */}
                                <td className="py-4 px-6">
                                  <div className="w-10 h-14 bg-black border border-[#222] rounded overflow-hidden relative cursor-pointer"
                                    onClick={() => {
                                      if (isCompleted) {
                                        setInspectItem(file);
                                        setInspectMode('translated');
                                      } else if (isAwaitingReview) {
                                        setActiveHITLItem(file);
                                      }
                                    }}
                                  >
                                    <img 
                                      src={file.originalUrl || file.result_url || ''} 
                                      alt="preview" 
                                      className="w-full h-full object-cover grayscale-[0.3] hover:scale-110 transition-transform duration-300"
                                    />
                                  </div>
                                </td>

                                {/* Info */}
                                <td className="py-4 px-6">
                                  <span className="text-white font-bold block uppercase text-xs truncate max-w-[240px]" title={file.filename}>
                                    {file.filename}
                                  </span>
                                  <span className="text-[9px] text-[#444] uppercase tracking-tighter">
                                    UUID: {file.id}
                                  </span>
                                </td>

                                {/* Status Badges */}
                                <td className="py-4 px-6">
                                  <span className={cn(
                                    "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider",
                                    isCompleted && "bg-green-500/5 border-green-500/40 text-green-500",
                                    isAwaitingReview && "bg-yellow-500/5 border-yellow-500/40 text-yellow-500 animate-pulse shadow-[0_0_8px_rgba(234,179,8,0.1)]",
                                    isFailed && "bg-red-500/5 border-red-500/40 text-red-500",
                                    isProcessing && "bg-cyan-500/5 border-cyan-500/40 text-cyan-500"
                                  )}>
                                    <span className={cn(
                                      "w-1.5 h-1.5 rounded-full",
                                      isCompleted && "bg-green-500",
                                      isAwaitingReview && "bg-yellow-500",
                                      isFailed && "bg-red-500",
                                      isProcessing && "bg-cyan-500 animate-pulse"
                                    )} />
                                    {file.status}
                                  </span>
                                </td>

                                {/* Progress Gauge */}
                                <td className="py-4 px-6">
                                  <div className="flex items-center gap-3">
                                    <div className="w-24 h-1.5 bg-[#111] border border-[#222] rounded overflow-hidden">
                                      <div 
                                        className={cn(
                                          "h-full",
                                          isFailed ? "bg-red-500" : "bg-cyan-500 shadow-[0_0_5px_#06b6d4]"
                                        )}
                                        style={{ width: `${file.progress}%` }}
                                      />
                                    </div>
                                    <span className="text-[10px] text-[#666] font-mono">{file.progress}%</span>
                                  </div>
                                </td>

                                {/* Actions Menu */}
                                <td className="py-4 px-6 text-right">
                                  <div className="flex gap-2 justify-end">
                                    {isAwaitingReview && (
                                      <button
                                        onClick={() => setActiveHITLItem(file)}
                                        className="px-2.5 py-1.5 bg-yellow-500 hover:bg-yellow-400 text-black border border-yellow-500 rounded font-bold uppercase tracking-wider text-[8px] font-mono flex items-center gap-1 cursor-pointer transition-colors shadow-sm"
                                        title="Launch Studio editor"
                                      >
                                        <Icon icon="mdi:translate" /> REVIEW
                                      </button>
                                    )}

                                    {isCompleted && (
                                      <button
                                        onClick={() => {
                                          setInspectItem(file);
                                          setInspectMode('translated');
                                        }}
                                        className="px-2.5 py-1.5 bg-[#111] hover:bg-[#1c1c1c] text-cyan-400 border border-[#222] hover:border-cyan-500/30 rounded font-bold uppercase tracking-wider text-[8px] font-mono flex items-center gap-1 cursor-pointer transition-colors"
                                        title="Inspect final typeset"
                                      >
                                        <Icon icon="mdi:magnify" /> INSPECT
                                      </button>
                                    )}

                                    {isCompleted && file.result_url && (
                                      <a
                                        href={file.result_url}
                                        download={file.filename}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="p-1.5 border border-[#222] bg-[#111] hover:bg-[#1a1a1a] hover:border-cyan-500/20 text-[#888] hover:text-white rounded text-xs flex items-center justify-center transition-colors"
                                        title="Download publication sheet"
                                      >
                                        <Icon icon="mdi:download" />
                                      </a>
                                    )}

                                    <button
                                      onClick={() => handleRemove(file.id)}
                                      className="p-1.5 border border-[#222] text-[#444] hover:text-red-500 hover:border-red-500 hover:bg-red-500/5 rounded text-xs flex items-center justify-center transition-colors cursor-pointer"
                                      title="Unlink and delete record"
                                    >
                                      <Icon icon="mdi:delete-outline" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {/* 📁 TAB 4: PROJECTS WORKSPACE */}
            {activeTab === 'projects' && (
              <motion.div
                key="projects-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
                className="grid grid-cols-1 lg:grid-cols-4 gap-8 max-w-6xl mx-auto"
              >
                {/* Left Side: Project Manager */}
                <div className="lg:col-span-1 space-y-6">
                  <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-5 rounded-lg space-y-4">
                    <span className="font-mono text-[9px] text-[#555] uppercase tracking-widest font-black block">
                      Create Project Session
                    </span>
                    <form 
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!newProjectName.trim()) return;
                        try {
                          const proj = await mangaApi.createProject(newProjectName.trim());
                          setProjects(prev => [proj, ...prev]);
                          setActiveProjectId(proj.id);
                          setNewProjectName('');
                        } catch (err) {
                          console.error('Failed to create project:', err);
                        }
                      }}
                      className="space-y-2"
                    >
                      <input
                        type="text"
                        placeholder="Chapter 1, Volume 1..."
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        className="w-full text-xs font-mono px-3 py-2 border border-[#222] bg-[#121212] rounded text-white focus:outline-none focus:border-cyan-500 transition-colors"
                      />
                      <button
                        type="submit"
                        disabled={!newProjectName.trim()}
                        className="w-full py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-[#1a1a1a] disabled:text-[#444] text-black font-black uppercase tracking-widest font-mono text-[10px] rounded transition-colors cursor-pointer"
                      >
                        Create Session
                      </button>
                    </form>
                  </div>

                  <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-5 rounded-lg space-y-4">
                    <span className="font-mono text-[9px] text-[#555] uppercase tracking-widest font-black block">
                      Active Sessions ({projects.length})
                    </span>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                      {projects.length === 0 ? (
                        <div className="text-center py-8 text-xs font-mono text-[#444] uppercase">
                          No Active Sessions
                        </div>
                      ) : (
                        projects.map((proj) => {
                          const isSelected = activeProjectId === proj.id;
                          const projJobs = files.filter(f => f.project_id === proj.id);
                          return (
                            <button
                              key={proj.id}
                              onClick={() => setActiveProjectId(proj.id)}
                              className={cn(
                                "w-full p-3 border rounded text-left transition-all duration-300 font-mono text-xs block group relative",
                                isSelected
                                  ? "bg-[#151b22] text-cyan-400 border-cyan-500/30"
                                  : "bg-[#0c0c0c] text-[#888] border-[#222] hover:text-white hover:border-[#333]"
                              )}
                            >
                              <div className="font-bold truncate pr-6 uppercase tracking-wider">{proj.name}</div>
                              <div className="text-[9px] text-[#555] mt-1 flex justify-between">
                                <span>{new Date(proj.created_at).toLocaleDateString()}</span>
                                <span className="text-cyan-500/80 font-bold">{projJobs.length} pages</span>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Side: Selected Project Details Workspace */}
                <div className="lg:col-span-3 space-y-6">
                  {activeProjectId ? (() => {
                    const activeProj = projects.find(p => p.id === activeProjectId);
                    const activeProjJobs = files.filter(f => f.project_id === activeProjectId);
                    const completedCount = activeProjJobs.filter(f => f.status === 'completed').length;
                    const processingCount = activeProjJobs.filter(f => ['queued', 'segmenting', 'ocr', 'translating', 'inpainting', 'typesetting'].includes(f.status)).length;
                    
                    return (
                      <>
                        {/* Project Header Stats */}
                        <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-6 rounded-lg flex flex-wrap justify-between items-center gap-4">
                          <div>
                            <h3 className="text-base font-black tracking-tight text-white uppercase font-mono">
                              {activeProj?.name}
                            </h3>
                            <p className="text-[9px] text-[#555] font-mono uppercase tracking-widest mt-1">
                              ID: {activeProjectId} // Created: {activeProj && new Date(activeProj.created_at).toLocaleString()}
                            </p>
                          </div>

                          <div className="flex gap-4 font-mono text-[10px]">
                            <div className="bg-[#111] border border-[#222] px-3 py-2 rounded">
                              <span className="text-[#555] uppercase block text-[8px] font-bold">Processed</span>
                              <span className="text-green-400 font-bold text-sm">{completedCount}</span>
                              <span className="text-[#444] text-[9px]"> / {activeProjJobs.length} pages</span>
                            </div>
                            <div className="bg-[#111] border border-[#222] px-3 py-2 rounded">
                              <span className="text-[#555] uppercase block text-[8px] font-bold">In Progress</span>
                              <span className="text-cyan-400 font-bold text-sm">{processingCount}</span>
                              <span className="text-[#444] text-[9px]"> active</span>
                            </div>
                          </div>
                        </div>

                        {/* Drag and Drop Uploader Scoped to Project */}
                        <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-6 rounded-lg space-y-4">
                          <span className="font-mono text-xs text-[#666] uppercase tracking-widest font-bold block">
                            Project Batch Ingestion
                          </span>
                          <div
                            onDrop={(e) => {
                              e.preventDefault();
                              setIsDragging(false);
                              const droppedFiles = Array.from(e.dataTransfer.files).filter(file =>
                                ALLOWED_IMAGE_TYPES.includes(file.type)
                              );
                              uploadBatch(droppedFiles, activeProjectId);
                            }}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onClick={() => {
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.multiple = true;
                              input.accept = ALLOWED_IMAGE_TYPES.join(',');
                              input.onchange = (e) => {
                                const fileList = Array.from((e.target as HTMLInputElement).files || []);
                                uploadBatch(fileList, activeProjectId);
                              };
                              input.click();
                            }}
                            className={cn(
                              "relative group cursor-pointer border border-dashed rounded-lg transition-all duration-500 flex flex-col items-center justify-center p-12",
                              isDragging ? "border-cyan-500 bg-cyan-500/5 shadow-[0_0_20px_rgba(6,182,212,0.1)]" : "border-[#222] hover:border-cyan-500/30 bg-[#0a0a0a]",
                              isUploading && "animate-pulse cursor-wait"
                            )}
                          >
                            <div className="relative z-10 text-center">
                              <Icon 
                                icon={isUploading ? "eos-icons:loading" : "mdi:cloud-upload-outline"}
                                className={cn("text-3xl text-[#444] mx-auto mb-2 group-hover:text-cyan-400 transition-colors", isUploading && "animate-pulse")}
                              />
                              <h4 className="text-xs font-bold uppercase tracking-tight text-white mb-1 font-mono">
                                {isUploading ? "Uploading Batch..." : "Drop images to upload to this project"}
                              </h4>
                              <p className="text-[#555] font-mono text-[8px] uppercase tracking-wider">
                                Click or drag files to add page sheets
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Project Page Jobs */}
                        <div className="space-y-4">
                          <span className="font-mono text-xs text-[#555] uppercase tracking-widest font-black block border-b border-[#1c1c1c] pb-3">
                            Session Sheet Catalogue ({activeProjJobs.length})
                          </span>
                          
                          {activeProjJobs.length === 0 ? (
                            <div className="p-8 border border-dashed border-[#1c1c1c] text-center text-xs text-[#555] font-mono uppercase bg-[#080808]">
                              No sheets in session
                              <span className="block text-[9px] text-[#444] mt-2 leading-relaxed">
                                Upload page images above to begin translation pipeline orchestration.
                              </span>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 gap-6">
                              {activeProjJobs.map(file => (
                                <MangaFileItem 
                                  key={file.id} 
                                  item={file} 
                                  onUpdate={handleUpdate} 
                                  onRemove={handleRemove} 
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })() : (
                    <div className="bg-[#0b0b0b] border border-[#1c1c1c] rounded-lg p-16 flex flex-col items-center justify-center text-center space-y-4">
                      <div className="w-16 h-16 rounded-full bg-[#111] border border-[#222] flex items-center justify-center text-[#444]">
                        <Icon icon="mdi:projector-screen" className="text-3xl text-cyan-500" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold uppercase tracking-tight text-white font-mono">
                          Select or Create a session
                        </h3>
                        <p className="text-[#555] font-mono text-[9px] uppercase tracking-widest mt-1">
                          Choose an active chapter session from the left column to get started.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ⚙️ TAB 3: SYSTEM CONFIG & TRANSLATION SANDBOX */}
            {activeTab === 'config' && (
              <motion.div
                key="config-tab"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.25 }}
                className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl mx-auto"
              >
                
                {/* Configuration Panel */}
                <div className="space-y-6 bg-[#0b0b0b] border border-[#1c1c1c] p-6 rounded-lg">
                  <div className="border-b border-[#1c1c1c] pb-4 flex items-center justify-between">
                    <span className="font-mono text-xs text-[#666] uppercase tracking-widest font-bold block">
                      Fine-Tuning linguistic profile
                    </span>
                    <Icon icon="mdi:cog" className="text-cyan-500 text-lg" />
                  </div>

                  <div className="space-y-4 font-mono text-xs">
                    
                    {/* Provider Select */}
                    <div className="space-y-2">
                      <label className="text-[10px] text-[#555] uppercase tracking-widest block font-bold">API LLM provider</label>
                      <select 
                        value={config.provider}
                        onChange={(e) => setConfig(prev => ({ ...prev, provider: e.target.value as any }))}
                        className="w-full bg-[#121212] border border-[#222] p-2.5 rounded text-white focus:outline-none focus:border-cyan-500 text-xs"
                      >
                        <option value="openai">OpenAI (GPT BYOK)</option>
                        <option value="ollama">Ollama (Local LLM)</option>
                        <option value="anthropic">Anthropic (Claude BYOK)</option>
                      </select>
                    </div>

                    {/* Model Selector */}
                    <div className="space-y-2">
                      <label className="text-[10px] text-[#555] uppercase tracking-widest block font-bold">Linguistic model</label>
                      {config.provider === 'ollama' && systemHealth?.ollama?.models?.length > 0 ? (
                        <select
                          value={config.model}
                          onChange={(e) => setConfig(prev => ({ ...prev, model: e.target.value }))}
                          className="w-full bg-[#121212] border border-[#222] p-2.5 rounded text-white focus:outline-none focus:border-cyan-500 text-xs"
                        >
                          {systemHealth.ollama.models.map((m: string) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={config.model}
                          onChange={(e) => setConfig(prev => ({ ...prev, model: e.target.value }))}
                          placeholder="e.g. gpt-4o, claude-3-5-sonnet"
                          className="w-full bg-[#121212] border border-[#222] p-2.5 rounded text-white focus:outline-none focus:border-cyan-500 text-xs"
                        />
                      )}
                    </div>

                    {/* Default Typesetting font selection */}
                    <div className="space-y-2">
                      <label className="text-[10px] text-[#555] uppercase tracking-widest block font-bold">Primary typesetting font</label>
                      <div className="grid grid-cols-2 gap-2 bg-[#121212] p-1 border border-[#222] rounded">
                        <button className="py-2 text-[10px] bg-cyan-500 text-black font-black uppercase rounded tracking-widest">
                          ITIM REGULAR
                        </button>
                        <button className="py-2 text-[10px] text-[#888] font-bold uppercase rounded tracking-widest hover:text-white" disabled>
                          IANNNNN COW
                        </button>
                      </div>
                      <span className="text-[9px] text-[#444] block uppercase leading-relaxed mt-1">
                        Fonts matched dynamically in assets folder. Itim-Regular provides standard publication quality.
                      </span>
                    </div>

                    {/* System Prompt config */}
                    <div className="space-y-2">
                      <label className="text-[10px] text-[#555] uppercase tracking-widest block font-bold">System instructions (Translator Prompt)</label>
                      <textarea
                        value={config.systemPrompt}
                        onChange={(e) => setConfig(prev => ({ ...prev, systemPrompt: e.target.value }))}
                        className="w-full bg-[#121212] border border-[#222] p-3 h-48 rounded text-white focus:outline-none focus:border-cyan-500 font-sans leading-relaxed text-xs resize-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Ad-Hoc Text translation testing Sandbox */}
                <div className="space-y-6 bg-[#0b0b0b] border border-[#1c1c1c] p-6 rounded-lg flex flex-col">
                  <div className="border-b border-[#1c1c1c] pb-4 flex items-center justify-between">
                    <span className="font-mono text-xs text-[#666] uppercase tracking-widest font-bold block">
                      Context Translation Sandbox
                    </span>
                    <Icon icon="mdi:test-tube" className="text-cyan-500 text-lg" />
                  </div>

                  <div className="flex-1 flex flex-col justify-between space-y-4">
                    
                    {/* Sandbox Input */}
                    <div className="space-y-2">
                      <label className="text-[10px] text-cyan-500/80 font-mono uppercase tracking-widest block font-bold">Japanese Dialogue Block</label>
                      <textarea
                        value={sandboxText}
                        onChange={(e) => setSandboxText(e.target.value)}
                        placeholder="พิมพ์ภาษาญี่ปุ่นเพื่อทดสอบคำแปล..."
                        className="w-full bg-[#121212] border border-[#222] hover:border-[#333] focus:border-cyan-500 p-3 h-28 rounded text-white focus:outline-none text-sm leading-relaxed"
                      />
                    </div>

                    {/* Run action */}
                    <button
                      onClick={runSandboxTest}
                      disabled={sandboxLoading || !sandboxText.trim()}
                      className="w-full flex items-center justify-center gap-2 py-3 bg-cyan-500 hover:bg-cyan-400 disabled:bg-[#1a1a1a] disabled:text-[#444] text-black font-black uppercase tracking-widest font-mono rounded transition-colors shadow-lg shadow-cyan-500/10 cursor-pointer"
                    >
                      {sandboxLoading ? (
                        <>
                          <Icon icon="eos-icons:loading" className="text-base" /> Running context Translation...
                        </>
                      ) : (
                        <>
                          <Icon icon="mdi:play" className="text-base" /> Run Translation Test
                        </>
                      )}
                    </button>

                    {/* Sandbox Output */}
                    <div className="space-y-2 flex-1 flex flex-col justify-end">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] text-[#555] font-mono uppercase tracking-widest block font-bold">Thai Output Draft</label>
                        {sandboxTime && (
                          <span className="text-[9px] text-cyan-500/60 font-mono font-bold uppercase tracking-wider">
                            SPEED: {sandboxTime}ms
                          </span>
                        )}
                      </div>

                      <div className="w-full bg-black/40 border border-[#222] p-4 rounded min-h-[140px] flex flex-col justify-center relative select-all">
                        {sandboxLoading ? (
                          <div className="text-center text-xs text-[#555] font-mono animate-pulse">
                            Processing deep LLM structures...
                          </div>
                        ) : sandboxError ? (
                          <div className="text-xs text-red-500 font-mono leading-relaxed bg-red-950/20 border border-red-500/20 p-2">
                            Sandbox Error: {sandboxError}
                          </div>
                        ) : sandboxResult ? (
                          <div className="p-1">
                            <ThaiText className="text-cyan-400 text-sm leading-relaxed block font-medium">
                              {sandboxResult}
                            </ThaiText>
                          </div>
                        ) : (
                          <div className="text-center text-xs text-[#444] font-mono uppercase tracking-widest select-none">
                            Awaiting sandbox simulation execution
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 🏢 Bottom Info Grid Footer */}
        <footer className="px-8 py-4 border-t border-[#1c1c1c] bg-[#0b0b0b]/40 text-center flex flex-wrap justify-between items-center shrink-0">
          <span className="text-[#333] font-mono text-[9px] uppercase tracking-widest font-black">
            JISA SYSTEMS INC // SECURE LOCALHOST PIPELINE
          </span>
          <p className="text-[#333] font-mono text-[9px] uppercase tracking-widest flex items-center gap-4">
            <span className="flex items-center gap-1"><Icon icon="logos:nextjs-icon" /> Next.js 16</span>
            <span className="flex items-center gap-1"><Icon icon="logos:fastapi" /> FastAPI</span>
            <span className="flex items-center gap-1 text-cyan-500/70"><Icon icon="mdi:nvidia" /> RTX 4060 READY</span>
          </p>
        </footer>
      </main>

      {/* 🖼️ COMPLETED PUBLICATION MAGNIFY / INSPECT MODAL */}
      <AnimatePresence>
        {inspectItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col font-sans overflow-hidden"
          >
            {/* Header control */}
            <header className="flex items-center justify-between px-6 py-4 border-b border-[#222] bg-[#0c0c0c] shrink-0">
              <div className="flex items-center gap-3">
                <Icon icon="mdi:magnify" className="text-xl text-cyan-500" />
                <h2 className="text-sm font-bold tracking-tight uppercase font-mono text-white">
                  Publication Inspector <span className="text-[#444]">//</span> Slide View
                </h2>
                <span className="text-[10px] font-mono bg-cyan-950 text-cyan-400 border border-cyan-800/40 px-2 py-0.5 rounded">
                  {inspectItem.filename}
                </span>
              </div>

              <div className="flex gap-4 items-center">
                {/* Layer toggles */}
                <div className="flex bg-[#111] border border-[#333] p-1 rounded">
                  {[
                    { id: 'original', label: 'RAW INPUT' },
                    { id: 'inpainted', label: 'CLEANED (INPAINT)' },
                    { id: 'translated', label: 'TYPESET PUBLICATION' }
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      onClick={() => setInspectMode(mode.id as any)}
                      className={cn(
                        "px-3 py-1 text-[9px] font-mono font-bold transition-all cursor-pointer",
                        inspectMode === mode.id
                          ? "bg-cyan-500 text-black"
                          : "text-[#888] hover:text-white"
                      )}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                {inspectItem.result_url && (
                  <a
                    href={inspectItem.result_url}
                    download={inspectItem.filename}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500 hover:text-black font-bold uppercase tracking-widest text-[9px] font-mono transition-all rounded flex items-center gap-1.5"
                  >
                    <Icon icon="mdi:download" />
                    Download
                  </a>
                )}

                <button
                  onClick={() => setInspectItem(null)}
                  className="p-2 border border-[#333] hover:border-red-500 hover:text-red-500 hover:bg-red-500/5 transition-all text-xs rounded font-mono uppercase tracking-widest flex items-center gap-1"
                >
                  <Icon icon="mdi:close" /> Close
                </button>
              </div>
            </header>

            {/* Split comparison viewports */}
            <div className="flex-1 flex bg-[#060606] p-6 gap-6 justify-center items-center overflow-hidden">
              
              {/* Left Side: Original page */}
              <div className="flex-1 max-h-full aspect-[3/4] bg-black border border-[#222] overflow-hidden flex items-center justify-center relative rounded">
                <div className="absolute top-4 left-4 z-10 px-2 py-1 bg-black/85 border border-[#333] text-[9px] font-mono uppercase tracking-[0.2em] text-[#888] rounded">
                  Raw Input (Original)
                </div>
                <img 
                  src={inspectItem.originalUrl} 
                  alt="Original Raw" 
                  className="max-w-full max-h-full object-contain filter grayscale-[0.2]"
                />
              </div>

              {/* Right Side: Selected layer */}
              <div className="flex-1 max-h-full aspect-[3/4] bg-black border border-cyan-500/20 overflow-hidden flex items-center justify-center relative rounded shadow-2xl">
                <div className="absolute top-4 left-4 z-10 px-2.5 py-1 bg-cyan-950/90 border border-cyan-500/30 text-[9px] font-mono uppercase tracking-[0.2em] text-cyan-400 rounded">
                  {inspectMode === 'original' && "Raw Input layer"}
                  {inspectMode === 'inpainted' && "Cleaned Artwork (Inpainted)"}
                  {inspectMode === 'translated' && "Premium Typeset Translated"}
                </div>
                <img 
                  src={
                    inspectMode === 'translated' 
                      ? inspectItem.result_url || inspectItem.originalUrl 
                      : inspectMode === 'inpainted' 
                        ? inspectItem.inpainted_url || inspectItem.originalUrl 
                        : inspectItem.originalUrl
                  } 
                  alt="Inspector View" 
                  className="max-w-full max-h-full object-contain"
                />
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 📝 ACTIVE HITL EDITOR MODAL FROM ARCHIVE GRID */}
      {activeHITLItem && (
        <TranslationEditor
          item={activeHITLItem}
          onClose={() => setActiveHITLItem(null)}
          onUpdate={handleUpdate}
        />
      )}

    </div>
  );
};

export default MangaTranslator;
