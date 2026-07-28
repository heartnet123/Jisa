'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@iconify-icon/react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useMangaTranslator, ALLOWED_IMAGE_TYPES } from '../context/MangaTranslatorContext';
import { MangaFileItem } from './MangaFileItem';
import { BYOKSettingsModal } from './BYOKSettingsModal';
import { mangaApi } from '../api/mangaApi';
import { getBYOKConfig } from '../api/byok';
import { BYOKConfig } from '../types/byok';

interface ProjectWorkspaceProps {
  projectId?: string;
}

const PageOrderInput: React.FC<{
  currentIndex: number;
  maxPages: number;
  onMove: (targetPosition: number) => void;
}> = ({ currentIndex, maxPages, onMove }) => {
  const [val, setVal] = useState((currentIndex + 1).toString());
  
  useEffect(() => {
    setVal((currentIndex + 1).toString());
  }, [currentIndex]);

  const handleSubmit = () => {
    const target = parseInt(val, 10);
    if (!isNaN(target) && target >= 1 && target <= maxPages && target !== currentIndex + 1) {
      onMove(target);
    } else {
      setVal((currentIndex + 1).toString());
    }
  };

  return (
    <div className="pt-1.5 flex flex-col items-center gap-1 font-mono">
      <span className="text-[7px] text-[#555] uppercase tracking-wider font-bold">MOVE TO</span>
      <input
        type="number"
        min={1}
        max={maxPages}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            handleSubmit();
          }
        }}
        onBlur={handleSubmit}
        className="w-10 text-center text-[10px] bg-[#151515] border border-[#222] hover:border-[#333] focus:border-cyan-500/50 rounded text-white focus:outline-none py-0.5 font-bold"
      />
    </div>
  );
};

