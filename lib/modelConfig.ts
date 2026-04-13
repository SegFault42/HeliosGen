// ─────────────────────────────────────────────────────────────────────────────
// MODEL CONFIG — single source of truth for every model in the app.
//
// To add a new model:
//   1. Add an entry to IMAGE_MODELS or VIDEO_MODELS below.
//   2. That's it. The UI and API routes read from this file automatically.
// ─────────────────────────────────────────────────────────────────────────────

// ── Image models ──────────────────────────────────────────────────────────────

export interface ImageModel {
  /** Internal ID used in the store and API route */
  id: string;
  /** Model string sent to the kie.ai API */
  apiId: string;
  /** Display name shown in the dropdown */
  name: string;
  /** Provider label (groups models in the dropdown) */
  provider: string;
  /** Available aspect ratios */
  ratios: string[];
  /** Whether this model accepts reference images */
  supportsImages: boolean;
  /** Max number of reference images (0 if not supported) */
  maxImages: number;
  /** Whether this model has a quality / resolution setting */
  supportsQuality: boolean;
  /**
   * Describes how to map app-level fields to this model's API input object.
   * Add any model-specific static fields under `extra`.
   */
  apiInput: {
    /** Field name for the aspect ratio (e.g. "aspect_ratio" or "image_size") */
    aspectRatioKey: string;
    /** Field name for the reference image array (omit if not supported) */
    imageInputKey?: string;
    /** Field name for the quality setting (omit if not supported) */
    qualityKey?: string;
    /**
     * Maps app-level quality values ("1k", "2k", "4k") to API-specific strings.
     * If omitted, the route uses the default "1K"/"2K"/"4K" mapping.
     */
    qualityMap?: Record<string, string>;
    /**
     * Quality options shown in the dropdown (subset of "1k"|"2k"|"4k").
     * If omitted, all three are shown.
     */
    qualityOptions?: Array<"1k" | "2k" | "4k">;
    /** Max prompt length accepted by the model */
    promptMaxLength: number;
    /** Fixed output format to always send (omit to skip the field) */
    outputFormat?: string;
    /** Any other static fields to include in the input object */
    extra?: Record<string, unknown>;
  };
}

export const IMAGE_MODELS: ImageModel[] = [
  // ── Google ──────────────────────────────────────────────────────────────────
  {
    id: "google-nano-banana",
    apiId: "google/nano-banana",
    name: "Nano Banana",
    provider: "Google",
    ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"],
    supportsImages: false,
    maxImages: 0,
    supportsQuality: false,
    apiInput: {
      aspectRatioKey: "image_size",
      promptMaxLength: 5000,
      outputFormat: "jpeg",
    },
  },
  {
    id: "nano-banana-2",
    apiId: "nano-banana-2",
    name: "Nano Banana 2",
    provider: "Google",
    ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "2:3", "3:2", "21:9"],
    supportsImages: true,
    maxImages: 14,
    supportsQuality: true,
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      imageInputKey: "image_input",
      qualityKey: "quality",
      qualityMap: { "1k": "basic", "2k": "basic", "4k": "high" },
      qualityOptions: ["2k", "4k"],
      promptMaxLength: 10000,
      outputFormat: "jpg",
    },
  },
  {
    id: "nano-banana-pro",
    apiId: "nano-banana-pro",
    name: "Nano Banana Pro",
    provider: "Google",
    ratios: ["1:1", "16:9", "9:16", "4:3", "3:4", "4:5", "5:4", "2:3", "3:2", "21:9"],
    supportsImages: true,
    maxImages: 8,
    supportsQuality: true,
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      imageInputKey: "image_input",
      qualityKey: "quality",
      qualityMap: { "1k": "basic", "2k": "basic", "4k": "high" },
      qualityOptions: ["2k", "4k"],
      promptMaxLength: 10000,
      outputFormat: "jpg",
    },
  },
  // ── Z-AI ────────────────────────────────────────────────────────────────────
  {
    id: "z-image",
    apiId: "z-image",
    name: "Z-Image",
    provider: "Z-AI",
    ratios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
    supportsImages: false,
    maxImages: 0,
    supportsQuality: false,
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      promptMaxLength: 1000,
      extra: { nsfw_checker: true },
    },
  },
  // ── Seedream ────────────────────────────────────────────────────────────────
  {
    id: "seedream-5-lite",
    apiId: "seedream/5-lite-text-to-image",
    name: "Seedream 5.0 Lite",
    provider: "Seedream",
    ratios: ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"],
    supportsImages: true,
    maxImages: 14,
    supportsQuality: true,
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      imageInputKey: "image_urls",
      qualityKey: "quality",
      qualityMap: { "1k": "basic", "2k": "basic", "4k": "high" },
      qualityOptions: ["2k", "4k"],
      promptMaxLength: 3000,
      extra: { nsfw_checker: false },
    },
  },
];

