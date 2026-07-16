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
    qualityOptions?: string[];
    /** Max prompt length accepted by the model */
    promptMaxLength: number;
    /** Fixed output format to always send (omit to skip the field) */
    outputFormat?: string;
    /** Any other static fields to include in the input object */
    extra?: Record<string, unknown>;
  };
  /**
   * When set, the route switches the model field to this alternative apiId
   * when NO reference images are provided (text-to-image variant).
   * The imageInputKey is omitted from the payload in that case.
   */
  textOnlyApiId?: string;
  /**
   * When set, overrides apiInput.promptMaxLength for the text-only (no images) variant.
   */
  textOnlyPromptMaxLength?: number;
  /** Default quality value for this model (used when switching to the model). */
  defaultQuality?: string;
  /**
   * When set and provider is "azure", these quality values are offered
   * instead of the standard 1k/2k/4k picker.
   */
  azureQualityOptions?: string[];
  /**
   * When set and provider is "azure", a resolution picker (1k/2k/4k) is shown
   * alongside the quality picker.
   */
  azureResolutionOptions?: string[];
  /**
   * Maps app-level aspect ratio strings to Azure size strings (e.g. "1792x1024").
   * Fallback is "1024x1024" when a ratio is not listed.
   */
  azureSizeMap?: Record<string, string>;
  /**
   * Per-resolution size maps for Azure. Keys are resolution tiers ("1k", "2k", "4k");
   * values are aspect-ratio → size-string maps. Takes precedence over azureSizeMap.
   */
  azureResolutionSizeMaps?: Record<string, Record<string, string>>;
  /**
   * Azure OpenAI API version to use for this model.
   * Defaults to "2024-02-01" (DALL-E 3). Newer models (e.g. gpt-image-2) require
   * a later preview version such as "2025-04-01-preview".
   */
  azureApiVersion?: string;
}

/**
 * Azure gpt-image-2 "Popular sizes" quick-pick list, per Azure's documented
 * size constraints (max edge 3840px, edges multiples of 16, ratio ≤ 3:1,
 * total pixels 655,360–8,294,400).
 */
export const AZURE_POPULAR_SIZES: { label: string; width: number; height: number }[] = [
  { label: "1024×1024 (square)", width: 1024, height: 1024 },
  { label: "1536×1024 (landscape)", width: 1536, height: 1024 },
  { label: "1024×1536 (portrait)", width: 1024, height: 1536 },
  { label: "2048×2048 (2K square)", width: 2048, height: 2048 },
  { label: "2048×1152 (2K landscape)", width: 2048, height: 1152 },
  { label: "3840×2160 (4K landscape)", width: 3840, height: 2160 },
  { label: "2160×3840 (4K portrait)", width: 2160, height: 3840 },
];

/**
 * Validates a custom width/height against Azure gpt-image-2's size constraints.
 * Returns an error message, or null when the size is valid.
 */
