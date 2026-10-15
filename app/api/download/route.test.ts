/**
 * Regression tests for GET /api/download (issue #30).
 *
 * Outputs hosted on tempfile.aiquickdraw.com were rejected with 403 because
 * that origin was missing from the allow-list. These tests run the real route
 * handler with `fetch` stubbed so no network is required, asserting the
 * allow-list now permits tempfile.aiquickdraw.com while still blocking unknown
 * origins.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server.js";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
});

function downloadReq(target: string, filename = "clip.mp4"): NextRequest {
  const url = encodeURIComponent(target);
  return new NextRequest(`http://localhost/api/download?url=${url}&filename=${filename}`);
}

// Minimal fetch stub so the handler's proxy step stays offline & deterministic.
function stubFetch(status = 200, contentType = "video/mp4") {
  return vi.fn(async () => new Response("bytes", { status, headers: { "content-type": contentType } }));
}

describe("GET /api/download", () => {
  it("downloads assets hosted on tempfile.aiquickdraw.com (issue #30)", async () => {
    vi.stubGlobal("fetch", stubFetch(200));
    const res = await GET(downloadReq("https://tempfile.aiquickdraw.com/x/clip.mp4"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("Content-Type")).toBe("video/mp4");
  });

  it("still allows the existing Kie.ai origins", async () => {
    vi.stubGlobal("fetch", stubFetch(200));
    const res = await GET(downloadReq("https://cdn.kie.ai/video.mp4"));
    expect(res.status).toBe(200);
  });

  it("still allows Replicate delivery origins", async () => {
    vi.stubGlobal("fetch", stubFetch(200));
    const res = await GET(downloadReq("https://replicate.delivery/video.mp4"));
    expect(res.status).toBe(200);
  });

  it("rejects unknown origins with 403", async () => {
    vi.stubGlobal("fetch", stubFetch(200));
    const res = await GET(downloadReq("https://evil.example/video.mp4"));
    expect(res.status).toBe(403);
  });

  it("returns 400 when the url parameter is missing", async () => {
    const res = await GET(new NextRequest("http://localhost/api/download"));
    expect(res.status).toBe(400);
  });
});