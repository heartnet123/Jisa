import { describe, expect, it, vi } from "vitest";
import axios from "axios";
import { mangaApi } from "./mangaApi";

vi.mock("axios");

describe("mangaApi.uploadBatch", () => {
  it("sends single multipart FormData request with repeated files", async () => {
    const mockPost = vi.mocked(axios.post).mockResolvedValue({
      data: {
        id: "job-1",
        status: "queued",
        jobs: [
          { id: "job-1", filename: "page1.png", status: "queued", progress: 0, sequence_id: 0 },
          { id: "job-2", filename: "page2.png", status: "queued", progress: 0, sequence_id: 1 },
        ],
      },
    });

    const file1 = new File(["dummy1"], "page1.png", { type: "image/png" });
    const file2 = new File(["dummy2"], "page2.png", { type: "image/png" });

    const result = await mangaApi.uploadBatch([file1, file2], {
      provider: "ollama",
      model: "test",
      systemPrompt: "",
    }, "proj-123");

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, formData, config] = mockPost.mock.calls[0];
    expect(url).toContain("/api/translate");
    expect(formData).toBeInstanceOf(FormData);
    expect(config?.headers?.["Content-Type"]).toBe("multipart/form-data");

    expect(result.jobs).toHaveLength(2);
    expect(result.jobs?.[0].sequence_id).toBe(0);
    expect(result.jobs?.[1].sequence_id).toBe(1);
  });
});
