import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { MEDIA_DIR } from "@/lib/guest/paths";
import { mediaPathFor, toMediaUrl } from "@/lib/guest/media";
import { ensureStorage } from "@/lib/guest/localStorage";
import { dlog } from "@/lib/debugLog";

// ponytail: length threshold is a heuristic guess at when Omni Flash chokes on
// a complex prompt. Upgrade: trigger on Flow's actual "unable to edit the
// speech in this video" error and retry with the screenshot, instead of
// guessing upfront from prompt length.
const READ_THIS_MIN_CHARS = 200;

/** Any Omni Flash version, by Flow's own names ("Omni Flash", "Omni 1.1 Flash", "Omni 1.2 Flash"). */
export function isOmniFlash(model: string): boolean {
  return /^omni\b.*\bflash$/i.test(model.trim());
}

export function shouldUseReadThis(model: string, prompt: string, explicit?: boolean, hasFrames = false): boolean {
  if (explicit !== undefined) return explicit;
  // A prompt image would be one more attached image next to the start/end frames.
  return !hasFrames && isOmniFlash(model) && prompt.trim().length > READ_THIS_MIN_CHARS;
}

const FLOW_PROJECT_URL_PATTERN = /^https:\/\/flow\.google\.com\/project\/[0-9a-f-]+$/i;

export function flowProjectUrl(): string {
  const url = process.env.FLOW_PROJECT_URL?.trim();
  if (!url || !FLOW_PROJECT_URL_PATTERN.test(url)) {
    throw new Error(
      `FLOW_PROJECT_URL ausente ou inválida (${url ?? "vazia"}). Crie um projeto no Google Flow e cole a URL https://flow.google.com/project/<id> em .env.local.`,
    );
  }
  return url;
}

function escapePangoMarkup(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Renders a prompt as a PNG (white background, black text) so it can be
 * attached as a reference image, working around Omni Flash rejecting complex
 * text prompts ("unable to edit the speech in this video"). See
 * F:/CLAUDE/hermes/skills/social-media/ugc-foto-realista/references/x-ugc-playbooks-2026.md:155
 */
export async function renderPromptImage(prompt: string, outDir: string): Promise<string> {
  const hash = createHash("sha1").update(prompt).digest("hex").slice(0, 16);
  const outPath = path.join(outDir, `read-this-${hash}.png`);
  if (fs.existsSync(outPath)) return outPath;

  const width = 1080;
  const padding = 48;
  const textWidth = width - padding * 2;

  const textBuffer = await sharp({
    text: {
      text: `<span font="sans 30">${escapePangoMarkup(prompt)}</span>`,
      width: textWidth,
      rgba: true,
      align: "left",
    },
  })
    .png()
    .toBuffer();

  const textMeta = await sharp(textBuffer).metadata();
  const height = (textMeta.height ?? 200) + padding * 2;

  await sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: textBuffer, left: padding, top: padding }])
    .png()
    .toFile(outPath);

  return outPath;
}

const FLOW_DIST = "F:/CLAUDE/AGENT_AI/google-flow-mcp/dist";

async function getFlowModules() {
  const storeUrl = pathToFileURL(path.join(FLOW_DIST, "store.js")).href;
  const browserUrl = pathToFileURL(path.join(FLOW_DIST, "browser-manager.js")).href;
  const flowUrl = pathToFileURL(path.join(FLOW_DIST, "flow-adapter.js")).href;

  const [storeModule, browserModule, flowModule] = await Promise.all([
    import(/* webpackIgnore: true */ storeUrl),
    import(/* webpackIgnore: true */ browserUrl),
    import(/* webpackIgnore: true */ flowUrl),
  ]);

  return {
    FlowStore: storeModule.FlowStore,
    BrowserManager: browserModule.BrowserManager,
    FlowAdapter: flowModule.FlowAdapter,
  };
}

// Minimal shape of the external google-flow-mcp engine (only what we call).
export interface FlowJob {
  id: string;
  status?: string;
  error?: string;
  diagnosticScreenshot?: string;
  generatedAssets?: unknown[];
  downloadedFiles?: string[];
}
interface FlowAccount { id: string; connectionStatus?: string }
interface FlowAccountsFile { accounts: FlowAccount[]; defaultAccountId?: string }
interface FlowEngine {
  store: {
    initialize(): Promise<void>;
    listAccounts(): Promise<FlowAccountsFile>;
    getJob(jobId: string): Promise<FlowJob>;
  };
  browsers: unknown;
  flow: {
    generate(opts: Record<string, unknown>): Promise<FlowJob>;
    refreshJob(jobId: string, timeoutSeconds: number): Promise<FlowJob>;
    downloadJob(jobId: string): Promise<unknown>;
    getCredits(accountId?: string): Promise<unknown>;
  };
}
const ENGINE_KEY = Symbol.for("heliosgen.flow-engine");

