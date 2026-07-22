'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { mangaApi, API_BASE_URL } from '../api/mangaApi';
import type { ProcessedManga, TranslationConfig, Project, SystemHealth } from '../types';

interface MangaTranslatorContextType {
  files: ProcessedManga[];
  setFiles: React.Dispatch<React.SetStateAction<ProcessedManga[]>>;
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  systemHealth: SystemHealth | null;
  setSystemHealth: (health: SystemHealth | null) => void;
  healthLoading: boolean;
  setHealthLoading: (loading: boolean) => void;
  isUploading: boolean;
  setIsUploading: (uploading: boolean) => void;
  isDragging: boolean;
  setIsDragging: (dragging: boolean) => void;
  config: TranslationConfig;
  setConfig: React.Dispatch<React.SetStateAction<TranslationConfig>>;
  sseStatus: 'connected' | 'reconnecting' | 'error';
  bootstrapError: string | null;
  activeUploadCount: number;

  
  // Sandbox states
  sandboxText: string;
  setSandboxText: (text: string) => void;
  sandboxResult: string;
  setSandboxResult: (result: string) => void;
  sandboxLoading: boolean;
  setSandboxLoading: (loading: boolean) => void;
  sandboxError: string | null;
  setSandboxError: (error: string | null) => void;
  sandboxTime: number | null;
  setSandboxTime: (time: number | null) => void;

  // Actions
  loadInitialData: () => Promise<void>;
  uploadBatch: (fileList: File[], projectId?: string) => Promise<void>;
  handleUpdate: (id: string, updates: Partial<ProcessedManga>) => void;
  handleRemove: (id: string) => Promise<void>;
  handleMovePage: (projectId: string, jobId: string, direction: 'up' | 'down') => Promise<void>;
  handleMovePageTo: (projectId: string, jobId: string, targetPosition: number) => Promise<void>;
  handleRenameProject: (projectId: string, newName: string) => Promise<void>;
  handleDeleteProject: (projectId: string) => Promise<void>;
  runSandboxTest: () => Promise<void>;

  // HITL state
  activeHITLItem: ProcessedManga | null;
  setActiveHITLItem: (item: ProcessedManga | null) => void;
}

const MangaTranslatorContext = createContext<MangaTranslatorContextType | undefined>(undefined);

export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/tiff'];