export function validateAzureCustomSize(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "Enter valid dimensions";
  }
  if (width > 3840 || height > 3840) return "Max edge length is 3840px";
  if (width % 16 !== 0 || height % 16 !== 0) return "Both edges must be multiples of 16px";
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long / short > 3) return "Long:short ratio must not exceed 3:1";
  const total = width * height;
  if (total < 655360 || total > 8294400) return "Total pixels must be 655,360–8,294,400";
  return null;
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
      qualityOptions: ["1k", "2k", "4k"],
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
      qualityOptions: ["1k", "2k", "4k"],
      promptMaxLength: 10000,
      outputFormat: "jpg",
    },
  },
  {
    id: "nano-banana-2-lite",
    apiId: "nano-banana-2-lite",
    name: "Nano Banana 2 Lite",
    provider: "Google",
    ratios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "4:5", "5:4", "2:3", "3:2", "21:9", "1:4", "4:1", "1:8", "8:1"],
    supportsImages: true,
    maxImages: 10,
    supportsQuality: false,
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      imageInputKey: "image_urls",
      promptMaxLength: 20000,
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
  {
    id: "seedream-5-pro",
    apiId: "seedream/5-pro-image-to-image",
    textOnlyApiId: "seedream/5-pro-text-to-image",
    name: "Seedream 5.0 Pro",
    provider: "Seedream",
    ratios: ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2"],
    supportsImages: true,
    maxImages: 10,
    supportsQuality: true,
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      imageInputKey: "image_urls",
      qualityKey: "quality",
      qualityMap: { "1k": "basic", "2k": "high" },
      qualityOptions: ["1k", "2k"],
      promptMaxLength: 3000,
      extra: { nsfw_checker: false },
    },
  },
  // ── X (Grok) ────────────────────────────────────────────────────────────────
  {
    id: "grok-imagine-image",
    // apiId used when images ARE attached (image-to-image)
    apiId: "grok-imagine/image-to-image",
    // apiId used when NO images are attached (text-to-image)
    textOnlyApiId: "grok-imagine/text-to-image",
    name: "Grok Imagine",
    provider: "X",
    ratios: ["1:1", "16:9", "9:16", "2:3", "3:2"],
    supportsImages: true,
    maxImages: 5,
    supportsQuality: false,
    textOnlyPromptMaxLength: 5000,
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      imageInputKey: "image_urls",
      promptMaxLength: 390000,
      extra: { nsfw_checker: false },
    },
  },
  // ── OpenAI GPT Image 2 ────────────────────────────────────────────────────────
  {
    id: "gpt-image-2",
    // apiId used when images ARE attached (image-to-image)
    apiId: "gpt-image-2-image-to-image",
    // apiId used when NO images are attached (text-to-image)
    textOnlyApiId: "gpt-image-2-text-to-image",
    name: "GPT Image 2",
    provider: "OpenAI",
    // Kie supports: auto, 1:1, 9:16, 16:9, 4:3, 3:4
    ratios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"],
    supportsImages: true,
    maxImages: 16,
    supportsQuality: true,
    // Azure-specific quality options (sent as the "quality" field)
    azureQualityOptions: ["low", "medium", "high"],
    azureResolutionOptions: ["1k", "2k", "4k"],
    azureApiVersion: "2025-04-01-preview",
    azureResolutionSizeMaps: {
      // 1K: Azure's three canonical sizes + adapted 4:3/3:4
      // Constraints: max edge ≤ 3840, both edges multiples of 16,
      //              ratio ≤ 3:1, total pixels 655 360–8 294 400
      "1k": {
        "auto":  "auto",
        "1:1":   "1024x1024",  // square
        "16:9":  "1536x1024",  // landscape (Azure canonical; 3:2 in practice)
        "9:16":  "1008x1792",  // portrait  — both edges /16 (1080 is not a multiple of 16)
        "4:3":   "1280x960",   // adapted 4:3 — 1 228 800 px, both /16
        "3:4":   "960x1280",   // adapted 3:4 — 1 228 800 px, both /16
      },
      // 2K: true 16:9 / 9:16 + 4:3/3:4 at 2K scale
      "2k": {
        "auto":  "auto",
        "1:1":   "2048x2048",  // 2K square — 4 194 304 px
        "16:9":  "2048x1152",  // 2K landscape — 2 359 296 px
        "9:16":  "1440x2560",  // 2K portrait  — QHD vertical
        "4:3":   "2048x1536",  // adapted 4:3  — 3 145 728 px, both /16
        "3:4":   "1536x2048",  // adapted 3:4  — 3 145 728 px, both /16
      },
      // 4K: true 16:9 / 9:16 + adapted 4:3/3:4 + max-valid square
      "4k": {
        "auto":  "auto",
        "1:1":   "2880x2880",  // max valid square — 8 294 400 px (at limit)
        "16:9":  "3840x2160",  // 4K landscape — 8 294 400 px (at limit)
        "9:16":  "2160x3840",  // 4K portrait  — 8 294 400 px (at limit)
        "4:3":   "3072x2304",  // adapted 4:3  — 7 077 888 px, both /16
        "3:4":   "2304x3072",  // adapted 3:4  — 7 077 888 px, both /16
      },
    },
    // Fallback when no azureResolution tier is selected — defaults to 2K scale
    azureSizeMap: {
      "auto": "auto",
      "1:1":  "1024x1024",
      "16:9": "2048x1152",
      "9:16": "1152x2048",
      "4:3":  "2048x1536",  // proper 4:3 (was "1536x1024" = 3:2 — wrong)
      "3:4":  "1536x2048",  // proper 3:4 (was "1024x1536" = 2:3 — wrong)
    },
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      imageInputKey: "input_urls",
      qualityKey: "resolution",
      qualityOptions: ["1k", "2k", "4k"],
      promptMaxLength: 20000,
      extra: { nsfw_checker: false },
    },
  },
];

