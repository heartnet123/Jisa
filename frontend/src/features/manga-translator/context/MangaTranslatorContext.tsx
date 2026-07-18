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
          const uploadingJobs = prev.filter(f => f.status === 'uploading');
          return [...uploadingJobs, ...resolvedJobs];
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
        handleRenameProject,
        handleDeleteProject,
        runSandboxTest,
        activeHITLItem,
        setActiveHITLItem,
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
