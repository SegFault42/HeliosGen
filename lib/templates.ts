import type { Node, Edge } from "@xyflow/react";
import type { NodeData } from "./store";
import { edgeStyle } from "./edgeStyles";

// ── UGC starter: 4× Image Gen → 4× Video Gen ─────────────────────────────────
// Two independent columns, each stacked vertically:
//
//   T5   T6   T7   T8    ← y=-150  (video prompt above its video gen)
//   VG1  VG2  VG3  VG4   ← y=0
//
//   IG1  IG2  IG3  IG4   ← y=620   (images pre-loaded as "done")
//   T1   T2   T3   T4    ← y=1200  (image prompt below its image gen)
//
// Connections:
//   T[1-4] → IG[1-4].prompt
//   IG[1-4] → VG[1-4].startFrame
//   T[5-8]  → VG[1-4].prompt

const STRIDE_X = 380;
const X_OFFSET = 310;

const REF_IMAGES = [
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/1.png",
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/2.png",
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/3.png",
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/4.png",
];

const REF_VIDEOS = [
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/1.mp4",
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/2.mp4",
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/3.mp4",
  "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/4.mp4",
];

const IMG_PROMPTS = [
  "A photorealistic portrait. It features the specific young woman  She is relaxing leisurely in a luxurious overwater bungalow cabana in the Maldives. She is lying back on white linen cushions, looking calmly out over a stunning turquoise infinity pool that seamlessly merges with the clear ocean. She wears an elegant black swimsuit (consistent with her classy aesthetic) and her signature gold hoop earrings. She is looking toward the camera with a peaceful, knowing expression of automated income/freedom. Bright, sunny natural lighting; shallow depth of field focusing sharply on her face and expression. She seats if front of the camera, to speak for a vlog",
  "A photorealistic medium close-up shot. It features the specific young woman. She is seated comfortably and elegantly inside a luxurious First-Class airplane suite (Emirates A380 style), featuring rich wood paneling and gold accents.  Her signature gold jewelry and a refined black top are visible. Soft, diffused daylight from the aircraft windows illuminates her features. The shot emphasizes productiveness within high luxury. She seats if front of the camera, to speak for a vlog. I want the girl to hold the camera in selfie mode like. No overlay ",
  "A photorealistic close-up portrait. View from inside the car, smiling girl. It features the specific young woman. She is seated in the driver's seat of a high-end luxury supercar (like a Lamborghini Aventador). She is looking directly and intensely at the camera with an expression of urgency and focused determination. She wears the black top and gold hoop earrings. The interior of the car is dark, accented by dramatic red and blue LED dashboard lights and the ambient glow of passing city lights reflecting on the windshield. Cinematic lighting, dramatic shadows on her face, shallow depth of field, sharp focus on the eyes",
  "A photorealistic, cinematic close-up shot, serving as the first frame of a video. It features the specific young woman .  She is seated at a table in a stylish, modern restaurant. A smartphone is placed on a small tripod on the table directly in front of her, filming in vlog style.  She looks directly into the camera with a confident, engaging expression, about to speak. Her posture is relaxed yet intentional, as if recording a personal vlog.  The background shows a softly blurred restaurant ambiance: warm lighting, subtle movement, tables, and guests out of focus, creating a cozy, premium atmosphere with bokeh highlights.  Lighting: Warm, natural indoor lighting with soft highlights on her face and gentle shadows. Skin texture remains natural and detailed.  Camera & framing: Close-up shot, eye-level angle Camera is static on the tripod (no movement) Slight natural micro-movements from the subject (breathing, minimal head motion) High depth of field on the face, background softly blurred  Do not alter facial proportions, eye shape, or hairstyle.  Visual quality: Ultra-realistic, cinematic rendering 4K resolution, ultra HD Sharp focus on subject, rich details Natural colors, balanced contrast Professional vlog-style aesthetic",
];