// One engine per server process. Next bundles each route separately, so a
// module-level singleton gave every route its own browser queue, and those
// queues then starved each other on the MCP's per-account lock file.
export function getFlowEngine(): Promise<FlowEngine> {
  const g = globalThis as typeof globalThis & { [ENGINE_KEY]?: Promise<FlowEngine> };
  g[ENGINE_KEY] ??= getFlowModules()
    .then(({ FlowStore, BrowserManager, FlowAdapter }) => {
      const store = new FlowStore();
      const browsers = new BrowserManager(store);
      return { store, browsers, flow: new FlowAdapter(store, browsers, null) };
    })
    .catch((error) => {
      delete g[ENGINE_KEY];
      throw error;
    });
  return g[ENGINE_KEY];
}

export function getFlowOutputDir(): string {
  const dir = path.join(MEDIA_DIR, "flow");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export interface SubmitFlowVideoParams {
  prompt: string;
  modelName?: string; // e.g. "Omni Flash", "Veo 3.1 - Fast", "Veo 3.1 - Quality"
  aspectRatio?: string; // "9:16" | "16:9"
  startFrame?: string;
  endFrame?: string;
  referenceImages?: string[];
  /** Clip for Omni Flash to edit (character/object swap). Max one: Flow edits a single source. */
  referenceVideos?: string[];
  /** The account owner declares rights over the uploaded video (Flow asks before using it). */
  affirmVideoRights?: boolean;
  durationSeconds?: number;
  outputs?: number;
  upscale?: "none" | "1080p";
  accountId?: string;
  /** Force (true) or disable (false) the "read this" screenshot bypass. See shouldUseReadThis. */
  readThis?: boolean;
}

/** Flow's agent reads the first attachment as the clip to edit, so the source video
 *  goes first, then frames, then images. Duplicates are dropped. */
export function orderFlowReferences(videos: string[], frames: string[], images: string[]): string[] {
  const out: string[] = [];
  for (const file of [...videos, ...frames, ...images]) if (!out.includes(file)) out.push(file);
  return out;
}

export interface SubmitFlowImageParams {
  prompt: string;
  modelName?: string; // e.g. "Nano Banana 2", "Nano Banana Pro"
  aspectRatio?: string; // "9:16" | "16:9" | "1:1" | "4:3" | "3:4"
  referenceImages?: string[];
  outputs?: number;
  accountId?: string;
}

/** Local file for a `/generated/...` URL, or null. Everything resolved here is
 *  uploaded to Google Flow, so only files inside MEDIA_DIR are allowed. */
export function resolveLocalPath(url?: string): string | null {
  const media = typeof url === "string" ? toMediaUrl(url.trim()) : null;
  const abs = media && mediaPathFor(media);
  return abs && fs.existsSync(abs) ? abs : null;
}

/** Local file for a frame or reference the canvas sent. data: URLs are decoded and
 *  remote URLs mirrored first, as for every other provider. An unreadable one is an
 *  error: generating without the frame the user connected is worse than failing. */
async function referenceFile(url: string, label: string): Promise<string> {
  const abs = await ensureStorage(url.trim(), "flow").then(resolveLocalPath, () => null);
  if (!abs) throw new Error(`${label} could not be read (${url.slice(0, 60)}). Upload it again and retry.`);
  return abs;
}

/** Flow's agent gets frames as unordered prompt attachments; say which is which. */
export function framePrompt(prompt: string, hasStart: boolean, hasEnd: boolean): string {
  if (hasStart && hasEnd) {
    return `Use the first attached image as the first frame and the second attached image as the last frame. ${prompt}`;
  }
  if (hasEnd) return `Use the attached image as the last frame. ${prompt}`;
  return hasStart ? `Use the first attached image as the first frame. ${prompt}` : prompt;
}

/** Flow has no kie mention tags; `<<<image N>>>` becomes plain `image N`. */
export function stripKieImageTags(prompt: string): string {
  return prompt.replace(/<<<image (\d+)>>>/g, "image $1");
}

export async function submitFlowVideo(params: SubmitFlowVideoParams) {
  // References first: a bad frame fails fast, before the browser engine is touched.
  const sourceVideos = params.referenceVideos ?? [];
  if (sourceVideos.length > 1) throw new Error("Omni Flash edits one source video at a time; connect a single reference video.");
  const videoAbs: string[] = [];
  for (const ref of sourceVideos) videoAbs.push(await referenceFile(ref, "Reference video"));
  const startAbs = params.startFrame ? await referenceFile(params.startFrame, "Start frame") : null;
  const endAbs = params.endFrame ? await referenceFile(params.endFrame, "End frame") : null;
  const imageAbs: string[] = [];
  for (const ref of params.referenceImages ?? []) imageAbs.push(await referenceFile(ref, "Reference image"));
  const referenceFiles = orderFlowReferences(
    videoAbs,
    [startAbs, endAbs].filter((f): f is string => Boolean(f)),
    imageAbs,
  );
  const editingVideo = videoAbs.length > 0;

  const { flow, store } = await getFlowEngine();
  await store.initialize();

  const accountsFile = await store.listAccounts();
  const connectedAccs = accountsFile.accounts.filter((a) => a.connectionStatus === "connected");
  const accountId = (params.accountId && connectedAccs.some((a) => a.id === params.accountId))
    ? params.accountId
    : (accountsFile.defaultAccountId || (connectedAccs.length > 0 ? connectedAccs[0].id : "flowuser"));
  if (!accountId) {
    throw new Error(
      "No Google Flow accounts connected. Run `node F:/CLAUDE/AGENT_AI/google-flow-mcp/dist/cli.js account connect <id>` or configure an account."
    );
  }

  const outputDirectory = getFlowOutputDir();
  const model = params.modelName || "Omni Flash";
  const aspectRatio = params.aspectRatio === "16:9" ? "16:9" : "9:16";

  let prompt = params.prompt;
  // A video edit names its attachments in the prompt; a prompt screenshot would be read as the replacement look.
  if (shouldUseReadThis(model, params.prompt, params.readThis, Boolean(startAbs || endAbs || editingVideo))) {
    const promptImagePath = await renderPromptImage(params.prompt, outputDirectory);
    referenceFiles.push(promptImagePath);
    prompt = "read this";
    dlog(`[Flow] read-this bypass active, rendered prompt image: ${promptImagePath}`);
  }
  prompt = framePrompt(prompt, Boolean(startAbs), Boolean(endAbs));

  dlog(`[Flow] Submitting video: model=${model}, aspect=${aspectRatio}, refs=${referenceFiles.length}`);

  const job = await flow.generate({
    accountId,
    mediaType: "video",
    prompt,
    model,
    aspectRatio,
    durationSeconds: params.durationSeconds,
    outputs: params.outputs ?? 1,
    referenceFiles,
    affirmVideoRights: params.affirmVideoRights === true,
    upscale: params.upscale ?? "none",
    outputDirectory,
    download: true,
    timeoutSeconds: 600,
    flowProjectUrl: flowProjectUrl(),
  });

  return {
    jobId: job.id,
    job,
    taskId: `flow-video:${job.id}`,
  };
}

export async function submitFlowImage(params: SubmitFlowImageParams) {
  const referenceFiles: string[] = [];
  for (const ref of params.referenceImages ?? []) {
    const abs = await referenceFile(ref, "Reference image");
    if (!referenceFiles.includes(abs)) referenceFiles.push(abs);
  }

  const { flow, store } = await getFlowEngine();
  await store.initialize();

  const accountsFile = await store.listAccounts();
  const connectedAccs = accountsFile.accounts.filter((a) => a.connectionStatus === "connected");
  const accountId = (params.accountId && connectedAccs.some((a) => a.id === params.accountId))
    ? params.accountId
    : (accountsFile.defaultAccountId || (connectedAccs.length > 0 ? connectedAccs[0].id : "flowuser"));
  if (!accountId) {
    throw new Error(
      "No Google Flow accounts connected. Run `node F:/CLAUDE/AGENT_AI/google-flow-mcp/dist/cli.js account connect <id>` or configure an account."
    );
  }

  const outputDirectory = getFlowOutputDir();
  const model = params.modelName || "Nano Banana 2";
  const aspectRatio = params.aspectRatio || "9:16";

  dlog(`[Flow] Submitting image: model=${model}, aspect=${aspectRatio}, refs=${referenceFiles.length}`);

  const job = await flow.generate({
    accountId,
    mediaType: "image",
    prompt: stripKieImageTags(params.prompt),
    model,
    aspectRatio,
    outputs: params.outputs ?? 1,
    referenceFiles,
    upscale: "none",
    outputDirectory,
    download: true,
    timeoutSeconds: 300,
    flowProjectUrl: flowProjectUrl(),
  });

  return {
    jobId: job.id,
    job,
    taskId: `flow-image:${job.id}`,
  };
}

export async function refreshFlowJob(jobId: string) {
  const { flow, store } = await getFlowEngine();
  await store.initialize();
  return await flow.refreshJob(jobId, 15);
}

export async function getFlowJob(jobId: string) {
  const { store } = await getFlowEngine();
  await store.initialize();
  return await store.getJob(jobId);
}

export async function downloadFlowJob(jobId: string) {
  const { flow, store } = await getFlowEngine();
  await store.initialize();
  await flow.downloadJob(jobId);
  return await store.getJob(jobId);
}

export async function getFlowCredits(accountId?: string) {
  const { flow, store } = await getFlowEngine();
  await store.initialize();
  return await flow.getCredits(accountId);
}

export async function listFlowAccounts() {
  const { store } = await getFlowEngine();
  await store.initialize();
  return await store.listAccounts();
}
