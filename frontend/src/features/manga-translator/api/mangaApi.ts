import axios from "axios";
import type { ProcessedManga, TranslationConfig } from "../types";

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
  ): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await axios.post<UploadResponse>(
      `${API_BASE_URL}/api/translate`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" } },
    );

    return response.data;
  },

  checkStatus: async (id: string): Promise<ProcessedManga> => {
    const response = await axios.get<ProcessedManga>(
      `${API_BASE_URL}/api/status/${id}`,
    );

    const data = response.data;

    const originalUrl =
      resolveUrl((data as any).originalUrl) ??
      resolveUrl((data as any).original_url);

    // Fix all relative image URLs so <img src> resolves to the backend origin
    return {
      ...data,
      originalUrl: originalUrl ?? "",
      result_url: resolveUrl(data.result_url),
      inpainted_url: resolveUrl(data.inpainted_url),
      status: (data.status as any) === "processing" ? "segmenting" : data.status,
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
};