export const MangaTranslatorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [files, setFiles] = useState<ProcessedManga[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeHITLItem, setActiveHITLItem] = useState<ProcessedManga | null>(null);
  const [sseStatus, setSseStatus] = useState<'connected' | 'reconnecting' | 'error'>('connected');
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [activeUploadCount, setActiveUploadCount] = useState(0);

  useEffect(() => {
    setIsUploading(activeUploadCount > 0);
  }, [activeUploadCount]);


  const [config, setConfig] = useState<TranslationConfig>({
    provider: 'openai',
    model: 'gpt-5.4-mini',
    systemPrompt: 'Translate this Japanese manga text to English while maintaining the original tone and context.',
  });

  // Sandbox states
  const [sandboxText, setSandboxText] = useState('「お前はもう死んでいる。」');
  const [sandboxResult, setSandboxResult] = useState('');
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [sandboxTime, setSandboxTime] = useState<number | null>(null);

  const loadInitialData = useCallback(async () => {
    setBootstrapError(null);
    let failed = false;
    let errMsg = '';
    try {
      const allJobs = await mangaApi.listJobs();
      setFiles(allJobs);
    } catch (err) {
      console.error('Failed to load jobs list:', err);
      failed = true;
      errMsg += 'Failed to load jobs. ';
    }

    try {
      const allProjects = await mangaApi.listProjects();
      setProjects(allProjects);
    } catch (err) {
      console.error('Failed to load projects list:', err);
      failed = true;
      errMsg += 'Failed to load projects. ';
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
      failed = true;
      errMsg += 'Failed to load health status.';
    } finally {
      setHealthLoading(false);
    }

    if (failed) {
      setBootstrapError(errMsg);
    }
  }, []);


  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // Setup EventSource subscription for real-time updates
  useEffect(() => {
    const eventSource = new EventSource(`${API_BASE_URL}/api/stream/events`);

    const resolveUrl = (url: string | undefined): string | undefined => {
      if (!url) return undefined;
      if (url.startsWith("/")) return `${API_BASE_URL}${url}`;
      return url;
    };

    eventSource.onopen = () => {
      setSseStatus('connected');
    };

    eventSource.addEventListener('jobs', (event) => {
      try {
        const allJobs = JSON.parse(event.data) as ProcessedManga[];
        const resolvedJobs = allJobs.map((job) => ({
          ...job,
          originalUrl: resolveUrl(job.originalUrl) ?? resolveUrl(job.original_url) ?? "",
          result_url: resolveUrl(job.result_url),
          inpainted_url: resolveUrl(job.inpainted_url),
        }));

        setFiles(prev => {
          const resolvedIds = new Set(resolvedJobs.map(j => j.id));
          const localJobs = prev.filter(f => !resolvedIds.has(f.id) && (f.status === 'uploading' || f.status === 'failed'));
          return [...localJobs, ...resolvedJobs];
        });
      } catch (err) {
        console.error('Error parsing jobs from SSE:', err);
      }
    });

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
      setSseStatus('reconnecting');
      setHealthLoading(true);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const uploadBatch = useCallback(async (fileList: File[], projectId?: string) => {
    if (!fileList.length) return;
    setActiveUploadCount(prev => prev + fileList.length);

    const pendingItems = fileList.map((file, idx) => {
      const localUrl = URL.createObjectURL(file);
      const pendingJobId = `pending-${file.name}-${Date.now()}-${idx}`;
      const tempManga: ProcessedManga = {
        id: pendingJobId,
        filename: file.name,
        originalUrl: localUrl,
        original_url: localUrl,
        status: 'uploading',
        progress: 1,
        message: 'Uploading manga page...',
        project_id: projectId,
        sequence_id: idx,
      };
      return { file, localUrl, pendingJobId, tempManga };
    });

    setFiles(prev => [...pendingItems.map(p => p.tempManga), ...prev]);

    try {
      const response = await mangaApi.uploadBatch(fileList, config, projectId);
      const returnedJobs = response.jobs || [];

      setFiles(prev => {
        let updated = prev.filter(f => !pendingItems.some(p => p.pendingJobId === f.id));
        returnedJobs.forEach((job, idx) => {
          const match = pendingItems[idx];
          const localUrl = match ? match.localUrl : undefined;
          const newManga: ProcessedManga = {
            ...job,
            originalUrl: job.originalUrl || job.original_url || localUrl || '',
            original_url: job.original_url || localUrl || '',
            status: job.status || 'queued',
            progress: job.progress ?? 5,
            message: job.message || 'Queued for processing.',
            project_id: projectId,
            sequence_id: job.sequence_id ?? idx,
          };
          if (!updated.some(f => f.id === newManga.id)) {
            updated.push(newManga);
          }
        });
        return updated;
      });
    } catch (err) {
      console.error('Batch upload failed:', err);
      const errMsg = err instanceof Error ? err.message : 'Upload failed';
      setFiles(prev =>
        prev.map(f => {
          const matchedPending = pendingItems.find(p => p.pendingJobId === f.id);
          if (matchedPending) {
            return {
              ...f,
              status: 'failed',
              progress: 0,
              error: errMsg,
              project_id: projectId,
            };
          }
          return f;
        })
      );
    } finally {
      setActiveUploadCount(prev => Math.max(0, prev - fileList.length));
    }

    try {
      const health = await mangaApi.getSystemHealth();
      setSystemHealth(health);
    } catch {}
  }, [config]);

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

  const handleRemove = useCallback(async (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this translation job and all generated images?')) {
      return;
    }
    try {
      await mangaApi.deleteJob(id);
      setFiles(prev => prev.filter(f => f.id !== id));
      const health = await mangaApi.getSystemHealth();
      setSystemHealth(health);
    } catch (err) {
      console.error('Delete job failed:', err);
      setFiles(prev => prev.filter(f => f.id !== id));
    }
  }, []);

  const handleMovePage = useCallback(async (projectId: string, jobId: string, direction: 'up' | 'down') => {
    const proj = projects.find(p => p.id === projectId);
    if (!proj) return;
    
    const projJobs = files.filter(f => f.project_id === projectId);
    const order = proj.page_order && proj.page_order.length > 0
      ? [...proj.page_order]
      : projJobs.map(f => f.id);
      
    projJobs.forEach(job => {
      if (!order.includes(job.id)) {
        order.push(job.id);
      }
    });
    
    const index = order.indexOf(jobId);
    if (index === -1) return;
    
    if (direction === 'up' && index > 0) {
      const temp = order[index];
      order[index] = order[index - 1];
      order[index - 1] = temp;
    } else if (direction === 'down' && index < order.length - 1) {
      const temp = order[index];
      order[index] = order[index + 1];
      order[index + 1] = temp;
    } else {
      return;
    }
    
    try {
      const updatedProj = await mangaApi.reorderProjectPages(projectId, order);
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, page_order: updatedProj.page_order, job_ids: updatedProj.job_ids } : p));
    } catch (err) {
      console.error('Failed to reorder project pages:', err);
    }
  }, [projects, files]);

  const handleMovePageTo = useCallback(async (projectId: string, jobId: string, targetPosition: number) => {
    const proj = projects.find(p => p.id === projectId);
    if (!proj) return;
    
    const projJobs = files.filter(f => f.project_id === projectId);
    const order = proj.page_order && proj.page_order.length > 0
      ? [...proj.page_order]
      : projJobs.map(f => f.id);
      
    projJobs.forEach(job => {
      if (!order.includes(job.id)) {
        order.push(job.id);
      }
    });
    
    const index = order.indexOf(jobId);
    if (index === -1) return;
    
    order.splice(index, 1);
    
    const targetIdx = Math.max(0, Math.min(order.length, targetPosition - 1));
    order.splice(targetIdx, 0, jobId);
    
    try {
      const updatedProj = await mangaApi.reorderProjectPages(projectId, order);
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, page_order: updatedProj.page_order, job_ids: updatedProj.job_ids } : p));
    } catch (err) {
      console.error('Failed to reorder project pages:', err);
    }
  }, [projects, files]);

  const handleRenameProject = useCallback(async (projectId: string, newName: string) => {
    if (!newName.trim()) return;
    try {
      const updatedProj = await mangaApi.renameProject(projectId, newName.trim());
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, name: updatedProj.name } : p));
    } catch (err) {
      console.error('Failed to rename project:', err);
    }
  }, []);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    if (!confirm('Are you sure you want to delete this project session? Sheets inside this session will NOT be deleted, but they will be unlinked.')) {
      return;
    }
    try {
      await mangaApi.deleteProject(projectId);
      setProjects(prev => prev.filter(p => p.id !== projectId));
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
      }
      setFiles(prev => prev.map(f => f.project_id === projectId ? { ...f, project_id: undefined } : f));
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  }, [activeProjectId]);

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
    } catch (err) {
      const axiosError = err as { response?: { data?: { detail?: string } }; message?: string };
      setSandboxError(axiosError.response?.data?.detail || axiosError.message || 'Translation sandbox failed.');
    } finally {
      setSandboxLoading(false);
    }
  };

  return (
    <MangaTranslatorContext.Provider
      value={{
        files,
        setFiles,
        projects,
        setProjects,
        activeProjectId,
        setActiveProjectId,
        systemHealth,
        setSystemHealth,
        healthLoading,
        setHealthLoading,
        isUploading,
        setIsUploading,
        isDragging,
        setIsDragging,
        config,
        setConfig,
        sandboxText,
        setSandboxText,
        sandboxResult,
        setSandboxResult,
        sandboxLoading,
        setSandboxLoading,
        sandboxError,
        setSandboxError,
        sandboxTime,
        setSandboxTime,
        loadInitialData,
        uploadBatch,
        handleUpdate,
        handleRemove,
        handleMovePage,
        handleMovePageTo,
        handleRenameProject,
        handleDeleteProject,
        runSandboxTest,
        activeHITLItem,
        setActiveHITLItem,
        sseStatus,
        bootstrapError,
        activeUploadCount,
      }}
    >
      {children}
    </MangaTranslatorContext.Provider>
  );
};

export const useMangaTranslator = () => {
  const context = useContext(MangaTranslatorContext);
  if (context === undefined) {
    throw new Error('useMangaTranslator must be used within a MangaTranslatorProvider');
  }
  return context;
};