// ── Video models ──────────────────────────────────────────────────────────────

export type VideoHandle = "prompt" | "startFrame" | "endFrame" | "resource" | "videoRef" | "referenceVideo" | "audioRef";

export interface VideoModelMode {
  value: string;
  label: string;
}

export interface VideoModel {
  id: string;
  apiId: string;
  /**
   * When set, this apiId is used instead of apiId when reference images ARE provided.
   * Mirrors the textOnlyApiId pattern from ImageModel.
   */
  imageApiId?: string;
  name: string;
  provider: string;
  ratios: string[];
  durations: number[];
  defaultDuration: number;
  defaultRatio: string;
  /** Active target handles for this model */
  handles: VideoHandle[];
  /**
   * Handles that must have content before generation is allowed.
   * The gallery validates these and shows an error modal if any are empty.
   */
  requiredHandles?: VideoHandle[];
  /** Show sound toggle in controls */
  sound: boolean;
  /** When true, prompt is not required to generate */
  promptOptional?: boolean;
  /** When true, model supports a seed parameter */
  supportsSeeds?: boolean;
  /**
   * Optional mode selector (Kling: resolution, Grok: style).
   * If omitted, no mode picker is shown.
   */
  modes?: VideoModelMode[];
  defaultMode?: string;
  /** Optional secondary resolution picker (shown in addition to modes) */
  resolutions?: string[];
  defaultResolution?: string;
  /** Max number of resource-handle images accepted by this model (default 3) */
  maxResources?: number;
  /** Max number of referenceVideo-handle videos accepted by this model (default 3) */
  maxReferenceVideos?: number;
  /** Max number of audioRef-handle audios accepted by this model (default 3) */
  maxReferenceAudios?: number;
  /** How @mention tags are serialised in the final prompt (default: "<<<image N>>>") */
  resourceTagFormat?: "default" | "grok";
  apiInput: {
    aspectRatioKey?: string;
    durationKey?: string;
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
    /**
     * When true, uses motion-control payload:
     *   input_urls (reference image) + video_urls (reference video)
     * modeKey → character_orientation, resolutionKey → mode (720p/1080p)
     */
    useMotionControl?: boolean;
    /**
     * Max duration (seconds) accepted for a connected reference video (videoRef handle).
     * Independent of durationMax which controls the generated output length.
     */
    videoRefMaxDuration?: number;
    /** Field name for the start frame image URL (e.g. "first_frame_url") */
    firstFrameKey?: string;
    /** Field name for the end frame image URL (e.g. "last_frame_url") */
    lastFrameKey?: string;
    /** Field name for an array of reference video URLs */
    referenceVideosKey?: string;
    /** Field name for an array of reference audio URLs */
    referenceAudiosKey?: string;
    /** Max prompt length accepted by the model */
    promptMaxLength?: number;
    /** Any other static fields to include in the input object */
    extra?: Record<string, unknown>;
    /** When set, seed value is sent under this key */
    seedKey?: string;
    /** When true, use HappyHorse multi-endpoint routing */
    useHappyHorse?: boolean;
    /** When true, use Google-specific payload and routing */
    useGoogleVeo?: boolean;
    /** When true, use Gemini Omni Video payload (image_urls + video_list, quota-based) */
    useGeminiOmniVideo?: boolean;
    /**
     * When true, routes based on whether a start-frame image is provided:
     * - with image → imageApiId (i2v), sends image_urls + duration + resolution, no aspect_ratio
     * - without image → apiId (t2v), sends prompt + duration + aspect_ratio + resolution
     */
    useKlingTurbo?: boolean;
  };
}