export const ProjectWorkspace: React.FC<ProjectWorkspaceProps> = ({ projectId }) => {
  const router = useRouter();
  const shouldReduceMotion = useReducedMotion();

  const {
    files,
    projects,
    setProjects,
    isDragging,
    setIsDragging,
    isUploading,
    uploadBatch,
    handleUpdate,
    handleRemove,
    handleMovePage,
    handleMovePageTo,
    handleRenameProject,
    handleDeleteProject,
    sseStatus,
    bootstrapError
  } = useMangaTranslator();

  // Local state for project search query
  const [projectSearchQuery, setProjectSearchQuery] = useState('');

  // Local state for project creation
  const [newProjectName, setNewProjectName] = useState('');
  const [isSubmittingProject, setIsSubmittingProject] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const [isCreateProjectModalOpen, setIsCreateProjectModalOpen] = useState(false);

  // Local state for project renaming
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState('');

  // Local state for invalid file alerts
  const [rejectedFiles, setRejectedFiles] = useState<string[]>([]);

  // BYOK Modal state
  const [isBYOKModalOpen, setIsBYOKModalOpen] = useState(false);
  const [byokConfig, setByokConfig] = useState<BYOKConfig | null>(null);

  useEffect(() => {
    setByokConfig(getBYOKConfig());
  }, []);

  // Local state for catalogue status filter
  type CatalogueStatusFilter = 'all' | 'awaiting_review' | 'failed' | 'completed' | 'processing';
  const [catalogueStatusFilter, setCatalogueStatusFilter] = useState<CatalogueStatusFilter>('all');

  // Find active project
  const activeProj = projectId ? projects.find(p => p.id === projectId) : null;

  // Track dragging state locally for input drag events
  const [localDragging, setLocalDragging] = useState(false);

  // Animation settings
  const transitionSettings = shouldReduceMotion ? { duration: 0 } : { duration: 0.25 };

  // Sync edit name state when active project changes
  useEffect(() => {
    if (activeProj) {
      setEditingProjectName(activeProj.name);
    }
  }, [activeProj]);

  // Utility class helper
  const cn = (...inputs: (string | boolean | undefined)[]) => inputs.filter(Boolean).join(" ");

  // Handle project creation
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setIsSubmittingProject(true);
    setCreateProjectError(null);
    try {
      const proj = await mangaApi.createProject(newProjectName.trim());
      setProjects(prev => [proj, ...prev]);
      setNewProjectName('');
      setIsCreateProjectModalOpen(false);
      router.push(`/projects/${proj.id}`);
    } catch (err) {
      console.error('Failed to create project:', err);
      setCreateProjectError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setIsSubmittingProject(false);
    }
  };

  // Handle dropped files
  const handleFilesSelection = useCallback((selectedFiles: FileList | File[]) => {
    if (!projectId) return;
    const fileList = Array.from(selectedFiles);
    const validFiles: File[] = [];
    const invalidAlerts: string[] = [];

    fileList.forEach(file => {
      if (ALLOWED_IMAGE_TYPES.includes(file.type)) {
        validFiles.push(file);
      } else {
        invalidAlerts.push(`${file.name} (Unsupported file type: ${file.type || 'unknown'})`);
      }
    });

    if (invalidAlerts.length > 0) {
      setRejectedFiles(prev => [...prev, ...invalidAlerts]);
    }

    if (validFiles.length > 0) {
      uploadBatch(validFiles, projectId);
    }
  }, [projectId, uploadBatch]);

  // Uploader drag and drop events
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (isUploading) return;
    setLocalDragging(true);
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setLocalDragging(false);
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setLocalDragging(false);
    setIsDragging(false);
    if (isUploading) return;
    if (e.dataTransfer.files) {
      handleFilesSelection(e.dataTransfer.files);
    }
  };

  // Filter projects based on query
  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(projectSearchQuery.toLowerCase()) || 
    p.id.toLowerCase().includes(projectSearchQuery.toLowerCase())
  );

  // 1. Landing View (No Project ID provided)
  if (!projectId) {
    return (
      <div className="flex-1 overflow-y-auto p-8">
        <motion.div
          initial={shouldReduceMotion ? {} : { opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transitionSettings}
          className="max-w-6xl mx-auto space-y-8"
        >
          {/* Header */}
          <div className="border-b border-border pb-6">
            <h2 className="text-2xl font-black tracking-tight uppercase font-mono text-main">
              Project Ingestion Studio
            </h2>
            <p className="text-xs text-muted font-mono uppercase tracking-widest mt-1">
              Select or initialize a localized translation session
            </p>
          </div>

          {/* Alert regions */}
          {bootstrapError && (
            <div role="alert" className="p-4 border border-red-500/35 bg-red-500/10 rounded-lg flex items-center gap-3 text-xs font-mono text-red-500">
              <Icon icon="solar:danger-triangle-linear" className="text-lg" />
              <span>Failed to fetch projects: {bootstrapError}</span>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-3">
              <span className="font-mono text-xs text-muted uppercase tracking-widest font-black block">
                Project Sessions ({projects.length})
              </span>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="relative w-full sm:w-60">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-muted">
                    <Icon icon="solar:magnifier-linear" />
                  </span>
                  <input
                    type="text"
                    placeholder="Search sessions..."
                    value={projectSearchQuery}
                    onChange={(e) => setProjectSearchQuery(e.target.value)}
                    className="w-full text-xs font-mono pl-9 pr-3 py-1.5 border border-border bg-surface rounded text-main focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCreateProjectError(null);
                    setIsCreateProjectModalOpen(true);
                  }}
                  className="px-3.5 py-1.5 bg-accent hover:bg-accent-hover text-white font-mono text-xs font-bold uppercase tracking-wider rounded transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
                >
                  <Icon icon="solar:add-circle-linear" className="text-sm" />
                  <span>Create Project</span>
                </button>
              </div>
            </div>

            {projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-20 border border-dashed border-border bg-panel/40 rounded-lg text-center">
                <Icon icon="solar:folder-open-linear" className="text-5xl text-muted mb-4" />
                <span className="font-mono text-xs text-muted uppercase tracking-widest block font-black">
                  No Project Sessions Found
                </span>
                <p className="text-xs text-subtle font-mono mt-2 uppercase max-w-xs leading-relaxed">
                  Create a new project session to start batching translations.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setCreateProjectError(null);
                    setIsCreateProjectModalOpen(true);
                  }}
                  className="mt-4 px-4 py-2 bg-accent hover:bg-accent-hover text-white font-mono text-xs font-bold uppercase tracking-wider rounded transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Icon icon="solar:add-circle-linear" className="text-sm" />
                  <span>Create Project</span>
                </button>
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-20 border border-dashed border-border bg-panel/20 rounded-lg text-center">
                <Icon icon="solar:minimalistic-magnifier-linear" className="text-5xl text-muted mb-4" />
                <span className="font-mono text-xs text-muted uppercase tracking-widest block font-black">
                  No Matching Sessions
                </span>
                <p className="text-xs text-subtle font-mono mt-2 uppercase max-w-xs leading-relaxed">
                  Try adjusting your search filters to find existing project sessions.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredProjects.map((proj) => {
                  const projJobs = files.filter(f => f.project_id === proj.id);
                  const pagesCompleted = projJobs.filter(f => f.status === 'completed').length;
                  const progress = projJobs.length > 0 ? Math.round((pagesCompleted / projJobs.length) * 100) : 0;

                  return (
                    <button
                      key={proj.id}
                      onClick={() => router.push(`/projects/${proj.id}`)}
                      className="p-5 bg-panel border border-border hover:border-accent text-left rounded-lg transition-all duration-300 font-mono text-xs group cursor-pointer relative overflow-hidden flex flex-col justify-between h-40 focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <div className="space-y-1 w-full">
                        <div className="flex justify-between items-start gap-2">
                          <span className="font-bold text-main uppercase text-sm truncate group-hover:text-accent transition-colors pr-6">
                            {proj.name}
                          </span>
                          <Icon icon="solar:arrow-right-linear" className="text-lg text-muted group-hover:text-accent transition-colors group-hover:translate-x-1" />
                        </div>
                      </div>

                      <div className="w-full space-y-3">
                        <div className="flex justify-between items-center text-xs text-muted">
                          <span>{projJobs.length} pages total</span>
                          <span className="text-accent font-bold">{progress}% done</span>
                        </div>

                        {/* Simple Project progress bar */}
                        <div className="h-1 bg-surface rounded-full overflow-hidden w-full">
                          <div
                            className="h-full bg-accent transition-all duration-500"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>

                      <div className="text-xs text-subtle mt-1">
                        Created: {new Date(proj.created_at).toLocaleDateString()}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Create Project Modal */}
          <AnimatePresence>
            {isCreateProjectModalOpen && (
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="create-project-title"
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setIsCreateProjectModalOpen(false);
                    setCreateProjectError(null);
                  }
                }}
                onClick={() => {
                  setIsCreateProjectModalOpen(false);
                  setCreateProjectError(null);
                }}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 10 }}
                  transition={{ duration: 0.2 }}
                  className="w-full max-w-md bg-panel border border-border rounded-lg shadow-2xl p-6 space-y-5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between items-center border-b border-border pb-3">
                    <h3 id="create-project-title" className="font-mono text-sm font-black text-main uppercase tracking-wider flex items-center gap-2">
                      <Icon icon="solar:folder-with-files-linear" className="text-base text-accent" />
                      Create Project
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCreateProjectModalOpen(false);
                        setCreateProjectError(null);
                      }}
                      className="text-muted hover:text-main text-lg transition-colors cursor-pointer"
                      aria-label="Close modal"
                    >
                      <Icon icon="solar:close-circle-linear" />
                    </button>
                  </div>

                  <form onSubmit={handleCreateProject} className="space-y-4">
                    <div className="space-y-2">
                      <label htmlFor="modal-project-name" className="text-xs text-muted uppercase tracking-widest font-mono font-bold block">
                        Project Title
                      </label>
                      <input
                        id="modal-project-name"
                        type="text"
                        placeholder="Chapter 1, Volume 1..."
                        value={newProjectName}
                        onChange={(e) => setNewProjectName(e.target.value)}
                        className="w-full text-xs font-mono px-3 py-2.5 border border-border bg-surface rounded text-main focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all uppercase"
                        disabled={isSubmittingProject}
                        autoFocus
                        required
                      />
                    </div>

                    {createProjectError && (
                      <div role="alert" className="p-2.5 border border-red-500/30 bg-red-500/10 text-xs font-mono text-red-400 rounded flex items-center gap-2">
                        <Icon icon="solar:danger-triangle-linear" className="text-sm shrink-0" />
                        <span>{createProjectError}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreateProjectModalOpen(false);
                          setCreateProjectError(null);
                        }}
                        className="px-4 py-2 border border-border hover:bg-surface text-muted hover:text-main font-mono text-xs font-bold uppercase tracking-wider rounded transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!newProjectName.trim() || isSubmittingProject}
                        className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:bg-panel disabled:text-muted text-white font-mono text-xs font-bold uppercase tracking-wider rounded transition-colors cursor-pointer flex items-center justify-center gap-2"
                      >
                        {isSubmittingProject ? (
                          <>
                            <Icon icon="eos-icons:loading" className="text-sm" />
                            Creating...
                          </>
                        ) : (
                          <>
                            <Icon icon="solar:add-circle-linear" className="text-sm" />
                            Create Project
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    );
  }

  // 2. Scoped Workspace View (Project ID provided)
  if (!activeProj) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#070707]">
        <div className="bg-[#0b0b0b] border border-[#1c1c1c] rounded-lg p-16 flex flex-col items-center justify-center space-y-4 max-w-md w-full">
          <Icon icon="eos-icons:loading" className="text-3xl text-cyan-500 animate-spin" />
          <p className="text-[#555] font-mono text-xs uppercase tracking-widest mt-1">
            Hydrating chapter session workspace...
          </p>
        </div>
      </div>
    );
  }

  // Constant for processing statuses
  const PROCESSING_STATUSES = ['queued', 'segmenting', 'ocr', 'translating', 'inpainting', 'typesetting', 'uploading'];

  // Filter project specific files
  let activeProjJobs = files.filter(f => f.project_id === projectId);
  
  // Sort pages using single precomputed rank per job
  const pageOrderMap = new Map((activeProj.page_order || []).map((id, idx) => [id, idx]));
  const getJobRank = (job: ProcessedManga) => {
    if (job.sequence_id !== undefined) return job.sequence_id;
    if (pageOrderMap.has(job.id)) return pageOrderMap.get(job.id)!;
    return Number.MAX_SAFE_INTEGER;
  };
  activeProjJobs = [...activeProjJobs].sort((a, b) => getJobRank(a) - getJobRank(b));

  // Stats calculation
  const completedCount = activeProjJobs.filter(f => f.status === 'completed').length;
  const processingCount = activeProjJobs.filter(f => PROCESSING_STATUSES.includes(f.status)).length;
  const failedCount = activeProjJobs.filter(f => ['failed', 'error'].includes(f.status)).length;
  const awaitingReviewCount = activeProjJobs.filter(f => f.status === 'awaiting_review').length;
  
  // Grouped pages with actual indices
  const indexedJobs = activeProjJobs.map((file, index) => ({ file, index }));
  const inPipeline = indexedJobs.filter(item => PROCESSING_STATUSES.includes(item.file.status));

  // Filtered catalogue jobs based on active status filter
  const filteredCatalogueJobs = indexedJobs.filter(({ file }) => {
    if (catalogueStatusFilter === 'all') return true;
    if (catalogueStatusFilter === 'awaiting_review') return file.status === 'awaiting_review';
    if (catalogueStatusFilter === 'failed') return ['failed', 'error'].includes(file.status);
    if (catalogueStatusFilter === 'completed') return file.status === 'completed';
    if (catalogueStatusFilter === 'processing') return PROCESSING_STATUSES.includes(file.status);
    if (catalogueStatusFilter === 'attention') return file.status === 'awaiting_review' || ['failed', 'error'].includes(file.status);
    return true;
  });

  const handleDelete = async () => {
    if (confirm(`Confirm deletion of project "${activeProj.name}"? All member pages and images will be permanently deleted from disk.`)) {
      await handleDeleteProject(projectId);
      router.push('/projects');
    }
  };

  const uploadingFiles = files.filter(f => f.status === 'uploading' && f.project_id === projectId);

  return (
    <div className="flex-1 overflow-y-auto p-8 relative">
      <motion.div
        initial={shouldReduceMotion ? {} : { opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transitionSettings}
        className="max-w-6xl mx-auto space-y-6 pb-12"
      >
        {/* Back navigation & Header */}
        <div className="flex justify-between items-center border-b border-border pb-4">
          <button
            onClick={() => router.push('/projects')}
            className="flex min-h-11 items-center gap-1.5 px-3 py-1.5 border border-border bg-surface hover:bg-panel transition-all rounded text-xs font-mono uppercase tracking-widest text-main cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <Icon icon="solar:arrow-left-linear" /> Back to projects
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsBYOKModalOpen(true)}
              className="flex min-h-11 items-center gap-1.5 px-3 py-1.5 border border-accent/30 bg-accent-surface hover:bg-accent/20 text-accent transition-all rounded text-xs font-mono uppercase tracking-widest cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent shadow-sm"
            >
              <Icon icon="solar:key-minimalistic-square-bold-duotone" className="text-sm text-accent" />
              <span>BYOK AI Key</span>
              {byokConfig && (
                <span className="ml-1 px-1.5 py-0.5 rounded bg-accent/20 text-accent text-xs font-bold border border-accent/30">
                  {byokConfig.provider}:{byokConfig.model}
                </span>
              )}
            </button>

            <span className="text-xs text-subtle font-mono uppercase tracking-widest hidden sm:inline font-medium">
              Project-First Session Workspace
            </span>
          </div>
        </div>

        {/* Project Header Info and Stats */}
        <div className="bg-panel border border-border p-6 rounded-lg flex flex-wrap justify-between items-center gap-4">
          <div className="space-y-1">
            {isEditingProjectName ? (
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  if (editingProjectName.trim()) {
                    handleRenameProject(activeProj.id, editingProjectName.trim());
                    setIsEditingProjectName(false);
                  }
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={editingProjectName}
                  onChange={(e) => setEditingProjectName(e.target.value)}
                  className="text-xs font-mono px-3 py-1.5 border border-accent bg-surface rounded text-main focus:outline-none uppercase"
                  autoFocus
                  required
                />
                <button
                  type="submit"
                  className="p-2 min-h-11 min-w-11 bg-accent hover:bg-accent-hover text-white rounded flex items-center justify-center cursor-pointer transition-colors"
                  title="Save Name"
                >
                  <Icon icon="solar:check-circle-linear" className="text-xs font-bold" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingProjectName(activeProj.name);
                    setIsEditingProjectName(false);
                  }}
                  className="p-2 min-h-11 min-w-11 border border-border hover:border-red-500 hover:text-red-500 rounded flex items-center justify-center cursor-pointer transition-colors"
                  title="Cancel"
                >
                  <Icon icon="solar:close-square-linear" className="text-xs" />
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-2 group/title">
                <h3 className="text-base font-black tracking-tight text-main uppercase font-mono">
                  {activeProj.name}
                </h3>
                <button
                  onClick={() => {
                    setEditingProjectName(activeProj.name);
                    setIsEditingProjectName(true);
                  }}
                  className="opacity-0 group-hover/title:opacity-100 p-1 text-muted hover:text-accent rounded transition-all cursor-pointer"
                  title="Rename Session"
                >
                  <Icon icon="solar:pen-new-square-linear" className="text-xs" />
                </button>
              </div>
            )}
            <p className="text-xs text-subtle font-mono uppercase tracking-widest font-medium">
              ID: {projectId} {"//"} Created: {new Date(activeProj.created_at).toLocaleString()}
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex gap-2 font-mono text-xs">
              <button 
                onClick={() => setCatalogueStatusFilter(catalogueStatusFilter === 'completed' ? 'all' : 'completed')}
                aria-pressed={catalogueStatusFilter === 'completed'}
                className={`bg-surface border ${catalogueStatusFilter === 'completed' ? 'border-accent text-accent font-bold' : 'border-border hover:border-accent/40'} px-3 py-2 rounded text-left cursor-pointer transition-colors`}
                title="Filter catalogue by Processed sheets"
              >
                <span className="text-muted uppercase block text-xs font-bold">Processed</span>
                <span className="text-green-600 dark:text-green-400 font-bold text-sm">{completedCount}</span>
                <span className="text-subtle text-xs"> / {activeProjJobs.length} pages</span>
              </button>
              <button 
                onClick={() => setCatalogueStatusFilter(catalogueStatusFilter === 'processing' ? 'all' : 'processing')}
                aria-pressed={catalogueStatusFilter === 'processing'}
                className={`bg-surface border ${catalogueStatusFilter === 'processing' ? 'border-accent text-accent font-bold' : 'border-border hover:border-accent/40'} px-3 py-2 rounded text-left cursor-pointer transition-colors`}
                title="Filter catalogue by In Progress sheets"
              >
                <span className="text-muted uppercase block text-xs font-bold">In Progress</span>
                <span className="text-accent font-bold text-sm">{processingCount}</span>
                <span className="text-subtle text-xs"> active</span>
              </button>
              {(failedCount > 0 || awaitingReviewCount > 0) && (
                <button 
                  onClick={() => setCatalogueStatusFilter(catalogueStatusFilter === 'attention' ? 'all' : 'attention')}
                  aria-pressed={catalogueStatusFilter === 'attention'}
                  className={`bg-surface border ${catalogueStatusFilter === 'attention' ? 'border-yellow-500 text-yellow-500 font-bold' : 'border-border hover:border-yellow-500/50'} px-3 py-2 rounded text-left cursor-pointer transition-colors`}
                  title="Filter catalogue by Attention items"
                >
                  <span className="text-muted uppercase block text-xs font-bold">Attention</span>
                  <span className="text-yellow-600 dark:text-yellow-400 font-bold text-sm">{failedCount + awaitingReviewCount}</span>
                  <span className="text-subtle text-xs"> items</span>
                </button>
              )}
            </div>

            <button
              onClick={handleDelete}
              className="px-3 py-2 min-h-11 border border-border hover:border-red-500/50 hover:text-red-500 hover:bg-red-500/5 transition-all text-xs font-mono uppercase tracking-widest rounded flex items-center gap-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-red-500"
              title="Delete Project Session"
            >
              <Icon icon="solar:trash-bin-trash-linear" className="text-xs" />
              Delete
            </button>
          </div>
        </div>

        {/* Semantic step indicator rail */}
        <nav aria-label="Project stage progress" className="flex items-center gap-2 bg-panel border border-border p-4 rounded-lg">
          {[
            { id: 'upload', label: '1. Ingestion / Upload', active: activeProjJobs.length === 0 || isUploading },
            { id: 'pipeline', label: '2. Pipeline Processing', active: processingCount > 0 },
            { id: 'review', label: '3. Human Review Studio', active: awaitingReviewCount > 0 },
            { id: 'finalized', label: '4. Final Publication', active: completedCount > 0 && processingCount === 0 && awaitingReviewCount === 0 }
          ].map(step => (
            <div 
              key={step.id}
              aria-current={step.active ? "step" : undefined}
              className={cn(
                "flex-1 text-center py-2 text-[9px] font-mono font-bold rounded uppercase tracking-wider transition-all border",
                step.active 
                  ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/30 font-black shadow-[0_0_10px_rgba(6,182,212,0.05)]" 
                  : "bg-transparent text-[#444] border-transparent"
              )}
            >
              {step.label}
            </div>
          ))}
        </nav>

        {/* File Ingestion region (Native input + Drag and Drop) */}
        <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-6 rounded-lg space-y-4">
          <span className="font-mono text-xs text-[#666] uppercase tracking-widest font-bold block">
            Ingestion Console
          </span>

          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={cn(
              "relative group border border-dashed rounded-lg transition-all duration-500 flex flex-col items-center justify-center p-12 bg-[#0a0a0a]",
              localDragging ? "border-cyan-500 bg-cyan-500/5 shadow-[0_0_20px_rgba(6,182,212,0.1)]" : "border-[#222] hover:border-cyan-500/30",
              isUploading && "animate-pulse cursor-wait"
            )}
          >
            <label htmlFor="manga-file-upload" className="flex flex-col items-center justify-center cursor-pointer w-full h-full relative z-10 text-center">
              <div className="w-12 h-12 rounded-full bg-surface border border-border group-hover:border-accent/40 flex items-center justify-center mx-auto mb-3 transition-all duration-300">
                <Icon 
                  icon={isUploading ? "eos-icons:loading" : "solar:upload-minimalistic-linear"}
                  className={cn("text-2xl text-muted transition-colors group-hover:text-accent", isDragging && "text-accent")}
                />
              </div>
              <h4 className="text-xs font-bold uppercase tracking-tight text-main mb-1 font-mono">
                {isUploading ? "Uploading Batch..." : "Drop images here or click to upload"}
              </h4>
              <p className="text-subtle font-mono text-xs uppercase tracking-wider mb-2">
                Support: PNG // JPG // WEBP // BMP // TIFF (Multi-Select)
              </p>
              <input
                id="manga-file-upload"
                type="file"
                multiple
                accept={ALLOWED_IMAGE_TYPES.join(',')}
                onChange={(e) => {
                  if (e.target.files) {
                    handleFilesSelection(e.target.files);
                  }
                }}
                className="sr-only"
                aria-label="Upload manga page sheets to current project"
              />
            </label>
          </div>

          {/* Uploading Files queue list */}
          {uploadingFiles.length > 0 && (
            <div className="border border-border rounded bg-panel divide-y divide-border font-mono text-xs mt-4">
              <div className="p-3 text-xs text-muted uppercase tracking-wider bg-surface flex justify-between items-center font-bold">
                <span>Uploading queue (กำลังอัปโหลด)</span>
                <span className="text-accent font-bold">{uploadingFiles.length} files</span>
              </div>
              {uploadingFiles.map((file) => (
                <div key={file.id} className="p-3 flex justify-between items-center">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon icon="eos-icons:loading" className="animate-spin text-accent shrink-0" />
                    <span className="text-main font-bold truncate max-w-xs">{file.filename}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="w-24 h-1.5 bg-surface rounded overflow-hidden">
                      <div className="bg-accent h-full transition-all duration-300" style={{ width: `${file.progress}%` }} />
                    </div>
                    <span className="text-xs text-muted font-bold w-8 text-right">{file.progress}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Rejected file warnings */}
          <AnimatePresence>
            {rejectedFiles.length > 0 && (
              <motion.div
                initial={shouldReduceMotion ? {} : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={shouldReduceMotion ? {} : { opacity: 0, height: 0 }}
                role="alert"
                className="p-4 border border-yellow-500/35 bg-yellow-500/10 rounded-lg space-y-2 text-xs font-mono text-yellow-600 dark:text-yellow-400 relative"
              >
                <div className="flex justify-between items-center border-b border-yellow-500/20 pb-2">
                  <span className="font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <Icon icon="solar:danger-triangle-linear" /> Unsupported Files Rejected
                  </span>
                  <button
                    onClick={() => setRejectedFiles([])}
                    className="p-1 hover:text-main rounded cursor-pointer"
                    title="Dismiss alert"
                  >
                    <Icon icon="solar:close-square-linear" />
                  </button>
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[11px] leading-relaxed">
                  {rejectedFiles.map((fileMsg, idx) => (
                    <li key={idx}>{fileMsg}</li>
                  ))}
                </ul>
                <p className="text-[10px] text-yellow-500/70 pt-1 uppercase">
                  Supported formats: PNG, JPEG, WEBP, BMP, TIFF. Non-image document extensions are bypassed.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Active processing queue */}
        {inPipeline.length > 0 && (
          <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-6 rounded-lg space-y-4">
            <div className="flex items-center justify-between border-b border-[#1c1c1c] pb-3">
              <span className="font-mono text-xs text-cyan-400 uppercase tracking-widest font-bold flex items-center gap-2">
                <span className="w-2 h-2 bg-cyan-500 rounded-full animate-ping" />
                Active Pipelines ({inPipeline.length})
              </span>
              <span className="text-[9px] font-mono text-[#444] uppercase tracking-widest">
                Real-Time Synthesis
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[300px] overflow-y-auto pr-1">
              {inPipeline.map(({ file }) => (
                <div key={file.id} className="p-4 bg-[#0a0a0a] border border-[#1c1c1c] rounded relative overflow-hidden group shadow space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs truncate max-w-[150px] font-bold text-white uppercase tracking-wider">
                      {file.filename}
                    </span>
                    <span className="text-[8px] font-mono font-bold bg-[#111] px-2 py-0.5 border border-[#222] uppercase tracking-wider text-cyan-400">
                      {file.status}
                    </span>
                  </div>
                  <p className="text-[10px] text-[#666] font-mono uppercase tracking-tighter truncate">
                    {file.message || "Synthesis initial logic..."}
                  </p>

                  {/* ARIA Progressbar */}
                  <div className="flex items-center gap-3">
                    <div 
                      role="progressbar"
                      aria-valuenow={file.progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="h-1.5 bg-[#111] w-full rounded overflow-hidden relative"
                    >
                      <motion.div 
                        className="h-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]"
                        initial={{ width: 0 }}
                        animate={{ width: `${file.progress}%` }}
                        transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.5 }}
                      />
                    </div>
                    <span className="text-[9px] font-mono text-[#555] font-bold w-8 text-right">{file.progress}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Project catalogue layout */}
        <div className="space-y-6">
          <div className="border-b border-[#1c1c1c] pb-3 flex flex-wrap justify-between items-center gap-3">
            <span className="font-mono text-xs text-[#666] uppercase tracking-widest font-black block">
              Chapter Catalogue ({activeProjJobs.length} Sheets)
            </span>

            {/* Status Filter Tabs */}
            <div className="flex items-center gap-1.5 font-mono text-xs overflow-x-auto py-1">
              {[
                { id: 'all', label: 'All', count: activeProjJobs.length, color: 'text-main' },
                { id: 'awaiting_review', label: 'Awaiting Review', count: awaitingReviewCount, color: 'text-yellow-500' },
                { id: 'failed', label: 'Failed', count: failedCount, color: 'text-red-500' },
                { id: 'completed', label: 'Completed', count: completedCount, color: 'text-green-500' },
                { id: 'processing', label: 'Processing', count: processingCount, color: 'text-accent' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setCatalogueStatusFilter(tab.id as CatalogueStatusFilter)}
                  className={cn(
                    "px-2.5 py-1 rounded text-xs uppercase tracking-wider font-bold transition-all flex items-center gap-1.5 border cursor-pointer",
                    catalogueStatusFilter === tab.id
                      ? "bg-accent/15 border-accent text-accent shadow-sm"
                      : "bg-surface border-border hover:bg-panel text-muted hover:text-main"
                  )}
                  title={`Filter catalogue by ${tab.label}`}
                >
                  <span>{tab.label}</span>
                  <span className={cn("px-1.5 py-0.5 text-[10px] rounded bg-surface border border-border font-extrabold", tab.color)}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {activeProjJobs.length === 0 ? (
            <div className="p-16 border border-dashed border-[#1c1c1c] text-center text-xs text-[#555] font-mono uppercase bg-[#080808]/50 rounded-lg">
              No sheets loaded in this session
              <span className="block text-[9px] text-[#444] mt-2 leading-relaxed">
                Add manga page sheets using the ingestion console above to begin pipeline synthesis.
              </span>
            </div>
          ) : filteredCatalogueJobs.length === 0 ? (
            <div className="p-12 border border-dashed border-[#1c1c1c] text-center text-xs text-[#555] font-mono uppercase bg-[#080808]/50 rounded-lg space-y-3">
              <p className="font-bold text-muted">No sheets match status filter "{catalogueStatusFilter.replace('_', ' ')}"</p>
              <button
                onClick={() => setCatalogueStatusFilter('all')}
                className="px-3 py-1.5 bg-surface border border-border hover:border-accent hover:text-accent rounded text-xs uppercase tracking-wider font-bold transition-all cursor-pointer"
              >
                Clear Filter (Show All {activeProjJobs.length} Sheets)
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 pl-4 border-l border-cyan-950/30">
                {filteredCatalogueJobs.map(({ file, index }) => (
                  <div key={file.id} className="flex items-start gap-4">
                    <div className="flex flex-col items-center justify-center bg-[#0d0d0d] border border-[#1a1a1a] rounded p-2 min-w-[70px] h-28 shrink-0 font-mono">
                      <span className="text-[8px] text-[#555] uppercase tracking-wider font-bold">PAGE</span>
                      <span className="text-base font-black text-cyan-400">#{index + 1}</span>
                      <PageOrderInput 
                        currentIndex={index} 
                        maxPages={activeProjJobs.length} 
                        onMove={(targetPos) => handleMovePageTo(projectId, file.id, targetPos)} 
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <MangaFileItem 
                        item={file} 
                        onUpdate={handleUpdate} 
                        onRemove={handleRemove} 
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>

      <BYOKSettingsModal
        isOpen={isBYOKModalOpen}
        onClose={() => setIsBYOKModalOpen(false)}
        onConfigSaved={(cfg) => setByokConfig(cfg)}
      />
    </div>
  );
};

export default ProjectWorkspace;
