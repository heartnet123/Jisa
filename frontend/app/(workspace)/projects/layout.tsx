'use client';

import React, { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Icon } from '@iconify-icon/react';
import { useMangaTranslator } from '@/features/manga-translator/context/MangaTranslatorContext';
import { mangaApi } from '@/features/manga-translator/api/mangaApi';

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const params = useParams();
  const activeProjectId = params.id as string | undefined;

  const {
    projects,
    setProjects,
    files
  } = useMangaTranslator();

  const [newProjectName, setNewProjectName] = useState('');

  const cn = (...inputs: (string | boolean | undefined)[]) => inputs.filter(Boolean).join(" ");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 max-w-6xl mx-auto w-full p-8 overflow-hidden h-full">
      {/* Left Side: Project Manager */}
      <div className="lg:col-span-1 space-y-6 overflow-y-auto h-full pr-2 select-none">
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
                setNewProjectName('');
                router.push(`/projects/${proj.id}`);
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
                    onClick={() => router.push(`/projects/${proj.id}`)}
                    className={cn(
                      "w-full p-3 border rounded text-left transition-all duration-300 font-mono text-xs block group relative cursor-pointer",
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

      {/* Right Side Workspace Details */}
      <div className="lg:col-span-3 overflow-y-auto h-full pr-1">
        {children}
      </div>
    </div>
  );
}