const VID_PROMPTS = [
  `Static, locked-off shot using the exact same framing as the reference  @Image Generator #1 .
Do not alter facial proportions, eye shape, or hairstyle.
Subject faces the camera directly in a vlog style.

Natural skin texture, soft highlights, and subtle shadows.

She speaks directly to the camera with a calm, confident, and slightly persuasive tone:
"You officially have zero excuses left not to make content. Why? Because I'm not even real. I'm an AI avatar created by Ramzi, and this is the exact workflow to make videos just like this."

Micro-expressions:
Slight eyebrow raise on each key clause
Controlled pauses between sentences
Brief stillness of the face during pauses for emphasis

Camera remains completely stable (no movement, no zoom).
No changes in framing throughout the clip.
Visual quality:
4K resolution, ultra HD
Sharp clarity with cinematic texture
Natural colors, balanced contrast
Professional, stable image with high detail`,

  `Handheld selfie shot, subject holding the phone at arm's length in vertical framing.
Natural micro-movements from the hand (very subtle sway, slight breathing motion), maintaining a stable and clean composition.
Framing remains consistent with the reference image (same angle, same composition).
Do not alter facial proportions, eye shape, or hairstyle.
Subject looks directly into the camera in a vlog-style setup.
Natural skin texture, soft highlights, and subtle shadows.
She speaks directly to the camera with a calm, confident, smiling, and slightly persuasive tone:
"First, get a photo of your AI avatar.
Second, write a prompt to place your avatar anywhere—like a private jet, or wherever you want.
Third, add a short script… and generate multiple videos in seconds."
Micro-expressions:
Slight eyebrow raise on each key clause
Controlled pauses between sentences
Brief stillness of the face during pauses for emphasis
Camera behavior:
Handheld selfie mode
Subtle natural micro-movements (no jitter, no aggressive shake)
No zoom or reframing
Visual quality:
4K resolution, ultra HD
Sharp clarity with cinematic texture
Natural colors, balanced contrast
Professional, clean image with high detail`,

  `Handheld shot filmed by another person, camera positioned at eye level.
only the girl is visible.
Slight natural handheld micro-movements (very subtle sway, no shake or jitter).
Framing remains consistent throughout the clip (no zoom, no reframing).
Do not alter facial proportions, eye shape, or hairstyle.
Natural skin texture, soft highlights, and gentle shadows.

She looks directly into the camera, speaking with a confident, clear, and slightly persuasive tone:
"You now have the ultimate workflow to post a brand new video every single day.
Pick your niche, generate your AI video, and let the system do the heavy lifting for your brand."
Micro-expressions:
Subtle eyebrow lift on key phrases
Light smile to convey confidence and ease
Natural pauses between sentences
Minimal head movement for realism
Camera behavior:
Handheld by another person
Slight micro-movements only (no aggressive motion)
Stable, professional feel
Visual quality:
4K resolution, ultra HD
Sharp clarity with cinematic texture
Natural colors, balanced contrast
High detail, clean and professional image`,

  `Handheld shot filmed by another person, camera positioned at eye level.
only the girl is visible.
Slight natural handheld micro-movements (very subtle sway, no shake or jitter).
Framing remains consistent throughout the clip (no zoom, no reframing).
Do not alter facial proportions, eye shape, or hairstyle.
Natural skin texture, soft highlights, and gentle shadows.

The girl is approaching her head to the camera during one second like she just noticed that she is filmed. And she says :
"This is exactly how you bring in views, leads, and paying clients on autopilot. The tools are right here. Comment AI if you want to make videos like this"

Micro-expressions:
Subtle eyebrow lift on key phrases
Light smile to convey confidence and ease
Natural pauses between sentences
Minimal head movement for realism
Camera behavior:
Handheld by another person
Slight micro-movements only (no aggressive motion)
Stable, professional feel
Visual quality:
4K resolution, ultra HD
Sharp clarity with cinematic texture
Natural colors, balanced contrast
High detail, clean and professional image`,
];

