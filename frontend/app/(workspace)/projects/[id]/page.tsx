'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { ProjectWorkspace } from '@/features/manga-translator/components/ProjectWorkspace';

export default function ProjectWorkspacePage() {
  const params = useParams();
  const id = params.id as string;

  return <ProjectWorkspace projectId={id} />;
}