export const VIDEO_MODELS: VideoModel[] = [
  // ── Google ──────────────────────────────────────────────────────────────────
  {
    id: "veo3_lite",
    apiId: "veo3_lite",
    name: "Veo 3.1 Lite",
    provider: "Google",
    ratios: ["16:9", "9:16", "Auto"],
    durations: [],
    defaultDuration: 0,
    defaultRatio: "9:16",
    handles: ["prompt", "startFrame", "endFrame"],
    sound: false,
    resolutions: ["720p", "1080p", "4k"],
    defaultResolution: "720p",
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      resolutionKey: "resolution",
      promptMaxLength: 10000,
      durationMin: 0,
      durationMax: 0,
      extra: {
        enableTranslation: true,
      },
      useGoogleVeo: true,
    },
  },
  {
    id: "veo3_fast",
    apiId: "veo3_fast",
    name: "Veo 3.1 Fast",
    provider: "Google",
    ratios: ["16:9", "9:16", "Auto"],
    durations: [],
    defaultDuration: 0,
    defaultRatio: "9:16",
    handles: ["prompt", "startFrame", "endFrame", "resource"],
    sound: false,
    maxResources: 3,
    resolutions: ["720p", "1080p", "4k"],
    defaultResolution: "720p",
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      resolutionKey: "resolution",
      promptMaxLength: 10000,
      durationMin: 0,
      durationMax: 0,
      extra: {
        enableTranslation: true,
      },
      useGoogleVeo: true,
    },
  },
  {
    id: "veo3",
    apiId: "veo3",
    name: "Veo 3.1 Quality",
    provider: "Google",
    ratios: ["16:9", "9:16", "Auto"],
    durations: [],
    defaultDuration: 0,
    defaultRatio: "9:16",
    handles: ["prompt", "startFrame", "endFrame", "resource"],
    sound: false,
    maxResources: 3,
    resolutions: ["720p", "1080p", "4k"],
    defaultResolution: "720p",
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      resolutionKey: "resolution",
      promptMaxLength: 10000,
      durationMin: 0,
      durationMax: 0,
      extra: {
        enableTranslation: true,
      },
      useGoogleVeo: true,
    },
  },
  {
    id: "gemini-omni-video",
    apiId: "gemini-omni-video",
    name: "Gemini Omni Video",
    provider: "Google",
    ratios: ["16:9", "9:16"],
    durations: [4, 6, 8, 10],
    defaultDuration: 8,
    defaultRatio: "16:9",
    handles: ["prompt", "resource", "referenceVideo"],
    sound: false,
    supportsSeeds: true,
    maxResources: 7,
    maxReferenceVideos: 1,
    resolutions: ["720p", "1080p", "4k"],
    defaultResolution: "720p",
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      durationKey: "duration",
      durationAsString: true,
      durationMin: 4,
      durationMax: 10,
      resolutionKey: "resolution",
      seedKey: "seed",
      useGeminiOmniVideo: true,
      promptMaxLength: 20000,
    },
  },
  // ── Kling ───────────────────────────────────────────────────────────────────
  {
    id: "kling-3.0",
    apiId: "kling-3.0/video",
    name: "Kling 3.0",
    provider: "Kling",
    ratios: ["16:9", "9:16", "1:1"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    defaultRatio: "9:16",
    handles: ["prompt", "startFrame", "endFrame", "resource"],
    sound: true,
    modes: [
      { value: "std", label: "720p" },
      { value: "pro", label: "1080p" },
      { value: "4K",  label: "4K"   },
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
      promptMaxLength: 2500,
      extra: { multi_shots: false, multi_prompt: [], kling_elements: [] },
    },
  },
  {
    id: "kling-3.0-turbo",
    apiId: "kling/v3-turbo-text-to-video",
    imageApiId: "kling/v3-turbo-image-to-video",
    name: "Kling 3.0 Turbo",
    provider: "Kling",
    ratios: ["16:9", "9:16", "1:1"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    defaultRatio: "9:16",
    handles: ["prompt", "startFrame"],
    sound: false,
    resolutions: ["720p", "1080p"],
    defaultResolution: "720p",
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      durationKey: "duration",
      durationAsString: true,
      durationMin: 3,
      durationMax: 15,
      resolutionKey: "resolution",
      promptMaxLength: 2500,
      useKlingTurbo: true,
    },
  },
  // ── X (Grok) ─────────────────────────────────────────────────────────────────
  {
    id: "grok-imagine",
    apiId: "grok-imagine/text-to-video",
    imageApiId: "grok-imagine/image-to-video",
    name: "Grok Imagine",
    provider: "X",
    ratios: ["16:9", "9:16", "1:1", "2:3", "3:2"],
    durations: [6, 8, 10, 12, 15, 20, 25, 30],
    defaultDuration: 6,
    defaultRatio: "9:16",
    handles: ["prompt", "resource"],
    sound: false,
    maxResources: 7,
    resourceTagFormat: "grok",
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
      durationAsString: true,
      durationMin: 6,
      durationMax: 30,
      modeKey: "mode",
      resolutionKey: "resolution",
      referenceImagesKey: "image_urls",
      promptMaxLength: 5000,
    },
  },
  {
    id: "grok-imagine-1-5-preview",
    apiId: "grok-imagine-video-1-5-preview",
    name: "Grok Imagine 1.5 preview",
    provider: "X",
    ratios: ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
    durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 8,
    defaultRatio: "auto",
    handles: ["prompt", "resource"],
    requiredHandles: ["resource"],
    sound: false,
    promptOptional: true,
    maxResources: 1,
    resourceTagFormat: "grok",
    resolutions: ["480p", "720p"],
    defaultResolution: "480p",
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      durationKey: "duration",
      durationMin: 1,
      durationMax: 15,
      resolutionKey: "resolution",
      referenceImagesKey: "image_urls",
      promptMaxLength: 5000,
    },
  },
  // ── Bytedance ─────────────────────────────────────────────────────────────────
  {
    id: "seedance-2",
    apiId: "bytedance/seedance-2",
    name: "Seedance 2.0",
    provider: "Bytedance",
    ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    defaultRatio: "9:16",
    handles: ["prompt", "startFrame", "endFrame", "resource", "referenceVideo", "audioRef"],
    sound: true,
    promptOptional: true,
    maxResources: 9,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
    resolutions: ["480p", "720p", "1080p"],
    defaultResolution: "720p",
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      durationKey: "duration",
      durationMin: 4,
      durationMax: 15,
      resolutionKey: "resolution",
      soundKey: "generate_audio",
      firstFrameKey: "first_frame_url",
      lastFrameKey: "last_frame_url",
      referenceImagesKey: "reference_image_urls",
      referenceVideosKey: "reference_video_urls",
      referenceAudiosKey: "reference_audio_urls",
      promptMaxLength: 20000,
      extra: { web_search: false },
    },
  },
  {
    id: "seedance-2-fast",
    apiId: "bytedance/seedance-2-fast",
    name: "Seedance 2.0 Fast",
    provider: "Bytedance",
    ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    defaultRatio: "9:16",
    handles: ["prompt", "startFrame", "endFrame", "resource", "referenceVideo", "audioRef"],
    sound: true,
    promptOptional: true,
    maxResources: 9,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
    resolutions: ["480p", "720p", "1080p"],
    defaultResolution: "720p",
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      durationKey: "duration",
      durationMin: 4,
      durationMax: 15,
      resolutionKey: "resolution",
      soundKey: "generate_audio",
      firstFrameKey: "first_frame_url",
      lastFrameKey: "last_frame_url",
      referenceImagesKey: "reference_image_urls",
      referenceVideosKey: "reference_video_urls",
      referenceAudiosKey: "reference_audio_urls",
      promptMaxLength: 20000,
      extra: { web_search: false },
    },
  },
  {
    id: "seedance-2-mini",
    apiId: "bytedance/seedance-2-mini",
    name: "Seedance 2.0 Mini",
    provider: "Bytedance",
    ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    defaultRatio: "9:16",
    handles: ["prompt", "startFrame", "endFrame", "resource", "referenceVideo", "audioRef"],
    sound: true,
    promptOptional: true,
    maxResources: 9,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
    resolutions: ["480p", "720p"],
    defaultResolution: "720p",
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      durationKey: "duration",
      durationMin: 4,
      durationMax: 15,
      resolutionKey: "resolution",
      soundKey: "generate_audio",
      firstFrameKey: "first_frame_url",
      lastFrameKey: "last_frame_url",
      referenceImagesKey: "reference_image_urls",
      referenceVideosKey: "reference_video_urls",
      referenceAudiosKey: "reference_audio_urls",
      promptMaxLength: 20000,
      extra: { web_search: false },
    },
  },
  // ── Alibaba HappyHorse ───────────────────────────────────────────────────────
  {
    id: "happyhorse",
    apiId: "happyhorse/text-to-video",
    name: "HappyHorse",
    provider: "Alibaba",
    ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    defaultRatio: "9:16",
    handles: ["prompt", "startFrame", "resource"],
    sound: false,
    promptOptional: true,
    supportsSeeds: true,
    maxResources: 9,
    resolutions: ["720p", "1080p"],
    defaultResolution: "1080p",
    apiInput: {
      aspectRatioKey: "aspect_ratio",
      durationKey: "duration",
      durationMin: 3,
      durationMax: 15,
      resolutionKey: "resolution",
      referenceImagesKey: "reference_image",
      seedKey: "seed",
      useHappyHorse: true,
      promptMaxLength: 5000,
    },
  },
  // ── Kling motion control ─────────────────────────────────────────────────────
  {
    id: "kling-2.6-motion-control",
    apiId: "kling-2.6/motion-control",
    name: "Motion Control 2.6",
    provider: "Kling",
    ratios: [],    // no aspect-ratio selector — output inherits from inputs
    durations: [], // no duration selector
    defaultDuration: 0,
    defaultRatio: "9:16",
    handles: ["prompt", "startFrame", "videoRef"],
    requiredHandles: ["startFrame", "videoRef"],
    sound: false,
    promptOptional: true,
    // character_orientation: "image" keeps subject pose from reference image (max 10s)
    // character_orientation: "video" follows subject pose from motion video (max 30s)
    modes: [
      { value: "image", label: "Image orient." },
      { value: "video", label: "Video orient." },
    ],
    defaultMode: "image",
    resolutions: ["720p", "1080p"],
    defaultResolution: "720p",
    apiInput: {
      durationMin: 0,
      durationMax: 0,                    // no duration field sent to the API
      modeKey: "character_orientation",  // mode selector → character_orientation
      resolutionKey: "mode",             // resolution selector → mode (720p / 1080p)
      useMotionControl: true,
      videoRefMaxDuration: 30,           // reference video may not exceed 30 s
      promptMaxLength: 2500,
    },
  },
];