export function makeUGCTemplate(): {
  nodes: Node<NodeData>[];
  edges: Edge[];
  nodeCounters: Record<string, number>;
} {
  const nodes: Node<NodeData>[] = [];
  const edges: Edge[] = [];

  for (let i = 0; i < 4; i++) {
    const base = i * STRIDE_X;
    const ptImgId = `tpl-pt-${i + 1}`;
    const igId = `tpl-ig-${i + 1}`;
    const ptVidId = `tpl-pv-${i + 1}`;
    const vgId = `tpl-vg-${i + 1}`;

    // Text node for video gen — sits above its video gen node
    nodes.push({
      id: ptVidId,
      type: "promptNode",
      position: { x: base + X_OFFSET * 2, y: -430 },
      style: { width: 260, height: 390 },
      data: { label: `Text #${i + 5}`, status: "idle", prompt: VID_PROMPTS[i] },
    });

    // Video gen node — seedance-2, 9:16, 1080p, sound on
    nodes.push({
      id: vgId,
      type: "videoGeneratorNode",
      position: { x: base + X_OFFSET * 2, y: 0 },
      style: { width: 320, height: 220 },
      data: {
        label: `Video Generator #${i + 1}`,
        status: "done",
        videoModel: "seedance-2",
        aspectRatio: "9:16",
        grokResolution: "1080p",
        sound: true,
        videoUrl: REF_VIDEOS[i],
      },
    });

    // Image gen node — image pre-loaded as a "done" output so the node
    // displays the image and the startFrame edge carries the URL.
    nodes.push({
      id: igId,
      type: "generateNode",
      position: { x: base, y: 620 },
      style: { width: 280, height: 280 },
      data: {
        label: `Image Generator #${i + 1}`,
        status: "done",
        model: "nano-banana-pro",
        aspectRatio: "9:16",
        quality: "2k",
        imageUrl: REF_IMAGES[i],
        r2Url: REF_IMAGES[i],
      },
    });

    // Text node for image gen — sits below its image gen node
    nodes.push({
      id: ptImgId,
      type: "promptNode",
      position: { x: base, y: 1200 },
      style: { width: 260, height: 390 },
      data: { label: `Text #${i + 1}`, status: "idle", prompt: IMG_PROMPTS[i] },
    });

    edges.push({
      id: `tpl-e-pt${i + 1}-ig${i + 1}`,
      source: ptImgId,
      target: igId,
      targetHandle: "prompt",
      animated: false,
      style: edgeStyle("prompt"),
    });

    edges.push({
      id: `tpl-e-ig${i + 1}-vg${i + 1}`,
      source: igId,
      target: vgId,
      targetHandle: "startFrame",
      animated: false,
      style: edgeStyle("startFrame"),
    });

    edges.push({
      id: `tpl-e-pv${i + 1}-vg${i + 1}`,
      source: ptVidId,
      target: vgId,
      targetHandle: "prompt",
      animated: false,
      style: edgeStyle("prompt"),
    });
  }

  // ── Avatar image asset node — single source connected to all 4 IG ref inputs ──
  const avatarId = "tpl-avatar";
  nodes.push({
    id: avatarId,
    type: "imageInputNode",
    position: { x: -380, y: 160 },
    style: { width: 260 },
    data: {
      label:             "Avatar",
      status:            "idle",
      r2Url:             "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/workflow-template/avatar.png",
      imageNaturalRatio: "9 / 16",
    },
  });

  for (let i = 0; i < 4; i++) {
    edges.push({
      id: `tpl-e-avatar-ig${i + 1}`,
      source: avatarId,
      target: `tpl-ig-${i + 1}`,
      targetHandle: "image",
      animated: false,
      style: edgeStyle("image"),
    });
  }

  return {
    nodes,
    edges,
    nodeCounters: { promptNode: 8, generateNode: 4, videoGeneratorNode: 4, imageInputNode: 1 },
  };
}

// ── Split Reaction + Demo starter ────────────────────────────────────────────
// Reaction prompt wording follows F:/CLAUDE/hermes/skills/social-media/
// ugc-foto-realista/templates/prompts.md, "Modo Reaction Shot (Split Funnel:
// IA Reage + Produto Real)".
//
//   Text (avatar still) → Image Generator (gpt-image-2, 9:16 still)
//     → Text (reaction video) → Video Generator (flow-omni-flash, 9:16)
//   Video (demo_input.mp4, filmed by hand) — fed manually, no upstream node
//   Comment — instructs the final POST /api/compose-split step
//
// No compose/concat node exists in the canvas yet; the comment node names the
// manual step until one is built.

const REACTION_STILL_PROMPT =
  "A photorealistic close-up selfie portrait. Subject: the same young woman from reference images, candid close-up selfie framing, phone held at arm's length. " +
  "Action: subtle authentic reaction of surprise/disbelief to something she is viewing on a phone screen positioned just off-lens, one relaxed hand with palm softly covering her mouth in quiet disbelief. " +
  "Camera: front-facing iPhone camera, casual bedroom or bathroom setting, natural side lighting, realistic sensor grain. " +
  "ANTI-AI: locked natural skin with visible pores, no beauty filters, no studio lighting, no gloss.";