// ── Video models ──────────────────────────────────────────────────────────────

export type VideoHandle = "prompt" | "startFrame" | "endFrame" | "resource";

export interface VideoModelMode {
  value: string;
  label: string;
}

export interface VideoModel {
  id: string;
  apiId: string;
  name: string;
  provider: string;
  ratios: string[];
  durations: number[];
  defaultDuration: number;
  defaultRatio: string;
  /** Active target handles for this model */
  handles: VideoHandle[];
  /** Show sound toggle in controls */
  sound: boolean;
  /**
   * Optional mode selector (Kling: resolution, Grok: style).
   * If omitted, no mode picker is shown.
   */
  modes?: VideoModelMode[];
  defaultMode?: string;
  /** Optional secondary resolution picker (shown in addition to modes) */
  resolutions?: string[];
  defaultResolution?: string;
  apiInput: {
    aspectRatioKey: string;
    durationKey: string;
    /** Send duration as a string instead of a number (required by Kling) */
    durationAsString?: boolean;
    durationMin: number;
    durationMax: number;
    modeKey?: string;
    soundKey?: string;
    resolutionKey?: string;
    /**
     * Field name for an array of reference image URLs.
     * When set, all resource-handle images are sent under this key.
     */
    referenceImagesKey?: string;
    /**
     * When true, resource images are sent as Kling "elements"
     * (kling_elements) rather than a plain URL array.
     */
    useKlingElements?: boolean;
    /**
     * When true, startFrame / endFrame images are collected into
     * an image_urls array (Kling-specific).
     */
    useImageUrls?: boolean;
    /** Any other static fields to include in the input object */
    extra?: Record<string, unknown>;
  };
}

export const VIDEO_MODELS: VideoModel[] = [
  // ── X-AI ────────────────────────────────────────────────────────────────────
  {
    id: "kling-3.0",
    apiId: "kling-3.0/video",
    name: "Kling 3.0",
    provider: "X-AI",
    ratios: ["16:9", "9:16", "1:1"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    defaultRatio: "16:9",
    handles: ["prompt", "startFrame", "endFrame", "resource"],
    sound: true,
    modes: [
      { value: "std", label: "720p" },
      { value: "pro", label: "1080p" },
    ],
    defaultMode: "pro",
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      durationKey: "duration",
      durationAsString: true,
      durationMin: 3,
      durationMax: 15,
      modeKey: "mode",
      soundKey: "sound",
      useImageUrls: true,
      useKlingElements: true,
      extra: { multi_shots: false },
    },
  },
  // ── X (Grok) ─────────────────────────────────────────────────────────────────
  {
    id: "grok-imagine",
    apiId: "grok-imagine/text-to-video",
    name: "Grok Imagine",
    provider: "X",
    ratios: ["16:9", "9:16", "1:1", "2:3", "3:2"],
    durations: [6, 8, 10, 12, 15, 20, 25, 30],
    defaultDuration: 6,
    defaultRatio: "16:9",
    handles: ["prompt", "resource"],
    sound: false,
    modes: [
      { value: "fun", label: "Fun" },
      { value: "normal", label: "Normal" },
      { value: "spicy", label: "Spicy" },
    ],
    defaultMode: "normal",
    resolutions: ["480p", "720p"],
    defaultResolution: "480p",
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      durationKey: "duration",
      durationMin: 6,
      durationMax: 30,
      modeKey: "mode",
      resolutionKey: "resolution",
      referenceImagesKey: "reference_images",
    },
  },
];