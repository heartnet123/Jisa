import axios from "axios";
import type {
  BlockItem,
  MaskPreviewResponse,
  ProcessedManga,
  Project,
  RegionCollectionResponse,
  SystemHealth,
  TranslationConfig,
} from "../types";

import { getBYOKHeaders } from "./byok";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export interface UploadResponse {
  id: string;
  status: string;
}

/** Prepend the backend origin to any relative /uploads/ path the API returns. */
function resolveUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/")) return `${API_BASE_URL}${url}`;
  return url;
}

export const mangaApi = {
  upload: async (
    file: File,
    _config: TranslationConfig,
    project_id?: string,
  ): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append("file", file);
    if (project_id) {
      formData.append("project_id", project_id);
    }

    const byokHeaders = getBYOKHeaders();

    const response = await axios.post<UploadResponse>(
      `${API_BASE_URL}/api/translate`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
          ...byokHeaders,
        },
      },
    );

    return response.data;
  },

  checkStatus: async (id: string): Promise<ProcessedManga> => {
    const response = await axios.get<ProcessedManga>(
      `${API_BASE_URL}/api/status/${id}`,
    );

    const data = response.data;

    const originalUrl =
      resolveUrl(data.originalUrl) ??
      resolveUrl(data.original_url);

    // Fix all relative image URLs so <img src> resolves to the backend origin
    return {
      ...data,
      originalUrl: originalUrl ?? "",
      result_url: resolveUrl(data.result_url),
      inpainted_url: resolveUrl(data.inpainted_url),
      mask_preview_url: resolveUrl(data.mask_preview_url),
      status: (data.status as unknown as string) === "processing" ? "segmenting" : data.status,
    };
  },

  approveTranslation: async (
    id: string,
    translations: Record<string, string>,
  ): Promise<{ status: string }> => {
    const response = await axios.post<{ status: string }>(
      `${API_BASE_URL}/api/jobs/${id}/approve`,
      { translations },
    );
    return response.data;
  },

  replaceRegions: async (
    id: string,
    regions: BlockItem[],
  ): Promise<RegionCollectionResponse> => {
    const response = await axios.put<RegionCollectionResponse>(
      `${API_BASE_URL}/api/jobs/${id}/regions`,
      {
        regions: regions.map(({ id: regionId, box, text, translated_text }) => ({
          id: regionId,
          box,
          text,
          translated_text,
        })),
      },
    );
    return response.data;
  },

  patchRegion: async (
    jobId: string,
    regionId: string,
    updates: { text?: string | null; translated_text?: string | null },
  ): Promise<BlockItem> => {
    const response = await axios.patch<BlockItem>(
      `${API_BASE_URL}/api/jobs/${jobId}/regions/${regionId}`,
      updates,
    );
    return response.data;
  },

  rerunRegionOcr: async (jobId: string, regionId: string): Promise<BlockItem> => {
    const response = await axios.post<BlockItem>(
      `${API_BASE_URL}/api/jobs/${jobId}/regions/${regionId}/ocr`,
    );
    return response.data;
  },

  generateMaskPreview: async (jobId: string): Promise<MaskPreviewResponse> => {
    const response = await axios.post<MaskPreviewResponse>(
      `${API_BASE_URL}/api/jobs/${jobId}/mask-preview`,
    );
    return {
      ...response.data,
      url: resolveUrl(response.data.url) ?? response.data.url,
    };
  },

  listJobs: async (): Promise<ProcessedManga[]> => {
    const response = await axios.get<ProcessedManga[]>(
      `${API_BASE_URL}/api/jobs`
    );
    return response.data.map((job) => ({
      ...job,
      originalUrl: resolveUrl(job.originalUrl) ?? resolveUrl(job.original_url) ?? "",
      result_url: resolveUrl(job.result_url),
      inpainted_url: resolveUrl(job.inpainted_url),
      mask_preview_url: resolveUrl(job.mask_preview_url),
    }));
  },

  deleteJob: async (id: string): Promise<{ status: string; job_id: string }> => {
    const response = await axios.delete<{ status: string; job_id: string }>(
      `${API_BASE_URL}/api/jobs/${id}`
    );
    return response.data;
  },

  cancelJob: async (id: string): Promise<{ status: string }> => {
    const response = await axios.post<{ status: string }>(
      `${API_BASE_URL}/api/jobs/${id}/cancel`
    );
    return response.data;
  },

  getSystemHealth: async (): Promise<SystemHealth> => {
    const response = await axios.get<SystemHealth>(`${API_BASE_URL}/api/system/health`);
    return response.data;
  },

  testSandboxTranslation: async (payload: {
    text: string;
    provider: string;
    model: string;
    system_prompt: string;
  }): Promise<{ translated_text: string }> => {
    const response = await axios.post<{ translated_text: string }>(
      `${API_BASE_URL}/api/sandbox/translate`,
      payload
    );
    return response.data;
  },

  createProject: async (name: string): Promise<Project> => {
    const response = await axios.post<Project>(
      `${API_BASE_URL}/api/projects`,
      { name }
    );
    return response.data;
  },

  listProjects: async (): Promise<Project[]> => {
    const response = await axios.get<Project[]>(
      `${API_BASE_URL}/api/projects`
    );
    return response.data;
  },

  reorderProjectPages: async (projectId: string, pageOrder: string[]): Promise<Project> => {
    const response = await axios.put<Project>(
      `${API_BASE_URL}/api/projects/${projectId}/reorder`,
      { page_order: pageOrder }
    );
    return response.data;
  },

  deleteProject: async (projectId: string): Promise<{ status: string }> => {
    const response = await axios.delete<{ status: string }>(
      `${API_BASE_URL}/api/projects/${projectId}`
    );
    return response.data;
  },

  renameProject: async (projectId: string, name: string): Promise<Project> => {
    const response = await axios.put<Project>(
      `${API_BASE_URL}/api/projects/${projectId}`,
      { name }
    );
    return response.data;
  },
};