const REACTION_VIDEO_PROMPT =
  "Subject: the same young woman from reference images, candid close-up selfie framing.\n" +
  "Action: subtle authentic reaction of surprise/disbelief to something she is viewing on a phone screen positioned just off-lens. Her eyes widen slightly with genuine interest, looking directly ahead at her screen. She raises one relaxed hand with her palm softly covering her mouth in quiet disbelief.\n" +
  "Movement: restrained, natural human micro-motion, gentle inhale, subtle head tilt. Absolutely NO theatrical over-acting, NO exaggerated gasps, NO waving arms.\n" +
  "Camera: front-facing iPhone camera, handheld subtle float, casual bedroom or bathroom setting, natural side lighting, realistic sensor grain.\n" +
  "ANTI-AI: locked natural skin with visible pores, no beauty filters, no studio lighting, no gloss.\n" +
  "Duration: keep the clip 4-5 seconds, static reaction only, no cut.";

export function makeSplitReactionTemplate(): {
  nodes: Node<NodeData>[];
  edges: Edge[];
  nodeCounters: Record<string, number>;
} {
  const stillPromptId = "tpl-split-pt-still";
  const stillImgId = "tpl-split-ig-still";
  const videoPromptId = "tpl-split-pt-video";
  const videoGenId = "tpl-split-vg-reaction";
  const demoInputId = "tpl-split-demo";
  const commentId = "tpl-split-comment";

  const nodes: Node<NodeData>[] = [
    {
      id: stillPromptId,
      type: "promptNode",
      position: { x: 0, y: 0 },
      style: { width: 260, height: 360 },
      data: { label: "Text #1", status: "idle", prompt: REACTION_STILL_PROMPT },
    },
    {
      id: stillImgId,
      type: "generateNode",
      position: { x: 380, y: 0 },
      style: { width: 280, height: 280 },
      data: {
        label: "Image Generator #1",
        status: "idle",
        model: "gpt-image-2",
        aspectRatio: "9:16",
        quality: "2k",
      },
    },
    {
      id: videoPromptId,
      type: "promptNode",
      position: { x: 380, y: 380 },
      style: { width: 260, height: 360 },
      data: { label: "Text #2", status: "idle", prompt: REACTION_VIDEO_PROMPT },
    },
    {
      id: videoGenId,
      type: "videoGeneratorNode",
      position: { x: 760, y: 0 },
      style: { width: 320, height: 220 },
      data: {
        label: "Video Generator #1",
        status: "idle",
        videoModel: "flow-omni-flash",
        aspectRatio: "9:16",
        grokResolution: "1080p",
        sound: true,
      },
    },
    {
      id: demoInputId,
      type: "videoInputNode",
      position: { x: 760, y: 380 },
      style: { width: 280, height: 200 },
      data: { label: "demo_input.mp4 (real product demo, filmed by hand)", status: "idle" },
    },
    {
      id: commentId,
      type: "commentNode",
      position: { x: 1140, y: 190 },
      style: { width: 300, height: 160 },
      data: {
        label: "Comment #1",
        comment:
          "Final step (manual, no canvas node yet): POST /api/compose-split with " +
          "{ reactionUrl: <this Video Generator output>, demoUrl: <demo_input.mp4 above>, overlayText }. " +
          "It hard-cuts the reaction into the real demo and burns in the typography overlay.",
      },
    },
  ];

  const edges: Edge[] = [
    {
      id: "tpl-split-e-pt-still-ig",
      source: stillPromptId,
      target: stillImgId,
      targetHandle: "prompt",
      animated: false,
      style: edgeStyle("prompt"),
    },
    {
      id: "tpl-split-e-ig-vg",
      source: stillImgId,
      target: videoGenId,
      targetHandle: "startFrame",
      animated: false,
      style: edgeStyle("startFrame"),
    },
    {
      id: "tpl-split-e-pt-video-vg",
      source: videoPromptId,
      target: videoGenId,
      targetHandle: "prompt",
      animated: false,
      style: edgeStyle("prompt"),
    },
  ];

  return {
    nodes,
    edges,
    nodeCounters: { promptNode: 2, generateNode: 1, videoGeneratorNode: 1, videoInputNode: 1, commentNode: 1 },
  };
}
