'use client';

import React from 'react';
import { Icon } from '@iconify-icon/react';
import { motion } from 'framer-motion';

export default function ProjectsPlaceholderPage() {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-32 border border-dashed border-[#222] rounded-lg text-center"
    >
      <Icon icon="mdi:folder-open-outline" className="text-5xl text-[#333] mb-4" />
      <span className="font-mono text-xs text-[#555] uppercase tracking-widest font-black block">
        Workspace Selection Required
      </span>
      <p className="text-[10px] text-[#444] font-mono mt-2 uppercase max-w-xs leading-relaxed">
        Select an active chapter session from the sidebar or initialize a new session to begin batch ingestion.
      </p>
    </motion.div>
  );
}
