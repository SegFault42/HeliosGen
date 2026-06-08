"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/modelConfig";
import { useWorkflowStore } from "@/lib/store";
import type { User } from "@supabase/supabase-js";
import { Maximize2, Minimize2, ShieldAlert, X } from "lucide-react";
import { GalleryItem, getToken, galleryCache } from "@/lib/galleryUtils";
import { useFolderStore } from "@/lib/folderStore";
import { MediaPickerModal } from "@/components/MediaPickerModal";
import { useSidebar } from "@/components/ui/sidebar";
import { QuickAssist } from "@/components/QuickAssist";
import DotCanvasBackground from "@/components/ui/DotCanvasBackground";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Button } from "@/components/ui/button";
import { browserNotify, requestNotificationPermission } from "@/lib/browserNotify";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

const DEMO_GALLERY_ITEMS: import("@/lib/galleryUtils").GalleryItem[] = [
  {
    id: "demo-1",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/hf_20260421_160252_c4c544a7-07fb-4393-9449-3349e87fc597.png",
    mediaType: "image",
    model: "gpt-image-2",
    quality: "medium",
    source: "generation",
    created_at: "2026-04-21T16:02:52.000Z",
    prompt: `Hyper-realistic game screenshot, next-gen AAA quality,
photorealistic third-person action RPG,
ultra-detailed open world environment,

SCENE:
ancient Greek mountain pass, winter overcast,
heavy grey-white sky, diffuse cold light,
no direct sun — soft flat winter shadows,
broken Greek stone columns half-buried in snow,
ruined stone archway carved with meander patterns,
distant mountain peaks disappearing into grey haze,
snow surface worn and dirty from battle,
muddy boot prints, dark blood spots in snow,
scattered broken arrows half-buried,
volumetric cold mist low to ground,
breath vapor rising from all characters,
loose snow drifting across ground in wind,
depth of field blur on distant mountains,
film grain subtle overlay,

PLAYER CHARACTER:
male hunter-archer, lean muscular build,
photorealistic skin — red nose, chapped lips,
cold weathered face, scar on jaw,
subsurface scattering on skin — cold blue undertone,
worn leather and fur armor — realistic damage,
bear fur pauldron matted and frost-damp,
bronze bracers tarnished green-brown,
quiver on back — arrows worn and real,
bowstring fully drawn, aiming upward,
one knee pressed deep into snow,
snow packed into boot soles and knee,
torn cloak edge fraying in wind,
dark hair with small braids — wet and heavy,
finger tendons white from bowstring tension,
micro detail: sweat, dirt, frost on eyebrows,
dynamic combat pose, motion blur on arrow,

CYCLOPS BOSS:
single massive Cyclops — 7 meters tall,
Argos — Stone Titan,
photorealistic stone-grey cracked skin,
subsurface scattering on skin — cold tone,
wounds and cracks from prior battle,
dried blood on knuckles and arms,
single biological eye — natural amber,
no magic glow — real organic texture,
crude armor from animal hides and rusted iron,
each hide strap and buckle individually detailed,
rusted chains as weapon — links individually rendered,
mid-step forward — weight shift visible,
snow compressing and cracking under foot,
massive exhale breath cloud — animal scale,
expression of focused predatory rage,
muscle and tendon anatomy under skin,
Nanite-level skin and armor detail,

COMBAT MOMENT:
arrow frozen mid-air leaving bowstring,
real arrow physics — no magic trail,
fletching blur from natural spin,
arrowhead glinting in diffuse grey light,
Cyclops single eye tracking the arrow,
chains mid-swing natural motion blur,
snow spray from last footstep impact,
player absolutely still — breath held,
cinematic frozen tension moment,

LIGHTING:
flat diffuse grey overcast sky light,
cold blue-grey color temperature 6500K,
snow reflecting ambient light upward as fill,
natural rim on player from snow bounce,
no god rays, no bloom, no lens flare,
no artificial glow anywhere,
ray-traced global illumination,
path-traced shadows soft and natural,
ACES filmic tone mapping,
slightly desaturated — realistic winter palette,
volumetric cold mist catching diffuse light,
HDR subtle — no blown highlights,
chromatic aberration very subtle on edges,

CAMERA:
slight low angle — player foreground left,
Cyclops dominating center-right upper frame,
grey overcast sky filling top third,
anamorphic 2.39:1 framing,
shallow depth of field — f/2.8,
background mountains soft bokeh,
no lens flare,
feels exactly like paused real gameplay,

TECHNICAL:
Unreal Engine 5.3, Lumen GI, Nanite geometry,
path-traced shadows, 4K resolution,
photorealistic texture detail 16K,
ray-traced ambient occlusion,
film grain subtle, chromatic aberration minimal,
anamorphic lens bokeh on background,
16:9 aspect ratio game screenshot,
God of War + Ghost of Tsushima + Horizon Zero Dawn visual fidelity`,
  },
  {
    id: "demo-2",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/hf_20260421_162100_a9cb557d-1397-42c1-ac16-499c09042ea5.png",
    mediaType: "image",
    model: "gpt-image-2",
    quality: "medium",
    source: "generation",
    created_at: "2026-04-21T16:21:00.000Z",
    prompt: `Horizontal desktop landing page hero section for a fictional snowboard eyewear and mountain gear store called "APEX & SUMMIT" (placeholder). Cinematic sports-tech advertising aesthetic with extreme close-up athletic portrait, reflection-based storytelling, bold condensed voice-command headline, premium performance-brand layout. 16:9 desktop composition.

Canvas: Full-width horizontal 16:9 desktop hero. Deep snow-white to soft icy-blue gradient background with subtle motion-blur snow particles drifting across the frame.

Main hero image: An extreme close-up cinematic portrait of a young professional snowboarder — a woman with her hair pulled back tightly, visible small beads of melted snow on her temples and eyebrows, sun-kissed skin with a subtle athletic glow. She wears oversized performance snowboard goggles with a bold wraparound frame and large mirrored reflective lenses tinted in a vivid amber-gold to deep magenta gradient.

Key storytelling element — the reflection in her goggles: Inside the mirrored lens surface, a sharp and detailed reflection of a dynamic snowboard action scene is visible — a snowboarder mid-air executing a jump off a pristine mountain ridge against bright blue sky, powder snow spraying out behind them, mountain peaks receding into the distance.

Main headline (right side, massive bold condensed sans-serif):
"HEY APEX / CUE MY / 'FIRST DESCENT' / PLAYLIST"

Sub-headline: "Smart goggles for smarter runs."

Palette: icy-blue and snow-white gradient background, warm amber-to-magenta reflective lens, natural sun-kissed skin tones, crisp white typography.
Mood: high-performance athletic, premium technology-forward, cinematic commercial, aspirational mountain sport. Awwwards / Behance site-of-the-day premium sportswear landing page, 4k.`,
  },
  {
    id: "demo-3",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/hf_20260422_144420_5f74e1a3-ff9e-4f59-b8f8-799982bdd36b.png",
    mediaType: "image",
    model: "gpt-image-2",
    quality: "medium",
    source: "generation",
    created_at: "2026-04-22T14:44:20.000Z",
    prompt: `Contemporary commercial lifestyle photograph, luxury snow-sports campaign aesthetic, Moncler × Prada Linea Rossa × Arc'teryx × Jacquemus Ski campaign style, authentic iPhone 16 Pro aesthetic.

Hero concept: a playful commercial selfie moment — a young man and young woman, both snowboarders, pause mid-slope for an intimate joyful selfie where the woman photographs her own reflection in the massive mirrored lens of the man's ski goggles.

Hero subject foreground: a handsome young man in his mid-twenties, slight stubble, confident relaxed expression with a small knowing smile, wearing a ski helmet and oversized chrome-mirrored ski goggles with a reflective silver-blue lens. He wears a vivid electric-orange puffer jacket with technical stitching details.

Reflected in his mirrored goggle lens: the young woman photographer reflected perfectly, holding up an iPhone 16 Pro at arm's length. She wears a hot-pink and magenta gradient ski suit with retro 90s-inspired color-blocking, white ski helmet, long dark hair spilling out in two loose braids, huge bright smile. Behind her in the reflection: snowy alpine mountain peaks, bluebird sky, other skiers, a wooden chalet lodge in the distance.

Color grading: punchy commercial palette with authentic iPhone computational photography signature — electric orange jacket popping aggressively against deep cobalt-blue sky, hot pink and magenta in the reflection, chrome silver-blue mirrored goggle lens.

Shot on iPhone 16 Pro, Moncler × Prada Linea Rossa × Arc'teryx ski campaign aesthetic, joyful high-energy couple, clever conceptual selfie construction, ultra-detailed, vivid saturated alpine color palette.`,
  },
  {
    id: "demo-4",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/hf_20260422_211323_4cc2cdec-06a1-4d10-93b9-a63a44ae5d93.png",
    mediaType: "image",
    model: "gpt-image-2",
    quality: "medium",
    source: "generation",
    created_at: "2026-04-22T21:13:23.000Z",
    prompt: `Surreal cinematic portrait photograph, shot on medium-format film camera (Mamiya 7 II or Pentax 67) with 80mm lens, Kodak Portra 400 film, soft natural Mediterranean afternoon daylight, dreamy painterly color grade with cool ocean blue background and warm earthy skin tones, surrealist documentary aesthetic, Ryan McGinley meets Slim Aarons coastal-dreamlike mood.

A close-up surreal portrait of a young European man in his mid-twenties, captured from behind and slightly to the side at a three-quarter back angle. He's positioned just at the water's edge of a calm Mediterranean sea or coastal harbor.

He has wet sun-bleached light golden-brown hair, slightly tousled and damp from swimming. A glimpse of his face in profile is visible — a sharp masculine cheekbone with light freckles and faint stubble along his jawline. His skin is sun-tanned warm honey-bronze with subtle red flush from the summer sun. A delicate thin gold chain necklace is just visible around his neck.

Draped dramatically across the top of his head and tumbling down the side of his face is a freshly caught raw octopus — a real cephalopod with a soft pinkish-coral mantle sitting balanced on top of his hair like an absurd surreal hat, and multiple long muscular tentacles cascading downward in organic spiral curves. The tentacles are a beautiful gradient of warm amber, peachy-pink, and deep umber-brown tones, the underside revealing rows of perfect circular pale-cream suction cups.

The background is the calm Mediterranean ocean — a vast soft gradient of pale azure-blue at the horizon transitioning into deeper teal-blue. Painterly medium-format film grain, soft Portra color rendering with natural saturation, dreamy surrealist coastal aesthetic.`,
  },
  {
    id: "demo-5",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/hf_20260422_213610_8f9804a3-5fce-48c0-94e0-5147ab7cf3fd.png",
    mediaType: "image",
    model: "gpt-image-2",
    quality: "medium",
    source: "generation",
    created_at: "2026-04-22T21:36:10.000Z",
    prompt: `Horizontal desktop landing page for a fictional virtual outfit try-on service called "DRESSR" (placeholder). Full Y2K / PS2-era video game character select screen aesthetic. Low-poly 3D models, glossy translucent UI panels, aqua-cyan grid backgrounds, pixelated retro typography, chrome bevels.

Background: A deep aqua-cyan gradient background with visible wireframe grid lines receding into perspective. Scanline overlay and slight CRT-monitor glow throughout.

Left panel: A large glossy cyan-chrome-framed display panel containing a low-poly 3D avatar of a young woman standing in a neutral T-pose, rendered in early-2000s PS2 graphics style. She has long dark braided pigtails, wearing a pink cropped tank top, low-rise denim skirt with studded belt — classic Y2K outfit.

Main headline (center, massive Y2K bubble-chrome 3D typography):
"TRY / EVERYTHING."

Right panel — Character roster grid: A massive glossy 3D glass panel with a 7×5 grid of small square portrait thumbnails — each showing a different low-poly 3D avatar wearing a different outfit.

CTA buttons: Two large pill-shaped glossy 3D buttons:
- Left (magenta-pink gradient): "▶ START FITTING"
- Right (cyan-blue gradient): "HOW IT WORKS"

Palette: deep aqua-cyan (#0A4A6B to #5BC0D8), bright magenta-pink (#FF3D8E), cyan highlights (#4FE5FF), chrome silver, pixel-green LCD.
Mood: nostalgic Y2K video game, Sega Dreamcast meets Dance Dance Revolution meets early Flash-era web. Awwwards / Dribbble-quality Y2K revival landing page, 4k.`,
  },
  {
    id: "demo-6",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/hf_20260422_215112_09f9313d-4c93-40d5-8d5b-e6a502fa93c1.png",
    mediaType: "image",
    model: "gpt-image-2",
    quality: "medium",
    source: "generation",
    created_at: "2026-04-22T21:51:12.000Z",
    prompt: `Ultra-realistic next-gen video game screenshot, PS5 gameplay capture, exactly like real game footage, Ghost of Tsushima / Rise of the Ronin quality, NO lens flare, NO bloom, NO light rays, NO glowing effects, natural neutral lighting, overcast bright day.

SCENE — JAPANESE VILLAGE STREET COMBAT:
traditional feudal Japan village, dirt road main street, wooden buildings both sides, merchant stalls, hanging cloth banners, barrels and crates scattered, civilians fleeing in background, dust kicked up from combat movement, overcast white sky — diffuse natural light, photorealistic wood and stone textures, mud on ground, footprints visible, broken pottery on ground.

PLAYER CHARACTER back view center:
female samurai, white and silver armor, clean practical design, no fantasy elements, katana raised in combat guard stance, normal gameplay posture — not cinematic pose, hair tied back practically, armor worn but functional, NO glow on weapons, NO energy effects, just steel catching normal daylight.

ENEMIES:
Enemy 1 (directly ahead 5m): ronin swordsman, grey clothing, brown worn armor, chipped katana, aggressive forward stance mid-attack, "浪人 Ronin" white name above head, red health bar.
Enemy 2 (left flank): spear ashigaru running in, "足軽 Guard" name tag, yellow health bar.
Enemy 3 (right): archer nocking arrow, "弓兵 Archer" name tag, green health bar.

HUD — clean minimal flat game UI with HP bars, minimap, item slots, button prompts.

OVERALL: feels 100% like real PS5 gameplay video, natural camera position, overcast flat natural lighting, every detail sharp and clear, Ghost of Tsushima gameplay screenshot level, 1920x1080 raw capture.`,
  },
  {
    id: "demo-7",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/hf_20260213_180040_5b054efc-50a9-4899-a36c-3505197b90f2.png",
    mediaType: "image",
    model: "gpt-image-2",
    quality: "medium",
    source: "generation",
    created_at: "2026-02-13T18:00:40.000Z",
    prompt: `A fashion-forward full-body editorial shot captures a young woman standing indoors against a clean, plain off-white wall, styled in an eclectic, avant-garde street couture look. The camera is positioned at eye level, straight-on, allowing the entire outfit and silhouette to be clearly visible while maintaining a natural, documentary feel.

She wears a cropped gray faux-fur jacket with a shaggy texture, structured with visible straps and metal buckles that add a utilitarian edge. Underneath, she wears a crisp white button-up shirt left partially open, paired with a patterned purple tie hanging loosely down the center. A low-rise gray skirt with a soft drape sits at the hips.

She wears a black headscarf fitted tightly over short dark hair, paired with futuristic wraparound sunglasses. In her hand, she carries a structured gray handbag adorned with playful charms. On her feet are pointed-toe knee-high boots in a muted lavender-pink tone, detailed with straps, studs, and layered textures.

The setting is minimal and uncluttered, with a simple wooden floor and a plain wall. Lighting is soft and natural, evenly illuminating the subject without harsh shadows.

The overall mood is experimental, rebellious, and fashion-centric, blending Y2K influences, cyber-streetwear, and deconstructed tailoring. Color palette is built around cool grays, muted purples, soft pinks, black accents, and subtle metallic tones.`,
  },
  {
    id: "demo-8",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/hf_20260214_192051_a5f7769c-4e56-4d82-a9d5-cd2880c58439.png",
    mediaType: "image",
    model: "gpt-image-2",
    quality: "medium",
    source: "generation",
    created_at: "2026-02-14T19:20:51.000Z",
    prompt: `A high-angle medium shot features a young East Asian woman, possibly in her early 20s, with a short, black bob hairstyle situated against a façade featuring large window blinds. She poses in an edgy outfit consisting of a glossy, deep brown leather bomber jacket with elastic cuffs, a white corset-style top, a red striped tie, and an asymmetric, black distressed denim skirt with a frayed hemline and visible seams. A large, riveted belt cinches her waist. She accessorizes with sparkling bracelets and a rectangular black handbag with a chain strap placed beside her.

The background showcases a light beige stone step and wall, with a modern glass window to her right. The lighting is natural with a soft shadow, and the color palette is muted with dark and neutral tones. Captured digitally with deep focus, giving the setting a crisp and urban aesthetic reminiscent of fashion editorial photography.`,
  },
  {
    id: "demo-9",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/hf_20260218_130714_2430d3a3-b8b2-4c9e-894d-b29503ee12c0.png",
    mediaType: "image",
    model: "gpt-image-2",
    quality: "medium",
    source: "generation",
    created_at: "2026-02-18T13:07:14.000Z",
    prompt: `A straight-on medium shot depicts a young Asian woman, approximately in her 20s, sitting against a distressed concrete wall backdrop. She has long straight blonde hair and wears clear glasses. Her attire includes a pinstriped button-up blouse with a tie scarf detail, paired with a short black skirt. Distinctive items in her outfit are her shiny black patent knee-high boots featuring wedge heels.

The concrete wall behind her is aged and weathered, contributing to an industrial yet grunge atmosphere. The lighting is diffuse, seemingly natural ambient light filtering in, casting soft shadows and highlighting her smooth skin. The color palette consists of neutral tones, including her clothing and the beige of the concrete, with slight accents from her hair and glasses. The image emphasizes clarity in details yet maintains a slightly muted urban and edgy mood.`,
  },
  {
    id: "demo-10",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/hf_20260218_140039_e4358650-a940-43d9-90e6-3d07a9b9c7bd.png",
    mediaType: "image",
    model: "gpt-image-2",
    quality: "medium",
    source: "generation",
    created_at: "2026-02-18T14:00:39.000Z",
    prompt: `A medium shot captures the midsection of a young woman with a fair skin tone, showcasing edgy, alternative fashion. Her attire features an oversized, distressed black knit crop top adorned with metallic pyramid studs forming an abstract pattern. She pairs it with high-waisted, loose-fitting gray denim pants adorned with a black belt matching silver studs, and stacks of metallic and black cuff bracelets on her wrists.

The backdrop consists of a sheer white curtain, creating a minimalist, neutral setting. The lighting is soft and ambient, producing gentle shadows and highlights. The color palette is focused on blacks, grays, and metallics, conveying a modern and edgy atmosphere.`,
  },
  {
    id: "demo-11",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/hf_20260218_142536_7eadd267-55c2-43b3-acb5-a748230ca3ad.png",
    mediaType: "image",
    model: "gpt-image-2",
    quality: "medium",
    source: "generation",
    created_at: "2026-02-18T14:25:36.000Z",
    prompt: `An overhead close-up shot captures the hands of an individual with light skin tone, showcasing long stiletto-shaped acrylic nails. The nails are a gradient of dusty pink, transitioning to beige tips, emphasizing an elongated and dramatic shape. The hands have visible tattoos, including intricate linework and geometric designs. Silver rings adorn fingers on both hands, adding a metallic contrast to the natural hues. The person's sleeves have a lace edge detail, contributing a delicate texture against the boldness of the nails.

Lighting is soft and diffused, reducing shadows and lending the image a flat, almost clinical aesthetic. The color palette is predominantly neutral with beige, pink, and silver tones. The composition centers the hands against a plain, light gray backdrop, enhancing focus on the nail art and tattoos. The image is sharp with fine details on the skin and fabric textures, creating a bold and edgy atmosphere.`,
  },
];

const DEMO_VIDEO_ITEMS: import("@/lib/galleryUtils").GalleryItem[] = [
  {
    id: "demo-v1",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/1.mp4",
    mediaType: "video",
    model: "Seedance 2.0",
    source: "generation",
    created_at: "2026-04-22T10:00:00.000Z",
    prompt: `A young skateboarder in a black t-shirt and baggy jeans performs tricks at a brutalist concrete skatepark on a sunny afternoon. The camera alternates between a fisheye lens ground-level POV following his board and wider angles capturing kickflips and grinds. Harsh midday shadows, raw street-skating documentary style, warm golden tones.`,
  },
  {
    id: "demo-v2",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/2.mp4",
    mediaType: "video",
    model: "Seedance 2.0",
    source: "generation",
    created_at: "2026-04-22T10:05:00.000Z",
    prompt: `Extreme macro close-up of ornate stone chess pieces on a wooden chessboard inside a stylish mid-century modern living room. A hand reaches in to move a piece. The camera slowly descends to board level, revealing the intricate carved detail of a king and queen piece towering like monumental sculptures. Warm interior lighting, shallow depth of field, elegant product-cinematography aesthetic.`,
  },
  {
    id: "demo-v3",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/3.mp4",
    mediaType: "video",
    model: "Seedance 2.0",
    source: "generation",
    created_at: "2026-04-22T10:10:00.000Z",
    prompt: `A man in a dark hoodie stands in the center of a vast industrial facility filled with metal pipes and overhead fluorescent strip lights. His body begins to morph and assemble into a sleek dark robotic exosuit. The camera pulls back to reveal fallen mechanical wreckage on the floor around him. Dark sci-fi atmosphere, cold blue-grey tones, dramatic low-angle transformation sequence.`,
  },
  {
    id: "demo-v4",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/4.mp4",
    mediaType: "video",
    model: "Seedance 2.0",
    source: "generation",
    created_at: "2026-04-22T10:15:00.000Z",
    prompt: `Underwater close-up inside a planted freshwater aquarium. A piece of raw meat drifts down through the water. Two large piranhas with dark bodies and orange-red bellies surge forward and tear into the meat aggressively, pulling it apart. Driftwood and lush green aquatic plants fill the background. Crystal-clear water, nature-documentary macro photography, dramatic feeding behavior.`,
  },
  {
    id: "demo-v5",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/5.mp4",
    mediaType: "video",
    model: "Seedance 2.0",
    source: "generation",
    created_at: "2026-04-22T10:20:00.000Z",
    prompt: `Close-up portrait of a young woman with wavy honey-blonde hair walking on a city street at night. She holds a coffee cup in one hand and a smartphone in the other, looking at the screen with a pouty expression. She wears a navy blue and white striped athletic jacket. Out-of-focus city lights and car headlights create warm red and orange bokeh in the background. The camera slowly orbits around her face. Nighttime urban setting, shallow depth of field, warm skin tones lit by the phone screen glow, candid street photography style, cinematic close-up.`,
  },
  {
    id: "demo-v6",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/6.mp4",
    mediaType: "video",
    model: "Seedance 2.0",
    source: "generation",
    created_at: "2026-04-22T10:25:00.000Z",
    prompt: `Cinematic tracking shot following a young woman with long pink hair walking through a high school hallway lined with lockers. She wears a white cropped zip-up hoodie and carries a black backpack over one shoulder, looking down pensively. Other students move in the background. The camera slowly orbits from a front-facing medium shot to behind her as she continues walking. Warm tungsten overhead lighting, shallow depth of field, 2000s teen drama aesthetic, shot on anamorphic lens with subtle lens flares.`,
  },
  {
    id: "demo-v7",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/7.mp4",
    mediaType: "video",
    model: "Seedance 2.0",
    source: "generation",
    created_at: "2026-04-22T10:30:00.000Z",
    prompt: `Inside a sandy desert terrarium with dried branches and a small cactus, a large hairy tarantula and an orange scorpion converge on a piece of raw pink meat placed on the substrate. They grapple over the food in a tense confrontation. Warm overhead lighting, extreme macro close-up, nature-documentary tension, detailed textures of chitin and sand.`,
  },
  {
    id: "demo-v8",
    url: "https://pub-73a59b956f1c4a7db2934522c13d8027.r2.dev/demo-mode/8.mp4",
    mediaType: "video",
    model: "Seedance 2.0",
    source: "generation",
    created_at: "2026-04-22T10:35:00.000Z",
    prompt: `A young woman with bright orange-red hair and chunky over-ear headphones sits at an airport terminal gate by a floor-to-ceiling window, eating sushi from a small plate. She wears a sporty racing-style jacket. Travelers pull luggage past her in the background. Natural daylight streams through the glass, casual candid moment, shallow depth of field, travel lifestyle aesthetic.`,
  },
];

function randomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const NEXT_IMG_WIDTHS = [16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840];

function thumbSrc(url: string, w = 128): string {
  if (!url || url.startsWith("blob:") || url.startsWith("data:") || url.startsWith("/_next/")) return url;
  // Target 2× the CSS pixel width for HiDPI displays; snap up to the nearest allowed size.
  const target = w * 2;
  const snapped = NEXT_IMG_WIDTHS.find(s => s >= target) ?? NEXT_IMG_WIDTHS[NEXT_IMG_WIDTHS.length - 1];
  return `/_next/image?url=${encodeURIComponent(url)}&w=${snapped}&q=75`;
}

interface RefImage {
  id: string;
  objectUrl: string;
  cdnUrl: string | null;
  uploading: boolean;
  error: boolean;
}

interface PendingGen {
  id: string;
  aspectRatio: string;
  prompt: string;
  referenceImageUrls?: string[];
  error?: string;
  taskId?: string;
  createdAt?: string;
  tab?: Tab;
  prePending?: boolean;
  retried?: boolean;
  folderId?: string | null;
}


interface DownloadTask {
  id: string;
  filename: string;
  status: "preparing" | "ready" | "error";
}

type Tab = "images" | "videos";

interface TaggedImage {
  label: string;
  refId: string;
  url: string;
  kind?: "image" | "video" | "audio";
}

interface KlingElement {
  id: string;
  name: string;
  description: string;
  imageUrls: string[];
}

function resolveGalleryMentions(
  text: string,
  tagged: TaggedImage[],
  tagFormat: "default" | "grok" = "default",
): { resolvedPrompt: string; extraUrls: string[]; extraAssets: { url: string; kind: "image" | "video" | "audio" }[] } {
  if (!tagged.length) return { resolvedPrompt: text, extraUrls: [], extraAssets: [] };
  type Span = { start: number; end: number; url: string; kind: "image" | "video" | "audio" };
  const spans: Span[] = [];
  const claimed = new Set<number>();
  for (const t of [...tagged].sort((a, b) => b.label.length - a.label.length)) {
    const escaped = t.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`@${escaped}(?!\\w)`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (!claimed.has(m.index)) {
        spans.push({ start: m.index, end: m.index + m[0].length, url: t.url, kind: t.kind || "image" });
        claimed.add(m.index);
      }
    }
  }
  spans.sort((a, b) => a.start - b.start);
  if (!spans.length) return { resolvedPrompt: text, extraUrls: [], extraAssets: [] };
  const extraUrls: string[] = [];
  const extraAssets: { url: string; kind: "image" | "video" | "audio" }[] = [];
  const seenUrlIndex = new Map<string, number>(); // url → 1-based slot already assigned
  let resolvedPrompt = "";
  let lastEnd = 0;
  let n = 1;
  for (const span of spans) {
    resolvedPrompt += text.slice(lastEnd, span.start);
    let slot: number;
    if (seenUrlIndex.has(span.url)) {
      slot = seenUrlIndex.get(span.url)!;
    } else {
      slot = n++;
      seenUrlIndex.set(span.url, slot);
      extraUrls.push(span.url);
      extraAssets.push({ url: span.url, kind: span.kind });
    }
    resolvedPrompt += tagFormat === "grok" ? `@image${slot} ` : `<<<image ${slot}>>>`;
    lastEnd = span.end;
  }
  resolvedPrompt += text.slice(lastEnd);
  return { resolvedPrompt, extraUrls, extraAssets };
}

function splitByMentions(
  text: string,
  baseColor: string | undefined,
  tagged: TaggedImage[],
  keyStart: number,
  onEnter: (tag: TaggedImage, rect: DOMRect) => void,
  onLeave: () => void,
  onMouseDown: (tag: TaggedImage) => void,
): { nodes: React.ReactNode[]; nextKey: number } {
  if (!tagged.length) {
    return {
      nodes: [<span key={keyStart} style={baseColor ? { color: baseColor } : undefined}>{text}</span>],
      nextKey: keyStart + 1,
    };
  }
  const sorted = [...tagged].sort((a, b) => b.label.length - a.label.length);
  const nodes: React.ReactNode[] = [];
  let k = keyStart;
  let rest = text;
  while (rest.length > 0) {
    let earliest: { idx: number; tag: TaggedImage } | null = null;
    for (const tag of sorted) {
      const idx = rest.indexOf(`@${tag.label}`);
      if (idx !== -1 && (earliest === null || idx < earliest.idx)) earliest = { idx, tag };
    }
    if (!earliest) {
      nodes.push(<span key={k++} style={baseColor ? { color: baseColor } : undefined}>{rest}</span>);
      break;
    }
    if (earliest.idx > 0) {
      nodes.push(<span key={k++} style={baseColor ? { color: baseColor } : undefined}>{rest.slice(0, earliest.idx)}</span>);
    }
    const tag = earliest.tag;
    nodes.push(
      <span
        key={k++}
        style={{ color: "#2DD4BF", fontWeight: 500, cursor: "text", pointerEvents: "auto", userSelect: "none", background: "rgba(119,229,68,0.15)", boxShadow: "0 0 0 3px rgba(119,229,68,0.15)", borderRadius: "3px" }}
        onMouseEnter={e => onEnter(tag, e.currentTarget.getBoundingClientRect())}
        onMouseLeave={onLeave}
        onMouseDown={e => { e.preventDefault(); onMouseDown(tag); }}
      >
        @{tag.label}
      </span>,
    );
    rest = rest.slice(earliest.idx + tag.label.length + 1);
  }
  return { nodes, nextKey: k };
}

function renderGalleryMentions(
  text: string,
  tagged: TaggedImage[],
  onEnter: (tag: TaggedImage, rect: DOMRect) => void,
  onLeave: () => void,
  onMouseDown: (tag: TaggedImage) => void,
): React.ReactNode {
  if (!text) return null;
  if (!tagged.length) return <span style={{ color: "#e8e8e6" }}>{text}</span>;

  const sorted = [...tagged].sort((a, b) => b.label.length - a.label.length);
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;

  while (rest.length > 0) {
    let earliest: { idx: number; tag: TaggedImage } | null = null;
    for (const tag of sorted) {
      const idx = rest.indexOf(`@${tag.label}`);
      if (idx !== -1 && (earliest === null || idx < earliest.idx)) earliest = { idx, tag };
    }
    if (!earliest) { parts.push(<span key={key++} style={{ color: "#e8e8e6" }}>{rest}</span>); break; }
    if (earliest.idx > 0) parts.push(<span key={key++} style={{ color: "#e8e8e6" }}>{rest.slice(0, earliest.idx)}</span>);
    const tag = earliest.tag;
    parts.push(
      <span
        key={key++}
        style={{
          color: "#2DD4BF",
          fontWeight: 500,
          cursor: "text",
          pointerEvents: "auto",
          userSelect: "none",
          background: "rgba(119,229,68,0.15)",
          boxShadow: "0 0 0 3px rgba(119,229,68,0.15)",
          borderRadius: "3px",
        }}
        onMouseEnter={e => onEnter(tag, e.currentTarget.getBoundingClientRect())}
        onMouseLeave={onLeave}
        onMouseDown={e => { e.preventDefault(); onMouseDown(tag); }}
      >
        @{tag.label}
      </span>,
    );
    rest = rest.slice(earliest.idx + tag.label.length + 1);
  }
  return <>{parts}</>;
}

function resizeTextarea(el: HTMLTextAreaElement, maxH = 264) {
  const st = el.scrollTop;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, maxH) + "px";
  el.scrollTop = st;
}


const loadedImageUrls = new Set<string>();
const naturalRatioCache = new Map<string, string>(); // url → "w / h"

// Concurrency limiter: at most 4 gallery images load simultaneously.
const _imgQueue: Array<() => void> = [];
let _imgActive = 0;
const IMG_CONCURRENCY = 4;
function requestImageSlot(fn: () => void): () => void {
  if (_imgActive < IMG_CONCURRENCY) { _imgActive++; fn(); return () => {}; }
  _imgQueue.push(fn);
  return () => { const i = _imgQueue.indexOf(fn); if (i !== -1) _imgQueue.splice(i, 1); };
}
function releaseImageSlot() {
  _imgActive = Math.max(0, _imgActive - 1);
  const next = _imgQueue.shift();
  if (next) { _imgActive++; next(); }
}

// Module-level store for gallery drag — avoids dataTransfer.getData() browser quirks
let _galleryDragItem: { url: string; mediaType: string } | null = null;
let _reorderDragItem: { id: string; listTarget: "refImage" | "resource" | "referenceVideo" | "audioRef" } | null = null;
let _reorderOverId: string | null = null; // last non-ghost item entered during reorder drag
let _reorderJustDropped = false; // set synchronously in handleReorderDrop; read in onClick to block accidental preview open

// Restore previously discovered aspect ratios and loaded state from
// sessionStorage so the layout is correct immediately on cold page loads.
if (typeof window !== "undefined") {
  try {
    const ratios = JSON.parse(sessionStorage.getItem("hg-ratios") ?? "{}") as Record<string, string>;
    for (const [url, r] of Object.entries(ratios)) naturalRatioCache.set(url, r);
  } catch {}
  try {
    const loaded = JSON.parse(sessionStorage.getItem("hg-loaded") ?? "[]") as string[];
    for (const url of loaded) loadedImageUrls.add(url);
  } catch {}
}

function mergeByNewest(prev: GalleryItem[], incoming: GalleryItem[]): GalleryItem[] {
  const seen = new Set(prev.map(i => i.id));
  const brandNew = incoming.filter(i => !seen.has(i.id));
  if (brandNew.length === 0) return prev;
  return [...prev, ...brandNew].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

interface SavedSettings {
  prompt: string; modelId: string; aspectRatio: string;
  quality: string; count: number; duration: number; mode: string;
  sound?: boolean;
  refImageUrls?: string[];
  azureResolution?: string;
  promptTextMode?: "text" | "json" | "yaml";
  multiPromptMode?: boolean;
  vidStartFrameUrl?: string | null;
  vidEndFrameUrl?: string | null;
  vidResourceUrls?: string[];
  vidVideoRefUrl?: string | null;
  vidRefVideoUrls?: string[];
  vidRefAudioUrls?: string[];
  vidElements?: KlingElement[];
  taggedImages?: TaggedImage[];
}

function settingsKey(tab: Tab, folderId: string | null): string {
  return folderId ? `nf-gallery-${tab}-folder-${folderId}` : `nf-gallery-${tab}`;
}

function loadSettings(tab: Tab, folderId: string | null): Partial<SavedSettings> | null {
  if (typeof window === "undefined") return null;
  try { const r = localStorage.getItem(settingsKey(tab, folderId)); return r ? JSON.parse(r) : null; }
  catch { return null; }
}

function saveSettings(tab: Tab, folderId: string | null, s: SavedSettings) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(settingsKey(tab, folderId), JSON.stringify(s)); } catch {}
}

function loadKlingElements(): KlingElement[] {
  if (typeof window === "undefined") return [];
  try { const r = localStorage.getItem("nf-kling-elements"); return r ? (JSON.parse(r) as KlingElement[]) : []; } catch { return []; }
}

function saveKlingElements(elements: KlingElement[]) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem("nf-kling-elements", JSON.stringify(elements)); } catch { }
}

// ── Pending generation tile (needs hooks, must be a component) ────────────────

function PendingGenTile({ pg, onCancel }: { pg: PendingGen; onCancel: () => void }) {
  return (
    <>
      {/* Top radial glow — blue-emerald with slow pulse */}
      <div style={{
        position: "absolute", top: "-40%", left: "50%", transform: "translateX(-50%)",
        width: "180%", height: "80%", pointerEvents: "none",
        background: "radial-gradient(ellipse at 50% 20%, rgba(20,160,140,0.45) 0%, rgba(30,100,200,0.2) 40%, transparent 70%)",
        animation: "pendingGlow 3s ease-in-out infinite",
      }} />
      {/* Top: phase label + cancel — same row, wraps to next line if too narrow */}
      <div style={{
        position: "absolute", top: 8, left: 8, right: 8,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: "6px",
        zIndex: 5,
      }}>
        {/* Phase pill */}
        <div style={{
          display: "flex", alignItems: "center", gap: "6px",
          height: "26px", padding: "0 10px", borderRadius: "999px",
          background: "rgba(0,0,0,0.58)", backdropFilter: "blur(10px)",
          border: pg.prePending ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(45,212,191,0.25)",
          pointerEvents: "none", flexShrink: 0,
        }}>
          {pg.prePending ? (
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" style={{ animation: "spin 0.9s linear infinite", flexShrink: 0 }}>
              <circle cx="5" cy="5" r="4" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
              <path d="M5 1 A4 4 0 0 1 9 5" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" style={{ animation: "spin 0.9s linear infinite", flexShrink: 0 }}>
              <circle cx="5" cy="5" r="4" stroke="rgba(45,212,191,0.25)" strokeWidth="1.5" />
              <path d="M5 1 A4 4 0 0 1 9 5" stroke="#2DD4BF" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
          <span style={{ fontSize: "11px", color: pg.prePending ? "#888" : "#2DD4BF", fontWeight: 500 }}>
            {pg.prePending ? "Pending" : "Generating…"}
          </span>
        </div>

        {/* Cancel pill — only before generation starts */}
        {pg.prePending && (
          <button
            onClick={onCancel}
            style={{
              flexShrink: 0,
              display: "flex", alignItems: "center", gap: "5px",
              height: "26px", padding: "0 10px", borderRadius: "999px",
              background: "rgba(0,0,0,0.58)", backdropFilter: "blur(10px)",
              border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer",
              transition: "background 140ms",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,0,0,0.58)")}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="m6 6 12 12" />
            </svg>
            <span style={{ fontSize: "11px", color: "#ccc", fontWeight: 500 }}>Cancel</span>
          </button>
        )}
      </div>

      {/* Bottom: prompt */}
      {pg.prompt && (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "24px 10px 10px", background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 100%)" }}>
          <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.35)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{pg.prompt}</p>
        </div>
      )}
    </>
  );
}

// ── Logged-out empty state ────────────────────────────────────────────────────

const CYCLE_NAMES = ["Nano Banana Pro", "GPT Image 2", "Nano Banana 2"];
const VIDEO_CYCLE_NAMES = ["Seedance 2.0", "Kling 3.0", "Happy Horse"];
const EMPTY_IMGS = ["/1.webp", "/2.webp", "/3.webp", "/4.webp"];

function EmptyFan({ blur }: { blur?: boolean }) {
  const configs = [
    { rot: "-10deg", rounded: false, border: true, mr: "clamp(-36px,-1.5vw,-16px)", z: 4 },
    { rot: "4deg",   rounded: false, border: true,  mr: "clamp(-36px,-1.5vw,-16px)", z: 3 },
    { rot: "180deg", rounded: true,  border: true,  mr: "clamp(-36px,-1.5vw,-16px)", z: 2 },
    { rot: "-4deg",  rounded: false, border: true,  mr: "0",                         z: 1 },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", position: blur ? "absolute" : undefined, left: blur ? "50%" : undefined, top: blur ? 0 : undefined, transform: blur ? "translateX(-50%)" : undefined, filter: blur ? "blur(32px)" : undefined, opacity: blur ? 0.4 : 1 }}>
      {configs.map((c, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginRight: c.mr, zIndex: c.z }}>
          <div style={{ transform: `rotate(${c.rot})${c.rounded ? " scaleY(-1)" : ""}` }}>
            <div style={{ position: "relative", overflow: "hidden", width: "clamp(64px,min(12vw,16vh),172px)", height: "clamp(64px,min(12vw,16vh),172px)", borderRadius: c.rounded ? "50%" : "12px", border: c.border ? "3px solid rgba(45,212,191,0.75)" : undefined, boxShadow: c.border ? "0 0 14px rgba(45,212,191,0.35), 0 0 4px rgba(45,212,191,0.2)" : undefined }}>
              <img src={EMPTY_IMGS[i]} alt="" style={{ objectFit: "cover", width: "100%", height: "100%", display: "block" }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function GalleryLoggedOut({ tab }: { tab: Tab }) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  const names = tab === "videos" ? VIDEO_CYCLE_NAMES : CYCLE_NAMES;

  useEffect(() => {
    setIdx(0);
    setVisible(true);
  }, [tab]);

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % names.length);
        setVisible(true);
      }, 380);
    }, 2600);
    return () => clearInterval(timer);
  }, [names]);

  return (
    <div style={{ flex: 1, background: "#0B0E14", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "clamp(12px,2.5vh,32px)", alignItems: "center", width: "100%", position: "relative" }}>
        {tab === "videos" ? <><VideoFan blur /><VideoFan /></> : <><EmptyFan blur /><EmptyFan /></>}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "8px" }}>
          <div style={{ fontFamily: "var(--font-grotesk, sans-serif)", fontWeight: 700, fontSize: "clamp(20px,min(3vw,4.5vh),36px)", lineHeight: 1, letterSpacing: "-0.56px", textTransform: "uppercase" }}>
            <p style={{ color: "#fff", margin: 0 }}>Start creating with</p>
            <p style={{ color: "#2DD4BF", margin: 0, transition: "opacity 380ms ease, transform 380ms ease", opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(6px)" }}>
              {names[idx]}
            </p>
          </div>
          <p style={{ fontSize: "clamp(13px,1.2vw,15px)", color: "rgba(255,255,255,0.65)", margin: 0 }}>Describe a scene, character, mood, or style — and watch it come to life</p>
        </div>
      </div>
    </div>
  );
}

// ── Tag renumbering helper ─────────────────────────────────────────────────────

function removeTagAndRenumber(
  removedRefId: string,
  removedUrl: string | null,
  currentTaggedImages: TaggedImage[],
  currentPrompt: string,
): { newTaggedImages: TaggedImage[]; newPrompt: string } {
  const removedTag = currentTaggedImages.find(
    t => t.refId === removedRefId || (removedUrl != null && t.url === removedUrl),
  );
  if (!removedTag) return { newTaggedImages: currentTaggedImages, newPrompt: currentPrompt };

  const m = removedTag.label.match(/^([^\d]*)(\d+)$/);
  if (!m) {
    return {
      newTaggedImages: currentTaggedImages.filter(t => t !== removedTag),
      newPrompt: currentPrompt.replace(new RegExp(`@${removedTag.label}\\b`, 'g'), ''),
    };
  }

  const prefix = m[1];
  const removedN = parseInt(m[2]);

  const newTaggedImages = currentTaggedImages
    .filter(t => t !== removedTag)
    .map(t => {
      const tm = t.label.match(/^([^\d]*)(\d+)$/);
      if (!tm || tm[1] !== prefix) return t;
      const n = parseInt(tm[2]);
      return n > removedN ? { ...t, label: `${prefix}${n - 1}` } : t;
    });

  // Remove the deleted tag from prompt, then renumber higher ones ascending
  // (ascending order avoids regex collision: @image2→@image1 before @image3→@image2)
  let newPrompt = currentPrompt.replace(new RegExp(`@${prefix}${removedN}\\b`, 'g'), '');

  const higherNs = currentTaggedImages
    .filter(t => t !== removedTag)
    .flatMap(t => { const tm = t.label.match(/^([^\d]*)(\d+)$/); return tm && tm[1] === prefix && parseInt(tm[2]) > removedN ? [parseInt(tm[2])] : []; })
    .sort((a, b) => a - b);

  for (const n of higherNs) {
    newPrompt = newPrompt.replace(new RegExp(`@${prefix}${n}\\b`, 'g'), `@${prefix}${n - 1}`);
  }

  return { newTaggedImages, newPrompt };
}

function getDisplayOrder(arr: RefImage[], draggingId: string | null, overId: string | null): RefImage[] {
  if (!draggingId || !overId || draggingId === overId) return arr;
  const dragIdx = arr.findIndex(r => r.id === draggingId);
  const overIdx = arr.findIndex(r => r.id === overId);
  if (dragIdx === -1 || overIdx === -1) return arr;
  const next = [...arr];
  const [moved] = next.splice(dragIdx, 1);
  next.splice(overIdx, 0, moved);
  return next;
}

function reorderAndRenumberTags(
  _oldArr: RefImage[],
  newArr: RefImage[],
  prefix: string,
  currentTaggedImages: TaggedImage[],
  currentPrompt: string,
): { newTaggedImages: TaggedImage[]; newPrompt: string } {
  // Build label → RefImage mapping for the new order.
  // @imageN is a positional reference to the Nth attached item; when the user
  // reorders, we update the URL/refId behind each label rather than renaming
  // labels in the prompt — that way resolveGalleryMentions produces extraUrls
  // in the new order and <<<image N>>> in the resolved prompt matches the
  // dragged position.
  const labelToRef = new Map<string, RefImage>();
  for (let i = 0; i < newArr.length; i++) {
    labelToRef.set(`${prefix}${i + 1}`, newArr[i]);
  }

  let changed = false;
  const newTaggedImages = currentTaggedImages.map(t => {
    const ref = labelToRef.get(t.label);
    if (!ref || ref.id === t.refId) return t;
    changed = true;
    return { ...t, refId: ref.id, url: ref.cdnUrl ?? ref.objectUrl };
  });

  if (!changed) return { newTaggedImages: currentTaggedImages, newPrompt: currentPrompt };
  return { newTaggedImages, newPrompt: currentPrompt };
}

// ── Inner page ────────────────────────────────────────────────────────────────

function GalleryInner() {
  const { state, isMobile } = useSidebar();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab = (rawTab === "videos" ? "videos" : "images") as Tab;
  const rawSource = searchParams.get("source");
  const initialSource = (rawSource === "uploaded" ? "uploaded" : "generated") as "generated" | "uploaded";

  const { selectedFolderId, itemFolderMap, assignItemsToFolder, removeItemsFromFolder, folders, addUnseenFolder } = useFolderStore();

  const [user, setUser] = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  const [items, setItems] = useState<GalleryItem[]>(() => {
    if (DEMO_MODE) return tab === "images" ? DEMO_GALLERY_ITEMS : DEMO_VIDEO_ITEMS;
    const initSrc = initialSource === "uploaded" ? "upload" : "generation";
    return galleryCache.get(`${tab}-${initSrc}`)?.items ?? [];
  });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(() => {
    if (DEMO_MODE) return false;
    const initSrc = initialSource === "uploaded" ? "upload" : "generation";
    return galleryCache.get(`${tab}-${initSrc}`)?.hasMore ?? true;
  });
  const [lightboxItem, setLightboxItem] = useState<GalleryItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const anySelected = selectedIds.size > 0;
  const toggleSelect = (id: string) => setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const clearSelection = () => { setSelectedIds(new Set()); setFolderPickerOpen(false); };

  const isVideo = tab === "videos";
  const models = isVideo ? VIDEO_MODELS : IMAGE_MODELS;

  const skipNextModelEffect = useRef(false);

  const [prompt, setPrompt] = useState<string>(() => loadSettings(tab, selectedFolderId)?.prompt ?? "");
  const prevFolderIdRef = useRef<string | null>(selectedFolderId);
  const settingsSnapshotRef = useRef<SavedSettings | null>(null);
  const [modelId, setModelId] = useState<string>(() => {
    const s = loadSettings(tab, selectedFolderId);
    return (s?.modelId && models.find(m => m.id === s.modelId)) ? s.modelId : models[0].id;
  });
  const [aspectRatio, setAspectRatio] = useState<string>(() => {
    const s = loadSettings(tab, selectedFolderId);
    const mId = (s?.modelId && models.find(m => m.id === s.modelId)) ? s.modelId : models[0].id;
    const mdl = models.find(m => m.id === mId) ?? models[0];
    if (s?.aspectRatio && mdl.ratios.includes(s.aspectRatio)) return s.aspectRatio;
    return ("defaultRatio" in mdl ? (mdl as { defaultRatio: string }).defaultRatio : null) ?? mdl.ratios[0] ?? "1:1";
  });
  const [quality, setQuality] = useState<string>(() => loadSettings(tab, selectedFolderId)?.quality ?? "2k");
  const [isAzureProvider, setIsAzureProvider] = useState<boolean>(false);
  const [count, setCount] = useState<number>(() => loadSettings(tab, selectedFolderId)?.count ?? 1);
  const [duration, setDuration] = useState<number>(() => loadSettings(tab, selectedFolderId)?.duration ?? 5);
  const [mode, setMode] = useState<string>(() => loadSettings(tab, selectedFolderId)?.mode ?? "");
  const [resolution, setResolution] = useState<string>("");
  const [azureResolution, setAzureResolution] = useState<string>(() => loadSettings(tab, selectedFolderId)?.azureResolution ?? "1k");
  const [sound, setSound] = useState<boolean>(() => loadSettings(tab, selectedFolderId)?.sound ?? false);
  const [seed, setSeed] = useState<number | undefined>(0);
  const [durPickerOpen, setDurPickerOpen] = useState(false);
  const [durPickerClosing, setDurPickerClosing] = useState(false);
  const [durPickerPos, setDurPickerPos] = useState<{ left: number; bottom: number } | null>(null);
  const durPillRef = useRef<HTMLButtonElement>(null);
  const durCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingGens, setPendingGens] = useState<PendingGen[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem("aiui-pending-gens");
      // Strip prePending on restore — on page refresh, skip the 3-second delay
      const parsed = stored ? (JSON.parse(stored) as PendingGen[]) : [];
      return parsed.map(p => ({ ...p, prePending: false }));
    } catch { return []; }
  });
  const prePendingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingGensRef = useRef(pendingGens);
  useEffect(() => {
    if (!("caches" in window)) return;
    const CACHE_NAME = "hg-empty-state-v1";
    // Only cache same-origin assets — cross-origin video URLs require CORS headers
    // on the remote server which aren't configured, causing fetch errors.
    const ASSETS = ["/1.webp", "/2.webp", "/3.webp", "/4.webp"];
    caches.open(CACHE_NAME).then(cache => {
      ASSETS.forEach(url => {
        cache.match(url).then(hit => {
          if (!hit) cache.add(url).catch(() => {});
        });
      });
    });
  }, []);

  useEffect(() => { pendingGensRef.current = pendingGens; }, [pendingGens]);

  // Sync active-generation folders to the sidebar
  useEffect(() => {
    const ids = [...new Set(
      pendingGens.filter(pg => !pg.error && pg.folderId).map(pg => pg.folderId!)
    )];
    useFolderStore.getState().setGeneratingFolderIds(ids);
    const hasNullFolderGen = pendingGens.some(pg => !pg.error && !pg.folderId);
    useFolderStore.getState().setGeneratingAllAssets(hasNullFolderGen);
  }, [pendingGens]);

  const [newItemIds, setNewItemIds] = useState<Set<string>>(new Set());
  const onGenComplete = React.useCallback((folderId: string | null | undefined, freshIds: string[]) => {
    if (folderId && folderId !== useFolderStore.getState().selectedFolderId) {
      useFolderStore.getState().addUnseenFolder(folderId);
    }
    if (!folderId && useFolderStore.getState().selectedFolderId !== null) {
      useFolderStore.getState().setUnseenAllAssets(true);
    }
    if (freshIds.length > 0) {
      setNewItemIds(prev => { const n = new Set(prev); freshIds.forEach(id => n.add(id)); return n; });
    }
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [veoMode, setVeoMode] = useState<"frames" | "references">("frames");
  const [promptTextMode, setPromptTextMode] = useState<"text" | "json" | "yaml">(() => loadSettings(tab, selectedFolderId)?.promptTextMode ?? "text");
  const [multiPromptMode, setMultiPromptMode] = useState<boolean>(() => loadSettings(tab, selectedFolderId)?.multiPromptMode ?? false);
  const [expandedPromptIdx, setExpandedPromptIdx] = useState<number | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [genError, setGenError] = useState<string>("");
  const debugMode        = useWorkflowStore((s) => s.debugMode);
  const addToast         = useWorkflowStore((s) => s.addToast);
  const kieKeySet        = useWorkflowStore((s) => s.kieKeySet);
  const setKieKeySet     = useWorkflowStore((s) => s.setKieKeySet);
  const setAuthModalOpen = useWorkflowStore((s) => s.setAuthModalOpen);
  const [sourceFilter, setSourceFilter] = useState<"generated" | "uploaded">(initialSource);

  useEffect(() => {
    if (rawSource === "uploaded" || rawSource === "generated") {
      setSourceFilter(rawSource);
    }
  }, [rawSource]);
  const [zoom, setZoom] = useState<number>(() => {
    if (typeof window === "undefined") return 6;
    const saved = localStorage.getItem("aiui-gallery-zoom");
    return saved ? parseInt(saved, 10) : 6;
  });
  const gridRef = useRef<HTMLDivElement>(null);
  const gridOuterRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [natRatioVersion, setNatRatioVersion] = useState(0);
  const [downloads, setDownloads] = useState<DownloadTask[]>([]);
  const [refError, setRefError] = useState("");

  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [videoMuted, setVideoMuted] = useState(true);
  const [refPreview, setRefPreview] = useState<{ url: string; mediaKind: "image" | "video" | "audio" } | null>(null);
  const [hoveredRefId, setHoveredRefId] = useState<string | null>(null);

  // Folder picker (multi-select toolbar)
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const folderPickerRef = useRef<HTMLDivElement>(null);
  const folderPickerBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!folderPickerOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (
        folderPickerRef.current && !folderPickerRef.current.contains(e.target as Node) &&
        folderPickerBtnRef.current && !folderPickerBtnRef.current.contains(e.target as Node)
      ) {
        setFolderPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [folderPickerOpen]);

  // Media picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<"refImage" | "startFrame" | "endFrame" | "resource" | "videoRef" | "referenceVideo" | null>(null);
  const pickerTargetRef = useRef<typeof pickerTarget>(null);
  const [pickerUploadKind, setPickerUploadKind] = useState<"image" | "video">("image");
  const [dragOverSlotKey, setDragOverSlotKey] = useState<string | null>(null);
  const [reorderOverId, setReorderOverId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Reference images — restored from localStorage on mount
  const [refImages, setRefImages] = useState<RefImage[]>(() => {
    const s = loadSettings(tab, selectedFolderId);
    return (s?.refImageUrls ?? []).map(url => ({
      id: url, objectUrl: url, cdnUrl: url, uploading: false, error: false,
    }));
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Video reference state
  const urlToRef = (url: string): RefImage => ({ id: url, objectUrl: url, cdnUrl: url, uploading: false, error: false });
  const [vidStartFrame, setVidStartFrame] = useState<RefImage | null>(() => { const u = loadSettings(tab, selectedFolderId)?.vidStartFrameUrl; return u ? urlToRef(u) : null; });
  const [vidEndFrame, setVidEndFrame]     = useState<RefImage | null>(() => { const u = loadSettings(tab, selectedFolderId)?.vidEndFrameUrl;   return u ? urlToRef(u) : null; });
  const [vidResources, setVidResources]   = useState<RefImage[]>(() => (loadSettings(tab, selectedFolderId)?.vidResourceUrls ?? []).map(urlToRef));
  const [vidVideoRef, setVidVideoRef]     = useState<RefImage | null>(() => { const u = loadSettings(tab, selectedFolderId)?.vidVideoRefUrl;   return u ? urlToRef(u) : null; });
  const [vidRefVideos, setVidRefVideos]   = useState<RefImage[]>(() => (loadSettings(tab, selectedFolderId)?.vidRefVideoUrls ?? []).map(urlToRef));
  const [vidRefAudios, setVidRefAudios]   = useState<RefImage[]>(() => (loadSettings(tab, selectedFolderId)?.vidRefAudioUrls ?? []).map(urlToRef));
  const [vidElements, setVidElements]     = useState<KlingElement[]>(() => loadSettings(tab, selectedFolderId)?.vidElements ?? []);
  const [elementPickerOpen, setElementPickerOpen] = useState(false);
  const vidImgInputRef   = useRef<HTMLInputElement>(null);
  const vidVideoInputRef = useRef<HTMLInputElement>(null);
  const vidAudioInputRef = useRef<HTMLInputElement>(null);
  const vidPickTarget = useRef<"startFrame" | "endFrame" | "resource" | "videoRef" | "referenceVideo" | "audioRef" | null>(null);

  // Prompt expansion

  // @ mention state — tagged images also restored from localStorage
  const [taggedImages, setTaggedImages] = useState<TaggedImage[]>(() => {
    const s = loadSettings(tab, selectedFolderId);
    if (s?.taggedImages?.length) return s.taggedImages;
    // fallback: reconstruct from refImageUrls for backwards compat
    const urls = s?.refImageUrls ?? [];
    const p = s?.prompt ?? "";
    return urls.flatMap((url, idx) => {
      const label = `image${idx + 1}`;
      return p.includes(`@${label}`) ? [{ label, refId: url, url }] : [];
    });
  });
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionSelIdx, setMentionSelIdx] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeBlockRef = useRef<HTMLTextAreaElement | null>(null);
  const activeBlockIdxRef = useRef<number | null>(null);
  const promptBarRef = useRef<HTMLDivElement>(null);
  const overlayInnerRef = useRef<HTMLDivElement>(null);
  const [chipPreview, setChipPreview] = useState<{ tag: TaggedImage; rect: DOMRect } | null>(null);

  const pageRef = useRef(0);
  const tabRef = useRef<Tab>(tab);
  const sourceFilterRef = useRef<"generated" | "uploaded">(initialSource);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);
  const postLoadCheckRef = useRef<() => void>(() => {});
  const prevScrollHeightRef = useRef(0);
  const [windowWidth, setWindowWidth] = useState(0);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => { refImages.forEach(r => URL.revokeObjectURL(r.objectUrl)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Close ref preview on Escape
  useEffect(() => {
    if (!refPreview) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setRefPreview(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [refPreview]);

  // Persist pendingGens so generating/failed jobs survive page refresh
  useEffect(() => {
    try { localStorage.setItem("aiui-pending-gens", JSON.stringify(pendingGens)); } catch { }
  }, [pendingGens]);

  // Handle "Clean failed jobs" dispatched from the sidebar
  useEffect(() => {
    function handle(e: Event) {
      const { folderId } = (e as CustomEvent<{ folderId: string | null }>).detail;
      setPendingGens(prev => prev.filter(pg => {
        if (!pg.error) return true;
        if (folderId === null) return false;
        return pg.folderId !== folderId;
      }));
    }
    window.addEventListener("clean-failed-jobs", handle);
    return () => window.removeEventListener("clean-failed-jobs", handle);
  }, []);

  // On mount, resume polling for any pending gens that were in-flight before the refresh
  useEffect(() => {
    const toResume = pendingGens.filter(p => p.taskId && !p.error);
    toResume.forEach(async (pending) => {
      try {
        // Check immediately (no 3s delay) before entering the regular poll loop
        const immediateRes = await fetch(`/api/job-status?taskId=${pending.taskId!}`);
        const immediateResult = await immediateRes.json() as { status: string; error?: string };
        if (immediateResult.status === "error") throw new Error(immediateResult.error ?? "Generation failed");
        if (immediateResult.status === "not_found") {
          // Task expired from server memory — image was likely already saved; just remove the spinner
          setPendingGens(prev => prev.filter(p => p.id !== pending.id));
          return;
        }
        if (immediateResult.status !== "done") {
          // Still generating — enter the regular poll loop
          await pollTask(pending.taskId!);
        }
        const existingIds = new Set((galleryCache.get(`${tabRef.current}-generation`)?.items ?? []).map((i: GalleryItem) => i.id));
        const fresh = await fetchNewItems(tabRef.current);
        setPendingGens(prev => prev.filter(p => p.id !== pending.id));
        if (fresh.length > 0) {
          if (pending.folderId) {
            const existingMap = useFolderStore.getState().itemFolderMap;
            const pendingTime = pending.createdAt ? new Date(pending.createdAt).getTime() - 30_000 : 0;
            const untaggedIds = fresh
              .filter(i => new Date(i.created_at).getTime() >= pendingTime)
              .map(i => i.id)
              .filter(id => !existingMap[id]);
            if (untaggedIds.length > 0) assignItemsToFolder(untaggedIds, pending.folderId);
          }
          const genCacheKey = `${tabRef.current}-generation`;
          setItems(prev => {
            const base = sourceFilterRef.current === "generated" ? prev : (galleryCache.get(genCacheKey)?.items ?? []);
            const merged = mergeByNewest(base, fresh);
            galleryCache.set(genCacheKey, { items: merged, hasMore: true });
            return sourceFilterRef.current === "generated" ? (merged === base ? prev : merged) : prev;
          });
        }
        onGenComplete(pending.folderId, fresh.filter(i => !existingIds.has(i.id)).map(i => i.id));
        window.dispatchEvent(new Event("credits-refresh"));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setPendingGens(prev => prev.map(p => p.id === pending.id ? { ...p, error: msg } : p));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (DEMO_MODE) {
      setUser({ id: "demo" } as unknown as User);
      setKieKeySet(false);
      setAuthLoaded(true);
      return;
    }
    if (process.env.NEXT_PUBLIC_GUEST_MODE === "true") {
      setUser({ id: "guest" } as unknown as User);
      setAuthLoaded(true);
      return;
    }
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.access_token) {
        fetch("/api/settings/kie-key", { headers: { Authorization: `Bearer ${session.access_token}` } })
          .then(r => r.json())
          .then(d => setKieKeySet(!!d.hasToken))
          .catch(() => setKieKeySet(false))
          .finally(() => setAuthLoaded(true));
      } else {
        setKieKeySet(null);
        setAuthLoaded(true);
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ── Load items ────────────────────────────────────────────────────────────

  const loadItems = useCallback(async (currentTab: Tab, page: number, replace = false) => {
    if (DEMO_MODE) {
      const demoItems = currentTab === "images" ? DEMO_GALLERY_ITEMS : DEMO_VIDEO_ITEMS;
      setItems(demoItems);
      setHasMore(false);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    // Apply cache / loading state synchronously before any await so the UI
    // updates in the very next render rather than after the token promise.
    const apiSource = sourceFilterRef.current === "uploaded" ? "upload" : "generation";
    const cacheKey = `${currentTab}-${apiSource}`;
    if (replace) {
      const cached = galleryCache.get(cacheKey);
      if (cached) { setItems(cached.items); setHasMore(cached.hasMore); }
      else setLoading(true);
    } else {
      loadingMoreRef.current = true; // synchronous lock — prevents concurrent fetches before React re-renders
      setLoadingMore(true);
    }
    const token = await getToken();
    if (!token) { setLoading(false); setLoadingMore(false); return; }
    try {
      const genType = currentTab === "videos" ? "video" : "image";
      const res = await fetch(`/api/gallery?type=${genType}&page=${page}&source=${apiSource}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const { items: newItems, hasMore: more, total } = await res.json() as { items: GalleryItem[]; hasMore: boolean; total?: number };
      if (replace) {
        setItems(newItems);
        galleryCache.set(cacheKey, { items: newItems, hasMore: more });
      } else {
        setItems(prev => {
          const merged = mergeByNewest(prev, newItems);
          galleryCache.set(cacheKey, { items: merged, hasMore: more });
          return merged;
        });
      }
      setHasMore(more);
      pageRef.current = page;
      if (typeof total === "number") {
        useFolderStore.getState().setGalleryCount(currentTab, total);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
      // Only auto-trigger next load if visible content didn't grow (all-filtered pages)
      // or the grid doesn't fill the viewport. Skip when a folder is active — the sparse
      // match rate would cascade into many empty-page fetches; let scroll drive it instead.
      requestAnimationFrame(() => {
        const el = gridOuterRef.current;
        if (!el || !hasMoreRef.current) return;
        if (useFolderStore.getState().selectedFolderId) return;
        const grew = el.scrollHeight > prevScrollHeightRef.current;
        const fillsViewport = el.scrollHeight > el.clientHeight + 1;
        if (!fillsViewport || !grew) postLoadCheckRef.current();
      });
    }
  }, []);

  // Fetches page 0 and returns only brand-new items (not already in the list).
  // Returns data without touching state so callers can batch it with other updates.
  const fetchNewItems = useCallback(async (currentTab: Tab): Promise<GalleryItem[]> => {
    const token = await getToken();
    if (!token) return [];
    try {
      const genType = currentTab === "videos" ? "video" : "image";
      const res = await fetch(`/api/gallery?type=${genType}&page=0&source=generation`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return [];
      const { items: fresh } = await res.json() as { items: GalleryItem[]; hasMore: boolean };
      return fresh;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (!authLoaded) return;
    if (kieKeySet === null && process.env.NEXT_PUBLIC_GUEST_MODE !== "true") return;
    loadItems(tab, 0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoaded, kieKeySet]);

  useEffect(() => {
    clearSelection();
    tabRef.current = tab;
    pageRef.current = 0;
    setHasMore(true);
    if (DEMO_MODE) {
      setItems(tab === "images" ? DEMO_GALLERY_ITEMS : DEMO_VIDEO_ITEMS);
      setHasMore(false);
    } else {
      const src = sourceFilterRef.current === "uploaded" ? "upload" : "generation";
      const cached = galleryCache.get(`${tab}-${src}`);
      if (cached) { setItems(cached.items); setHasMore(cached.hasMore); } else setItems([]);
      if (user) loadItems(tab, 0, true);
    }
    const newModels = tab === "videos" ? VIDEO_MODELS : IMAGE_MODELS;
    const saved = loadSettings(tab, prevFolderIdRef.current);
    const model = (saved?.modelId ? newModels.find(m => m.id === saved.modelId) : null) ?? newModels[0];
    const savedAR = saved?.aspectRatio && model.ratios.includes(saved.aspectRatio) ? saved.aspectRatio : null;
    skipNextModelEffect.current = true;
    setModelId(model.id);
    const resolvedPrompt = saved?.prompt ?? "";
    setPrompt(resolvedPrompt);
    setAspectRatio(savedAR ?? ("defaultRatio" in model ? (model as { defaultRatio: string }).defaultRatio : null) ?? model.ratios[0] ?? "16:9");
    setQuality(saved?.quality ?? "2k");
    setCount(saved?.count ?? 1);
    if ("defaultDuration" in model) setDuration(saved?.duration ?? (model as { defaultDuration: number }).defaultDuration ?? 5);
    if ("defaultMode" in model) setMode(saved?.mode ?? (model as { defaultMode: string }).defaultMode ?? "");
    if ("defaultResolution" in model) setResolution((model as { defaultResolution: string }).defaultResolution);
    setSound(saved?.sound ?? false);
    const savedUrls = saved?.refImageUrls ?? [];
    const savedPrompt = resolvedPrompt;
    setRefImages(prev => {
      prev.forEach(r => URL.revokeObjectURL(r.objectUrl));
      return savedUrls.map(url => ({ id: url, objectUrl: url, cdnUrl: url, uploading: false, error: false }));
    });
    setTaggedImages(
      saved?.taggedImages?.length
        ? saved.taggedImages
        : savedUrls.flatMap((url, idx) => {
            const label = `image${idx + 1}`;
            return savedPrompt.includes(`@${label}`) ? [{ label, refId: url, url }] : [];
          })
    );
    const toRef = (url: string): RefImage => ({ id: url, objectUrl: url, cdnUrl: url, uploading: false, error: false });
    setVidStartFrame(saved?.vidStartFrameUrl ? toRef(saved.vidStartFrameUrl) : null);
    setVidEndFrame(saved?.vidEndFrameUrl ? toRef(saved.vidEndFrameUrl) : null);
    setVidResources((saved?.vidResourceUrls ?? []).map(toRef));
    setVidVideoRef(saved?.vidVideoRefUrl ? toRef(saved.vidVideoRefUrl) : null);
    setVidRefVideos((saved?.vidRefVideoUrls ?? []).map(toRef));
    setVidRefAudios((saved?.vidRefAudioUrls ?? []).map(toRef));
    setVidElements(saved?.vidElements ?? []);
    const restoredPrompt = resolvedPrompt;
    if (restoredPrompt && inputRef.current) {
      const el = inputRef.current;
      requestAnimationFrame(() => requestAnimationFrame(() => resizeTextarea(el)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Resize textarea on initial mount if a saved prompt is already loaded
  useEffect(() => {
    if (inputRef.current && prompt && !multiPromptMode) {
      const el = inputRef.current;
      requestAnimationFrame(() => requestAnimationFrame(() => resizeTextarea(el)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (inputRef.current && !multiPromptMode) {
      const maxH = promptExpanded ? window.innerHeight * 0.75 - 220 : 264;
      requestAnimationFrame(() => { if (inputRef.current) resizeTextarea(inputRef.current, maxH); });
    }
  }, [promptExpanded, multiPromptMode]);

  useEffect(() => {
    if (skipNextModelEffect.current) { skipNextModelEffect.current = false; return; }
    const m = models.find(m => m.id === modelId);
    if (!m) return;
    setAspectRatio(("defaultRatio" in m ? m.defaultRatio : null) ?? m.ratios[0] ?? "1:1");
    if ("defaultDuration" in m) setDuration(m.defaultDuration ?? 5);
    if ("defaultMode" in m) setMode(m.defaultMode ?? "");
    if ("defaultResolution" in m) setResolution((m as { defaultResolution: string }).defaultResolution);
    if (!isVideo) {
      const im = m as { apiInput?: { qualityOptions?: string[] }; azureQualityOptions?: string[] };
      const provider = (() => { try { return JSON.parse(localStorage.getItem("aiui-model-providers") ?? "{}")[m.id] ?? "kie"; } catch { return "kie"; } })();
      const base     = (() => { try { return localStorage.getItem("aiui-azure-base-url") ?? ""; } catch { return ""; } })();
      const deploy   = (() => { try { return JSON.parse(localStorage.getItem("aiui-azure-endpoints") ?? "{}")[m.id] ?? ""; } catch { return ""; } })();
      const azure    = provider === "azure" && !!base && !!deploy && !!im.azureQualityOptions;
      const validQ   = azure ? im.azureQualityOptions! : (im.apiInput?.qualityOptions ?? []);
      if (validQ.length) {
        setQuality(prev => validQ.includes(prev) ? prev : validQ[0]);
      }
    }
    if (isVideo) {
      // We don't clear video refs here anymore to allow persistence when switching between video models
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  // Keep isAzureProvider in sync with localStorage whenever model or provider settings change
  useEffect(() => {
    const m = models.find(m => m.id === modelId);
    const im = m as { azureQualityOptions?: string[] } | undefined;
    const read = () => {
      try {
        const provider = JSON.parse(localStorage.getItem("aiui-model-providers") ?? "{}")[modelId] ?? "kie";
        const base     = localStorage.getItem("aiui-azure-base-url") ?? "";
        const deploy   = JSON.parse(localStorage.getItem("aiui-azure-endpoints") ?? "{}")[modelId] ?? "";
        const azure    = provider === "azure" && !!base && !!deploy && !!im?.azureQualityOptions;
        setIsAzureProvider(azure);
        if (!isVideo && im) {
          const validQ = azure ? (im.azureQualityOptions ?? []) : ((m as { apiInput?: { qualityOptions?: string[] } })?.apiInput?.qualityOptions ?? []);
          if (validQ.length) setQuality(prev => validQ.includes(prev) ? prev : validQ[0]);
        }
      } catch { setIsAzureProvider(false); }
    };
    read();
    window.addEventListener("storage", read);
    window.addEventListener("aiui-providers-changed", read);
    return () => {
      window.removeEventListener("storage", read);
      window.removeEventListener("aiui-providers-changed", read);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, isVideo]);

  // Keep refs in sync so the observer callback can gate without needing to be recreated
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { loadingMoreRef.current = loadingMore; }, [loadingMore]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);

  // Infinite scroll — scroll events are reliable; postLoadCheckRef handles the case where
  // content doesn't fill the container after a page loads (no scroll event fires).
  useEffect(() => {
    const container = gridOuterRef.current;
    if (!container || !hasMore) return;

    const checkAndLoad = () => {
      if (!hasMoreRef.current || loadingRef.current || loadingMoreRef.current) return;
      if (container.scrollHeight - container.scrollTop - container.clientHeight < 800) {
        prevScrollHeightRef.current = container.scrollHeight;
        loadItems(tabRef.current, pageRef.current + 1);
      }
    };

    postLoadCheckRef.current = checkAndLoad;
    container.addEventListener("scroll", checkAndLoad, { passive: true });
    checkAndLoad();
    return () => {
      container.removeEventListener("scroll", checkAndLoad);
      postLoadCheckRef.current = () => {};
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadItems, authLoaded]);

  // When sourceFilter changes, reset to page 0 and fetch only the relevant source.
  useEffect(() => {
    sourceFilterRef.current = sourceFilter;
    if (DEMO_MODE) return;
    pageRef.current = 0;
    setHasMore(true);
    const src = sourceFilter === "uploaded" ? "upload" : "generation";
    const cached = galleryCache.get(`${tabRef.current}-${src}`);
    if (cached) { setItems(cached.items); setHasMore(cached.hasMore); } else setItems([]);
    loadItems(tabRef.current, 0, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter]);

  // Persist settings
  useEffect(() => {
    const refImageUrls = [...new Set(refImages
      .filter(r => r.cdnUrl && !r.uploading && !r.error)
      .map(r => r.cdnUrl!))];
    const readyCdnUrl = (r: RefImage) => !r.uploading && !r.error && !!r.cdnUrl;
    const s: SavedSettings = {
      prompt, modelId, aspectRatio, quality, count, duration, mode, sound, refImageUrls, azureResolution, promptTextMode, multiPromptMode,
      vidStartFrameUrl: vidStartFrame?.cdnUrl ?? null,
      vidEndFrameUrl: vidEndFrame?.cdnUrl ?? null,
      vidResourceUrls: vidResources.filter(readyCdnUrl).map(r => r.cdnUrl!),
      vidVideoRefUrl: vidVideoRef?.cdnUrl ?? null,
      vidRefVideoUrls: vidRefVideos.filter(readyCdnUrl).map(r => r.cdnUrl!),
      vidRefAudioUrls: vidRefAudios.filter(readyCdnUrl).map(r => r.cdnUrl!),
      vidElements,
      taggedImages,
    };
    settingsSnapshotRef.current = s;
    saveSettings(tab, prevFolderIdRef.current, s);
  }, [tab, prompt, modelId, aspectRatio, quality, count, duration, mode, sound, refImages, azureResolution, promptTextMode, multiPromptMode, vidStartFrame, vidEndFrame, vidResources, vidVideoRef, vidRefVideos, vidRefAudios, vidElements, taggedImages]);

  // Save/restore all settings when switching folders
  useEffect(() => {
    if (prevFolderIdRef.current === selectedFolderId) return;
    // Save current state to previous folder before switching
    if (settingsSnapshotRef.current) saveSettings(tab, prevFolderIdRef.current, settingsSnapshotRef.current);
    prevFolderIdRef.current = selectedFolderId;
    // Load settings for the new folder
    const saved = loadSettings(tab, selectedFolderId);
    const newModels = tab === "videos" ? VIDEO_MODELS : IMAGE_MODELS;
    const model = (saved?.modelId ? newModels.find(m => m.id === saved.modelId) : null) ?? newModels[0];
    const savedAR = saved?.aspectRatio && model.ratios.includes(saved.aspectRatio) ? saved.aspectRatio : null;
    const savedUrls = saved?.refImageUrls ?? [];
    const savedPrompt = saved?.prompt ?? "";
    const toRef = (url: string): RefImage => ({ id: url, objectUrl: url, cdnUrl: url, uploading: false, error: false });
    skipNextModelEffect.current = true;
    setPrompt(savedPrompt);
    setModelId(model.id);
    setAspectRatio(savedAR ?? ("defaultRatio" in model ? (model as { defaultRatio: string }).defaultRatio : null) ?? model.ratios[0] ?? "1:1");
    setQuality(saved?.quality ?? "2k");
    setCount(saved?.count ?? 1);
    if ("defaultDuration" in model) setDuration(saved?.duration ?? (model as { defaultDuration: number }).defaultDuration ?? 5);
    if ("defaultMode" in model) setMode(saved?.mode ?? (model as { defaultMode: string }).defaultMode ?? "");
    setSound(saved?.sound ?? false);
    setAzureResolution(saved?.azureResolution ?? "1k");
    setPromptTextMode(saved?.promptTextMode ?? "text");
    setMultiPromptMode(saved?.multiPromptMode ?? false);
    setRefImages(prev => { prev.forEach(r => URL.revokeObjectURL(r.objectUrl)); return savedUrls.map(toRef); });
    setTaggedImages(
      saved?.taggedImages?.length
        ? saved.taggedImages
        : savedUrls.flatMap((url, idx) => {
            const label = `image${idx + 1}`;
            return savedPrompt.includes(`@${label}`) ? [{ label, refId: url, url }] : [];
          })
    );
    setVidStartFrame(saved?.vidStartFrameUrl ? toRef(saved.vidStartFrameUrl) : null);
    setVidEndFrame(saved?.vidEndFrameUrl ? toRef(saved.vidEndFrameUrl) : null);
    setVidResources((saved?.vidResourceUrls ?? []).map(toRef));
    setVidVideoRef(saved?.vidVideoRefUrl ? toRef(saved.vidVideoRefUrl) : null);
    setVidRefVideos((saved?.vidRefVideoUrls ?? []).map(toRef));
    setVidRefAudios((saved?.vidRefAudioUrls ?? []).map(toRef));
    setVidElements(saved?.vidElements ?? []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFolderId]);

  // Track window width; set initial zoom from breakpoints only if NOT saved
  useEffect(() => {
    const w = window.innerWidth;
    setWindowWidth(w);
    if (!localStorage.getItem("aiui-gallery-zoom")) {
      setZoom(w >= 1400 ? 6 : w >= 900 ? 5 : w >= 640 ? 5 : 4);
    }
    const handler = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Save zoom to localStorage
  useEffect(() => {
    localStorage.setItem("aiui-gallery-zoom", zoom.toString());
  }, [zoom]);

  useEffect(() => {
    const el = gridOuterRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setContainerWidth(e.contentRect.width));
    ro.observe(el);
    setContainerWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  // Re-run once the full layout is mounted (after auth loads and user is present)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoaded, user]);

  // Cancel reorder drag if pointer released outside any item
  useEffect(() => {
    if (!draggingId) return;
    const cancel = () => {
      _reorderDragItem = null;
      _reorderOverId = null;
      setDraggingId(null);
      setReorderOverId(null);
    };
    document.addEventListener('pointerup', cancel);
    document.addEventListener('pointercancel', cancel);
    return () => {
      document.removeEventListener('pointerup', cancel);
      document.removeEventListener('pointercancel', cancel);
    };
  }, [draggingId]);

  // ── Image upload ──────────────────────────────────────────────────────────

  const imgModel = IMAGE_MODELS.find(m => m.id === modelId);
  const maxImgs = imgModel?.maxImages ?? 0;
  const canAddImgs = !isVideo && !!imgModel?.supportsImages && refImages.length < maxImgs;
  const promptMaxLength = (() => {
    if (isVideo) {
      const vm = VIDEO_MODELS.find(m => m.id === modelId);
      return vm?.apiInput.promptMaxLength ?? null;
    }
    if (!imgModel) return null;
    const hasRefImgs = refImages.length > 0;
    if (!hasRefImgs && imgModel.textOnlyPromptMaxLength) return imgModel.textOnlyPromptMaxLength;
    return imgModel.apiInput.promptMaxLength;
  })();
  const promptOverLimit = promptMaxLength !== null && prompt.length > promptMaxLength;

  const handleFilePick = async (files: FileList) => {
    if (!imgModel?.supportsImages) return;
    const remaining = maxImgs - refImages.length;
    const toAdd = Array.from(files).slice(0, remaining).filter(f => f.type.startsWith("image/"));
    if (toAdd.length === 0) return;

    const newEntries: RefImage[] = toAdd.map(f => ({
      id: randomUUID(),
      objectUrl: URL.createObjectURL(f),
      cdnUrl: null,
      uploading: true,
      error: false,
    }));
    setRefImages(prev => [...prev, ...newEntries]);

    const token = await getToken();
    await Promise.all(toAdd.map(async (file, i) => {
      const entry = newEntries[i];
      try {
        const res = await fetch("/api/upload-asset", {
          method: "POST",
          headers: {
            "Content-Type": file.type,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: file,
        });
        const data = await res.json() as { cdnUrl?: string; error?: string };
        if (!res.ok || !data.cdnUrl) throw new Error(data.error ?? "Upload failed");
        setRefImages(prev => prev.map(r => r.id === entry.id ? { ...r, cdnUrl: data.cdnUrl!, uploading: false } : r));
      } catch {
        setRefImages(prev => prev.map(r => r.id === entry.id ? { ...r, uploading: false, error: true } : r));
      }
    }));
  };

  const removeImage = (id: string) => {
    const el = document.querySelector(`[data-refimg-id="${id}"]`) as HTMLElement | null;
    if (el) {
      // Synchronous DOM write — zero frame delay, starts before React scheduler
      el.style.transition = "opacity 170ms cubic-bezier(0.4,0,1,1), transform 170ms cubic-bezier(0.4,0,1,1)";
      el.style.opacity = "0";
      el.style.transform = "translateY(-10px) scale(0.92)";
    }
    // React state as a backup so any re-render in the window doesn't reset the styles
    setRemovingIds(prev => new Set(prev).add(id));
    const removedImg = refImages.find(r => r.id === id);
    const { newTaggedImages, newPrompt } = removeTagAndRenumber(id, removedImg?.cdnUrl ?? null, taggedImages, prompt);
    setTimeout(() => {
      setRemovingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      setRefImages(prev => {
        const img = prev.find(r => r.id === id);
        if (img) URL.revokeObjectURL(img.objectUrl);
        return prev.filter(r => r.id !== id);
      });
      setTaggedImages(newTaggedImages);
      setPrompt(newPrompt);
    }, 190);
  };

  // ── Video reference upload ────────────────────────────────────────────────

  const handleVidFilePick = async (
    files: FileList | null,
    target: "startFrame" | "endFrame" | "resource" | "videoRef" | "referenceVideo" | "audioRef",
  ) => {
    if (!files || files.length === 0) return;
    const vm = VIDEO_MODELS.find(m => m.id === modelId);
    const isSingle = target === "startFrame" || target === "endFrame" || target === "videoRef";

    const maxCount = isSingle ? 1 : (
      target === "resource"        ? (vm?.maxResources      ?? 3) :
      target === "referenceVideo"  ? (vm?.maxReferenceVideos ?? 3) :
                                     (vm?.maxReferenceAudios ?? 3)
    );
    const currentCount = isSingle ? 0 : (
      target === "resource"        ? vidResources.length :
      target === "referenceVideo"  ? vidRefVideos.length :
                                     vidRefAudios.length
    );
    const toAdd = Array.from(files).slice(0, maxCount - currentCount);
    if (toAdd.length === 0) return;

    const newEntries: RefImage[] = toAdd.map(f => ({
      id: randomUUID(),
      objectUrl: URL.createObjectURL(f),
      cdnUrl: null,
      uploading: true,
      error: false,
    }));

    const isSeedanceModel = modelId === "seedance-2" || modelId === "seedance-2-fast";
    if (isSingle) {
      const [entry] = newEntries;
      if (target === "startFrame") {
        setVidStartFrame(entry);
        if (modelId === "happyhorse") setVidResources([]);
        if (isSeedanceModel) { setVidResources([]); setVidRefVideos([]); setVidRefAudios([]); }
      } else if (target === "endFrame") {
        setVidEndFrame(entry);
        if (isSeedanceModel) { setVidResources([]); setVidRefVideos([]); setVidRefAudios([]); }
      } else setVidVideoRef(entry);
    } else {
      if (target === "resource") {
        if (modelId === "happyhorse") setVidStartFrame(null);
        if (isSeedanceModel) { setVidStartFrame(null); setVidEndFrame(null); }
        setVidResources(prev => [...prev, ...newEntries]);
      } else if (target === "referenceVideo") {
        if (isSeedanceModel) { setVidStartFrame(null); setVidEndFrame(null); }
        setVidRefVideos(prev => [...prev, ...newEntries]);
      } else {
        if (isSeedanceModel) { setVidStartFrame(null); setVidEndFrame(null); }
        setVidRefAudios(prev => [...prev, ...newEntries]);
      }
    }

    const token = await getToken();
    await Promise.all(toAdd.map(async (file, i) => {
      const entry = newEntries[i];
      try {
        const res = await fetch("/api/upload-asset", {
          method: "POST",
          headers: { "Content-Type": file.type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: file,
        });
        const data = await res.json() as { cdnUrl?: string; error?: string };
        if (!res.ok || !data.cdnUrl) throw new Error(data.error ?? "Upload failed");
        const ok = (r: RefImage) => r.id === entry.id ? { ...r, cdnUrl: data.cdnUrl!, uploading: false } : r;
        if (isSingle) {
          if (target === "startFrame") setVidStartFrame(p => p?.id === entry.id ? { ...p, cdnUrl: data.cdnUrl!, uploading: false } : p);
          else if (target === "endFrame") setVidEndFrame(p => p?.id === entry.id ? { ...p, cdnUrl: data.cdnUrl!, uploading: false } : p);
          else setVidVideoRef(p => p?.id === entry.id ? { ...p, cdnUrl: data.cdnUrl!, uploading: false } : p);
        } else {
          if (target === "resource")       setVidResources(prev => prev.map(ok));
          else if (target === "referenceVideo") setVidRefVideos(prev => prev.map(ok));
          else                             setVidRefAudios(prev => prev.map(ok));
        }
      } catch {
        const err = (r: RefImage) => r.id === entry.id ? { ...r, uploading: false, error: true } : r;
        if (isSingle) {
          if (target === "startFrame") setVidStartFrame(p => p?.id === entry.id ? { ...p, uploading: false, error: true } : p);
          else if (target === "endFrame") setVidEndFrame(p => p?.id === entry.id ? { ...p, uploading: false, error: true } : p);
          else setVidVideoRef(p => p?.id === entry.id ? { ...p, uploading: false, error: true } : p);
        } else {
          if (target === "resource")       setVidResources(prev => prev.map(err));
          else if (target === "referenceVideo") setVidRefVideos(prev => prev.map(err));
          else                             setVidRefAudios(prev => prev.map(err));
        }
      }
    }));
  };

  const removeVidRef = (id: string, target: "startFrame" | "endFrame" | "resource" | "videoRef" | "referenceVideo" | "audioRef") => {
    let removedUrl: string | null = null;
    if (target === "startFrame") {
      removedUrl = vidStartFrame?.cdnUrl ?? null;
      setVidStartFrame(null);
    } else if (target === "endFrame") {
      removedUrl = vidEndFrame?.cdnUrl ?? null;
      setVidEndFrame(null);
    } else if (target === "videoRef") {
      removedUrl = vidVideoRef?.cdnUrl ?? null;
      setVidVideoRef(null);
    } else if (target === "resource") {
      removedUrl = vidResources.find(r => r.id === id)?.cdnUrl ?? null;
      setVidResources(prev => prev.filter(r => r.id !== id));
    } else if (target === "referenceVideo") {
      removedUrl = vidRefVideos.find(r => r.id === id)?.cdnUrl ?? null;
      setVidRefVideos(prev => prev.filter(r => r.id !== id));
    } else {
      removedUrl = vidRefAudios.find(r => r.id === id)?.cdnUrl ?? null;
      setVidRefAudios(prev => prev.filter(r => r.id !== id));
    }
    const { newTaggedImages, newPrompt } = removeTagAndRenumber(id, removedUrl, taggedImages, prompt);
    setTaggedImages(newTaggedImages);
    setPrompt(newPrompt);
  };

  // ── Media picker ──────────────────────────────────────────────────────────

  const openPicker = (target: NonNullable<typeof pickerTarget>, uploadKind: "image" | "video") => {
    pickerTargetRef.current = target;
    setPickerTarget(target);
    setPickerUploadKind(uploadKind);
    setPickerOpen(true);
  };

  const handlePickerSelect = (url: string) => {
    const target = pickerTargetRef.current;
    const isMulti = target === "refImage" || target === "resource" || target === "referenceVideo";
    if (!isMulti) setPickerOpen(false);
    if (!target) return;
    if (target === "refImage") {
      handleAddReference(url);
      return;
    }
    const isDup = (slots: RefImage[]) => slots.some(r => r.cdnUrl === url || r.objectUrl === url);

    const isSeedancePicker = modelId === "seedance-2" || modelId === "seedance-2-fast";
    if (target === "resource") {
      if (isDup(vidResources)) return;
      if (modelId === "happyhorse") setVidStartFrame(null);
      if (isSeedancePicker) { setVidStartFrame(null); setVidEndFrame(null); }
      setVidResources(prev => [...prev, { id: randomUUID(), objectUrl: url, cdnUrl: url, uploading: false, error: false }]);
      return;
    }
    if (target === "referenceVideo") {
      if (isDup(vidRefVideos)) return;
      if (isSeedancePicker) { setVidStartFrame(null); setVidEndFrame(null); }
      setVidRefVideos(prev => [...prev, { id: randomUUID(), objectUrl: url, cdnUrl: url, uploading: false, error: false }]);
      return;
    }
    const entry: RefImage = { id: randomUUID(), objectUrl: url, cdnUrl: url, uploading: false, error: false };
    if (target === "startFrame") {
      setVidStartFrame(entry);
      if (modelId === "happyhorse") setVidResources([]);
      if (isSeedancePicker) { setVidResources([]); setVidRefVideos([]); setVidRefAudios([]); }
    } else if (target === "endFrame") {
      setVidEndFrame(entry);
      if (isSeedancePicker) { setVidResources([]); setVidRefVideos([]); setVidRefAudios([]); }
    } else if (target === "videoRef") setVidVideoRef(entry);
  };

  const handlePickerDeselect = (url: string) => {
    const target = pickerTargetRef.current;
    if (target === "refImage") {
      const removedImg = refImages.find(r => r.cdnUrl === url || r.objectUrl === url);
      const { newTaggedImages, newPrompt } = removeTagAndRenumber(removedImg?.id ?? "", url, taggedImages, prompt);
      setRefImages(prev => prev.filter(r => r.cdnUrl !== url && r.objectUrl !== url));
      setTaggedImages(newTaggedImages);
      setPrompt(newPrompt);
    } else if (target === "resource") {
      const removedRef = vidResources.find(r => r.cdnUrl === url || r.objectUrl === url);
      const { newTaggedImages, newPrompt } = removeTagAndRenumber(removedRef?.id ?? "", url, taggedImages, prompt);
      setVidResources(prev => prev.filter(r => r.cdnUrl !== url && r.objectUrl !== url));
      setTaggedImages(newTaggedImages);
      setPrompt(newPrompt);
    } else if (target === "referenceVideo") {
      const removedRef = vidRefVideos.find(r => r.cdnUrl === url || r.objectUrl === url);
      const { newTaggedImages, newPrompt } = removeTagAndRenumber(removedRef?.id ?? "", url, taggedImages, prompt);
      setVidRefVideos(prev => prev.filter(r => r.cdnUrl !== url && r.objectUrl !== url));
      setTaggedImages(newTaggedImages);
      setPrompt(newPrompt);
    }
  };

  const handlePickerUpload = () => {
    setPickerOpen(false);
    if (DEMO_MODE) { useWorkflowStore.getState().setAuthModalOpen(true); return; }
    if (pickerTarget === "refImage") {
      fileInputRef.current?.click();
    } else if (pickerTarget) {
      vidPickTarget.current = pickerTarget as "startFrame" | "endFrame" | "resource" | "videoRef" | "referenceVideo";
      if (pickerUploadKind === "image") vidImgInputRef.current?.click();
      else vidVideoInputRef.current?.click();
    }
  };

  // ── Generate ──────────────────────────────────────────────────────────────

  const generateOne = async (token: string, promptOverride?: string): Promise<string> => {
    const effectivePrompt = promptOverride ?? prompt;
    if (!isVideo) {
      const { resolvedPrompt, extraUrls } = resolveGalleryMentions(effectivePrompt, taggedImages);
      const extraUrlSet = new Set(extraUrls);
      const refUrls = imgModel?.supportsImages ? refImages.filter(r => r.cdnUrl && !r.error && !extraUrlSet.has(r.cdnUrl!)).map(r => r.cdnUrl!) : [];
      const imageUrls = imgModel?.supportsImages ? [...new Set([...extraUrls, ...refUrls])] : [];

      // Read provider settings from localStorage (same keys as GenerateNode)
      const azureBaseUrl    = (() => { try { return localStorage.getItem("aiui-azure-base-url") ?? ""; } catch { return ""; } })();
      const azureDeployment = (() => { try { return JSON.parse(localStorage.getItem("aiui-azure-endpoints") ?? "{}")[modelId] ?? ""; } catch { return ""; } })();
      const providerForModel = (() => { try { return JSON.parse(localStorage.getItem("aiui-model-providers") ?? "{}")[modelId] ?? "kie"; } catch { return "kie"; } })();
      const isAzure = !!(azureBaseUrl && azureDeployment && providerForModel === "azure");

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          prompt: resolvedPrompt, model: modelId, aspectRatio, quality, imageUrls,
          ...(isAzure ? { azureBaseUrl, azureDeployment, azureQuality: quality, azureResolution } : {}),
        }),
      });
      const text = await res.text();
      let d: { taskId?: string; error?: string } = {};
      try { d = JSON.parse(text); } catch { throw new Error(res.ok ? "Invalid server response" : `Server error ${res.status}`); }
      if (!res.ok) throw new Error(d.error ?? `Server error ${res.status}`);
      return d.taskId!;
    } else {
      const vm = VIDEO_MODELS.find(m => m.id === modelId);
      const handles = vm?.handles ?? [];

      const { resolvedPrompt, extraAssets } = resolveGalleryMentions(effectivePrompt, taggedImages, vm?.resourceTagFormat ?? "default");

      const startFrameUrl = handles.includes("startFrame") && vidStartFrame?.cdnUrl ? vidStartFrame.cdnUrl : undefined;
      const endFrameUrl   = handles.includes("endFrame")   && vidEndFrame?.cdnUrl   ? vidEndFrame.cdnUrl   : undefined;
      const videoRefUrl   = handles.includes("videoRef")   && vidVideoRef?.cdnUrl   ? vidVideoRef.cdnUrl   : undefined;

      const useElements = !!(vm?.apiInput.useKlingElements);

      const taggedImageUrls = extraAssets.filter(a => a.kind === "image").map(a => a.url);
      const taggedVideoUrls = extraAssets.filter(a => a.kind === "video").map(a => a.url);
      const taggedAudioUrls = extraAssets.filter(a => a.kind === "audio").map(a => a.url);

      const extraImageSet = new Set(taggedImageUrls);
      const extraVideoSet = new Set(taggedVideoUrls);
      const extraAudioSet = new Set(taggedAudioUrls);

      // Non-kling resource models send referenceImageUrls
      const resourceUrls = handles.includes("resource") && !useElements
        ? vidResources.filter(r => r.cdnUrl && !r.error && !extraImageSet.has(r.cdnUrl!)).map(r => r.cdnUrl!)
        : [];
      const referenceImageUrls = !useElements && (taggedImageUrls.length > 0 || resourceUrls.length > 0)
        ? [...taggedImageUrls, ...resourceUrls]
        : undefined;

      // Kling: send structured elements
      const baseElements = useElements && handles.includes("resource") && vidElements.length > 0
        ? vidElements.map(el => ({ name: el.name, description: el.description, imageUrls: el.imageUrls }))
        : [];
      const mentionElements = useElements ? taggedImageUrls.map((url, i) => ({
        name: `element_${i + 1}`,
        description: `Mentioned image ${i + 1}`,
        imageUrls: [url],
      })) : [];
      const klingElements = useElements && (mentionElements.length > 0 || baseElements.length > 0)
        ? [...mentionElements, ...baseElements]
        : undefined;

      const baseVideoUrls = handles.includes("referenceVideo")
        ? vidRefVideos.filter(r => r.cdnUrl && !r.error && !extraVideoSet.has(r.cdnUrl!)).map(r => r.cdnUrl!)
        : [];
      const referenceVideoUrls = handles.includes("referenceVideo") && (taggedVideoUrls.length > 0 || baseVideoUrls.length > 0)
        ? [...taggedVideoUrls, ...baseVideoUrls]
        : undefined;

      const baseAudioUrls = handles.includes("audioRef")
        ? vidRefAudios.filter(r => r.cdnUrl && !r.error && !extraAudioSet.has(r.cdnUrl!)).map(r => r.cdnUrl!)
        : [];
      const referenceAudioUrls = handles.includes("audioRef") && (taggedAudioUrls.length > 0 || baseAudioUrls.length > 0)
        ? [...taggedAudioUrls, ...baseAudioUrls]
        : undefined;

      const isVeo = !!(vm?.apiInput.useGoogleVeo);
      const veoImageUrls: string[] = [];
      if (isVeo) {
        if (veoMode === "frames") {
          if (startFrameUrl) veoImageUrls.push(startFrameUrl);
          if (endFrameUrl)   veoImageUrls.push(endFrameUrl);
        } else if (veoMode === "references") {
          if (referenceImageUrls) veoImageUrls.push(...referenceImageUrls.slice(0, 3));
        }
      }

      const generationType = isVeo 
        ? (veoMode === "references" ? "REFERENCE_2_VIDEO" : (veoImageUrls.length > 0 ? "FIRST_AND_LAST_FRAMES_2_VIDEO" : "TEXT_2_VIDEO"))
        : undefined;

      const res = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(isVeo ? {
          model: modelId,
          prompt: resolvedPrompt,
          aspect_ratio: aspectRatio,
          generationType,
          imageUrls: veoImageUrls,
          enableTranslation: true,
          enableFallback: false,
          watermark: "",
        } : {
          videoModel: modelId,
          prompt: resolvedPrompt,
          aspectRatio,
          duration,
          ...(vm?.sound ? { sound } : {}),
          ...(vm?.modes?.length ? { mode: mode || vm.defaultMode || "pro" } : {}),
          resolution: vm && "resolutions" in vm && vm.resolutions?.length ? resolution || vm.defaultResolution : undefined,
          ...(startFrameUrl               ? { startFrameUrl }               : {}),
          ...(endFrameUrl                 ? { endFrameUrl }                 : {}),
          ...(videoRefUrl                 ? { videoRefUrl }                 : {}),
          ...(klingElements?.length       ? { klingElements }               : {}),
          ...(referenceImageUrls?.length  ? { referenceImageUrls }          : {}),
          ...(referenceVideoUrls?.length  ? { referenceVideoUrls }          : {}),
          ...(referenceAudioUrls?.length  ? { referenceAudioUrls }          : {}),
          ...(vm?.supportsSeeds && seed ? { seed } : {}),
        }),
      });
      const text = await res.text();
      let d: { taskId?: string; error?: string } = {};
      try { d = JSON.parse(text); } catch { throw new Error(res.ok ? "Invalid server response" : `Server error ${res.status}`); }
      if (!res.ok) throw new Error(d.error ?? `Server error ${res.status}`);
      return d.taskId!;
    }
  };

  const pollTask = async (taskId: string): Promise<void> => {
    // Resolves after `ms` OR immediately when the tab becomes visible — whichever is first.
    // This ensures polling catches up instantly after the user returns to the tab,
    // even if the browser throttled the timer while it was hidden.
    const waitOrVisible = (ms: number) => new Promise<void>(resolve => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(t); document.removeEventListener("visibilitychange", onVisible); resolve(); };
      const onVisible = () => { if (!document.hidden) finish(); };
      const t = setTimeout(finish, ms);
      document.addEventListener("visibilitychange", onVisible);
    });

    for (let i = 0; i < 150; i++) {
      await waitOrVisible(3_000);
      const poll = await fetch(`/api/job-status?taskId=${taskId}`);
      const result = await poll.json() as { status: string; error?: string };
      if (result.status === "done") return;
      if (result.status === "error") throw new Error(result.error ?? "Generation failed");
    }
    throw new Error("Timed out");
  };

  const generate = async () => {
    if (kieKeySet === false) return;
    if (!prompt.trim() && !isVideo) return;
    requestNotificationPermission();
    if (refImages.some(r => r.uploading)) { setGenError("Images still uploading…"); setTimeout(() => setGenError(""), 3_000); return; }
    if (isVideo && [vidStartFrame, vidEndFrame, vidVideoRef, ...vidResources, ...vidRefVideos, ...vidRefAudios].some(r => r?.uploading)) {
      setGenError("References still uploading…"); setTimeout(() => setGenError(""), 3_000); return;
    }
    if (isVideo) {
      const vm = VIDEO_MODELS.find(m => m.id === modelId);
      if (vm?.requiredHandles?.length) {
        const handleHasContent = (h: string) => {
          if (h === "resource")        return vidResources.some(r => r.cdnUrl && !r.error);
          if (h === "startFrame")      return !!(vidStartFrame?.cdnUrl && !vidStartFrame.error);
          if (h === "endFrame")        return !!(vidEndFrame?.cdnUrl && !vidEndFrame.error);
          if (h === "videoRef")        return !!(vidVideoRef?.cdnUrl && !vidVideoRef.error);
          if (h === "referenceVideo")  return vidRefVideos.some(r => r.cdnUrl && !r.error);
          if (h === "audioRef")        return vidRefAudios.some(r => r.cdnUrl && !r.error);
          if (h === "prompt")          return !!prompt.trim();
          return true;
        };
        const HANDLE_LABELS: Record<string, string> = {
          resource: "Reference image",
          startFrame: "Start frame image",
          endFrame: "End frame image",
          videoRef: "Reference video",
          referenceVideo: "Reference video",
          audioRef: "Reference audio",
          prompt: "Text prompt",
        };
        const missing = vm.requiredHandles.filter(h => !handleHasContent(h));
        if (missing.length > 0) {
          const labels = missing.map(h => HANDLE_LABELS[h] ?? h).join(", ");
          addToast(`Missing required input${missing.length > 1 ? "s" : ""}: ${labels}.`, "error");
          return;
        }
      }
    }
    if (!user && process.env.NEXT_PUBLIC_GUEST_MODE !== "true") {
      setAuthModalOpen(true);
      return;
    }
    setGenError("");

    const multiPrompts = multiPromptMode ? prompt.split(/\n\n+/).map(p => p.trim()).filter(Boolean) : null;
    const n = multiPrompts ? multiPrompts.length : (isVideo ? 1 : count);
    const snapshotRefUrls = [...new Set(refImages.filter(r => r.cdnUrl && !r.error).map(r => r.cdnUrl!))];
    const snapshotFolderId = selectedFolderId;
    const newPendings: PendingGen[] = Array.from({ length: n }, (_, i) => ({
      id: randomUUID(), aspectRatio, prompt: multiPrompts ? multiPrompts[i] : prompt, referenceImageUrls: snapshotRefUrls, createdAt: new Date().toISOString(), tab, prePending: true, folderId: snapshotFolderId,
    }));
    setPendingGens(prev => [...newPendings, ...prev]);

    // ── Debug mode: log + simulate, no real API call ────────────────────────
    if (debugMode) {
      const dbgVm = isVideo ? VIDEO_MODELS.find(m => m.id === modelId) : undefined;
      const { resolvedPrompt: dbgPrompt, extraUrls: dbgExtra, extraAssets: dbgAssets } = resolveGalleryMentions(prompt, taggedImages, dbgVm?.resourceTagFormat ?? "default");
      const dbgExtraSet = new Set(dbgExtra);
      const dbgRefUrls = refImages.filter(r => r.cdnUrl && !r.error && !dbgExtraSet.has(r.cdnUrl!)).map(r => r.cdnUrl!);
      const dbgAzureBaseUrl    = (() => { try { return localStorage.getItem("aiui-azure-base-url") ?? ""; } catch { return ""; } })();
      const dbgAzureDeployment = (() => { try { return JSON.parse(localStorage.getItem("aiui-azure-endpoints") ?? "{}")[modelId] ?? ""; } catch { return ""; } })();
      const dbgProvider        = (() => { try { return JSON.parse(localStorage.getItem("aiui-model-providers") ?? "{}")[modelId] ?? "kie"; } catch { return "kie"; } })();
      const dbgIsAzure = !!(dbgAzureBaseUrl && dbgAzureDeployment && dbgProvider === "azure");
      const dbgTaggedImageUrls = dbgAssets.filter(a => a.kind === "image").map(a => a.url);
      const dbgTaggedVideoUrls = dbgAssets.filter(a => a.kind === "video").map(a => a.url);
      const dbgTaggedAudioUrls = dbgAssets.filter(a => a.kind === "audio").map(a => a.url);
      const dbgExtraImageSet = new Set(dbgTaggedImageUrls);
      const dbgExtraVideoSet = new Set(dbgTaggedVideoUrls);
      const dbgExtraAudioSet = new Set(dbgTaggedAudioUrls);
      console.log("[Gallery Debug] Generate request:", {
        type: isVideo ? "video" : "image",
        prompt: dbgPrompt, model: modelId, aspectRatio, quality,
        provider: dbgIsAzure ? "azure" : "kie",
        ...(dbgIsAzure ? { azureBaseUrl: dbgAzureBaseUrl, azureDeployment: dbgAzureDeployment, azureQuality: quality, azureResolution } : {}),
        ...(isVideo ? {
          duration, mode,
          startFrameUrl:       vidStartFrame?.cdnUrl ?? null,
          endFrameUrl:         vidEndFrame?.cdnUrl   ?? null,
          taggedImageUrls:     dbgTaggedImageUrls,
          taggedVideoUrls:     dbgTaggedVideoUrls,
          taggedAudioUrls:     dbgTaggedAudioUrls,
          resourceUrls:        vidResources.filter(r => r.cdnUrl && !r.error && !dbgExtraImageSet.has(r.cdnUrl!)).map(r => r.cdnUrl!),
          referenceVideoUrls:  vidRefVideos.filter(r => r.cdnUrl && !r.error && !dbgExtraVideoSet.has(r.cdnUrl!)).map(r => r.cdnUrl!),
          referenceAudioUrls:  vidRefAudios.filter(r => r.cdnUrl && !r.error && !dbgExtraAudioSet.has(r.cdnUrl!)).map(r => r.cdnUrl!),
        } : { imageUrls: [...new Set([...dbgExtra, ...dbgRefUrls])], count: n }),
      });
      setTimeout(() => {
        setPendingGens(prev => prev.filter(p => !newPendings.some(np => np.id === p.id)));
      }, 3_000);
      return;
    }

    // ── 3-second pre-pending window before actual API call ────────────────
    const batchKey = newPendings[0].id;
    const submitBatch = async () => {
      prePendingTimersRef.current.delete(batchKey);
      // Only process entries that weren't cancelled during the pre-pending window
      const active = newPendings.filter(p => pendingGensRef.current.some(pg => pg.id === p.id && pg.prePending));
      if (active.length === 0) return;

      const activeIds = new Set(active.map(p => p.id));
      setPendingGens(prev => prev.map(p => activeIds.has(p.id) ? { ...p, prePending: false } : p));

      const token = await getToken();
      if (!token) {
        setPendingGens(prev => prev.map(p =>
          activeIds.has(p.id) ? { ...p, error: "Please sign in to generate." } : p
        ));
        return;
      }

      setSubmitting(true);
      const promptByPendingId = new Map(newPendings.map((p, i) => [p.id, multiPrompts ? multiPrompts[i] : undefined]));
      let taskIds: string[];
      try {
        taskIds = await Promise.all(active.map(p => generateOne(token, promptByPendingId.get(p.id))));
      } catch (e: unknown) {
        setSubmitting(false);
        const msg = e instanceof Error ? e.message : String(e);
        setPendingGens(prev => prev.map(p =>
          activeIds.has(p.id) ? { ...p, error: msg } : p
        ));
        return;
      }
      setSubmitting(false);

      // Store taskIds so polls can be resumed after a page refresh
      setPendingGens(prev => prev.map(p => {
        const idx = active.findIndex(np => np.id === p.id);
        return idx >= 0 ? { ...p, taskId: taskIds[idx] } : p;
      }));

      // ── Poll each task independently ──────────────────────────────────────
      taskIds.forEach(async (taskId, i) => {
        const pending = active[i];
        try {
          await pollTask(taskId);
          // Fetch fresh items before touching state so both updates land in one render.
          const existingIds = new Set((galleryCache.get(`${tabRef.current}-generation`)?.items ?? []).map((i: GalleryItem) => i.id));
          const fresh = await fetchNewItems(tabRef.current);
          setPendingGens(prev => prev.filter(p => p.id !== pending.id));
          if (fresh.length > 0) {
            if (pending.folderId) {
              const existingMap = useFolderStore.getState().itemFolderMap;
              const pendingTime = pending.createdAt ? new Date(pending.createdAt).getTime() - 30_000 : 0;
              const untaggedIds = fresh
                .filter(i => new Date(i.created_at).getTime() >= pendingTime)
                .map(i => i.id)
                .filter(id => !existingMap[id]);
              if (untaggedIds.length > 0) assignItemsToFolder(untaggedIds, pending.folderId);
            }
            const genCacheKey = `${tabRef.current}-generation`;
            setItems(prev => {
              const base = sourceFilterRef.current === "generated" ? prev : (galleryCache.get(genCacheKey)?.items ?? []);
              const merged = mergeByNewest(base, fresh);
              galleryCache.set(genCacheKey, { items: merged, hasMore: true });
              return sourceFilterRef.current === "generated" ? (merged === base ? prev : merged) : prev;
            });
          }
          onGenComplete(pending.folderId, fresh.filter(i => !existingIds.has(i.id)).map(i => i.id));
          window.dispatchEvent(new Event("credits-refresh"));
          browserNotify(
            isVideo ? "Video ready" : "Image ready",
            (pending.prompt || "Your generation is ready").slice(0, 100),
          );
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          setPendingGens(prev => prev.map(p => p.id === pending.id ? { ...p, error: msg } : p));
          browserNotify("Generation failed", msg.slice(0, 100));
        }
      });
    };

    const batchTimer = setTimeout(submitBatch, 3000);
    prePendingTimersRef.current.set(batchKey, batchTimer);
  };

  // ── @ mention derived + helpers ───────────────────────────────────────────

  const mentionableAssets = useMemo(() => {
    if (!isVideo) {
      return refImages
        .filter(r => !r.uploading && !r.error && r.cdnUrl)
        .map((r, i) => ({ ...r, kind: "image" as const, label: `image${i + 1}`, role: `Reference ${i + 1}` }));
    } else {
      const isVeo = modelId === "veo3" || modelId === "veo3_fast" || modelId === "veo3_lite";
      const assets: (RefImage & { kind: "image" | "video" | "audio"; label: string; role: string })[] = [];
      
      // Images
      const imgs: { ref: RefImage; role: string }[] = [];
      const startOk = vidStartFrame?.cdnUrl && !vidStartFrame.uploading && !vidStartFrame.error;
      const endOk = vidEndFrame?.cdnUrl && !vidEndFrame.uploading && !vidEndFrame.error;
      const resOk = vidResources.filter(r => r.cdnUrl && !r.uploading && !r.error);

      if (isVeo) {
        if (veoMode === "frames") {
          if (startOk) imgs.push({ ref: vidStartFrame!, role: "Start Frame" });
          if (endOk) imgs.push({ ref: vidEndFrame!, role: "End Frame" });
        } else if (veoMode === "references") {
          resOk.forEach((r, i) => imgs.push({ ref: r, role: `Reference ${i + 1}` }));
        }
      } else {
        if (startOk) imgs.push({ ref: vidStartFrame!, role: "Start Frame" });
        if (endOk) imgs.push({ ref: vidEndFrame!, role: "End Frame" });
        resOk.forEach((r, i) => imgs.push({ ref: r, role: `Reference ${i + 1}` }));
      }
      assets.push(...imgs.map((item, i) => ({ ...item.ref, kind: "image" as const, label: `image${i + 1}`, role: item.role })));

      // Videos (hide for Veo)
      if (!isVeo) {
        const vids: { ref: RefImage; role: string }[] = [];
        if (vidVideoRef?.cdnUrl && !vidVideoRef.uploading && !vidVideoRef.error) vids.push({ ref: vidVideoRef, role: "Reference Video" });
        vidRefVideos.filter(r => r.cdnUrl && !r.uploading && !r.error).forEach((r, i) => vids.push({ ref: r, role: `Video ${i + 1}` }));
        assets.push(...vids.map((item, i) => ({ ...item.ref, kind: "video" as const, label: `vid${i + 1}`, role: item.role })));
      }

      // Audios (hide for Veo)
      if (!isVeo) {
        const auds = vidRefAudios.filter(r => r.cdnUrl && !r.uploading && !r.error);
        assets.push(...auds.map((r, i) => ({ ...r, kind: "audio" as const, label: `aud${i + 1}`, role: `Audio ${i + 1}` })));
      }

      return assets;
    }
  }, [isVideo, modelId, veoMode, refImages, vidStartFrame, vidEndFrame, vidVideoRef, vidResources, vidRefVideos, vidRefAudios]);

  const filteredMentions = useMemo(() => {
    if (mentionQuery === null) return [];
    return mentionableAssets.slice(0, 8);
  }, [mentionableAssets, mentionQuery]);

  const atMenuOpen = mentionQuery !== null && filteredMentions.length > 0;

  useEffect(() => { setMentionSelIdx(0); }, [filteredMentions.length]);

  // Sync: remove stale chips; auto-tag @mentions that match attached assets (paste support)
  useEffect(() => {
    setTaggedImages(prev => {
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const filtered = prev.filter(t => new RegExp(`@${esc(t.label)}(?!\\w)`).test(prompt));
      const newTags: TaggedImage[] = [];
      for (const asset of mentionableAssets) {
        if (!filtered.some(t => t.label === asset.label) && asset.cdnUrl) {
          if (new RegExp(`@${esc(asset.label)}(?!\\w)`).test(prompt)) {
            newTags.push({ label: asset.label, refId: asset.id, url: asset.cdnUrl, kind: asset.kind });
          }
        }
      }
      if (newTags.length === 0) return filtered.length === prev.length ? prev : filtered;
      return [...filtered, ...newTags];
    });
    if (inputRef.current && !multiPromptMode) {
      const maxH = promptExpanded ? window.innerHeight * 0.75 - 220 : 264;
      resizeTextarea(inputRef.current, maxH);
    }
    if (overlayInnerRef.current) {
      const st = inputRef.current?.scrollTop ?? 0;
      overlayInnerRef.current.style.transform = st > 0 ? `translateY(-${st}px)` : "";
    }
  }, [prompt, mentionableAssets]);

  const openDurPicker = useCallback(() => {
    const r = durPillRef.current?.getBoundingClientRect();
    if (!r) return;
    setDurPickerPos({ left: r.left, bottom: window.innerHeight - r.top + 6 });
    setDurPickerOpen(true);
  }, []);

  const closeDurPicker = useCallback(() => {
    if (durCloseTimer.current) clearTimeout(durCloseTimer.current);
    setDurPickerOpen(false);
    setDurPickerClosing(true);
    durCloseTimer.current = setTimeout(() => setDurPickerClosing(false), 180);
  }, []);

  // Close duration picker on outside click
  useEffect(() => {
    if (!durPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (!durPillRef.current?.contains(e.target as Node)) closeDurPicker();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [durPickerOpen, closeDurPicker]);

  // Close @ menu on outside click
  useEffect(() => {
    if (!atMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-at-menu]") &&
        !(e.target as HTMLElement).closest("[data-prompt-input]")) {
        setMentionQuery(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [atMenuOpen]);

  // Close element picker on outside click — does NOT collapse the prompt
  useEffect(() => {
    if (!elementPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-element-picker-modal]")) {
        setElementPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [elementPickerOpen]);

  // Collapse expanded prompt on outside click — passes through to gallery
  useEffect(() => {
    if (!promptExpanded) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-prompt-overlay]")) return;
      if (target.closest("[data-element-picker-modal]")) return;
      if (target.closest("[data-at-menu]")) return;
      if (target.closest("[data-custom-dropdown-portal]")) return;
      if (promptBarRef.current && !promptBarRef.current.contains(target)) {
        setPromptExpanded(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [promptExpanded]);

  const insertMention = (ref: RefImage & { kind?: "image" | "video" | "audio"; label?: string }) => {
    const label = ref.label || "image1";
    if (!taggedImages.some(t => t.refId === ref.id))
      setTaggedImages(prev => [...prev, { label, refId: ref.id, url: ref.cdnUrl!, kind: isVideo ? (ref.kind || "image") : "image" }]);

    if (multiPromptMode && activeBlockIdxRef.current !== null) {
      const blocks = prompt.split(/\n\n+/).reduce<string[]>((acc, b) => {
        if (!b.trim() && acc.some(x => !x.trim())) return acc;
        return [...acc, b];
      }, []);
      const idx = activeBlockIdxRef.current;
      if (idx < blocks.length) {
        const blockInput = activeBlockRef.current;
        const blockText = blocks[idx];
        const cursor = blockInput?.selectionStart ?? blockText.length;
        const before = blockText.slice(0, cursor);
        const after = blockText.slice(cursor);
        const lastAt = before.lastIndexOf("@");
        const newBlockText = lastAt >= 0
          ? `${before.slice(0, lastAt)}@${label} ${after}`
          : `${before}@${label} ${after}`;
        const newPos = (lastAt >= 0 ? lastAt : cursor) + label.length + 2;
        const updatedBlocks = [...blocks];
        updatedBlocks[idx] = newBlockText;
        setPrompt(updatedBlocks.join('\n\n'));
        setMentionQuery(null);
        requestAnimationFrame(() => {
          if (!blockInput) return;
          blockInput.focus();
          blockInput.setSelectionRange(newPos, newPos);
        });
      }
      return;
    }

    const input = inputRef.current;
    const cursor = input?.selectionStart ?? prompt.length;
    const before = prompt.slice(0, cursor);
    const after = prompt.slice(cursor);
    const lastAt = before.lastIndexOf("@");
    const newText = lastAt >= 0
      ? `${before.slice(0, lastAt)}@${label} ${after}`
      : `${before}@${label} ${after}`;
    const newPos = (lastAt >= 0 ? lastAt : cursor) + label.length + 2;

    setPrompt(newText);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      if (!input) return;
      input.focus();
      input.setSelectionRange(newPos, newPos);
    });
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const vidModel = VIDEO_MODELS.find(m => m.id === modelId);
  const ratios = (isVideo ? vidModel?.ratios : imgModel?.ratios) ?? [];
  const supportsQ = !isVideo && !!imgModel?.supportsQuality;

  const qualityOpts: string[] = isAzureProvider
    ? (imgModel!.azureQualityOptions ?? [])
    : (imgModel?.apiInput.qualityOptions ?? ["2k", "4k"]);
  const azureResolutionOpts: string[] = isAzureProvider ? (imgModel?.azureResolutionOptions ?? []) : [];
  const durations = vidModel?.durations ?? [];
  const vidModes = vidModel?.modes ?? [];
  const activeModel = models.find(m => m.id === modelId);
  const hasRefImgs = refImages.length > 0;
  const allUploaded = refImages.every(r => !r.uploading);
  const vidRefHandles = (vidModel?.handles ?? []).filter(h => h !== "prompt");
  const hasVidRefs = isVideo && (!!vidStartFrame || !!vidEndFrame || !!vidVideoRef || vidResources.length > 0 || vidElements.length > 0 || vidRefVideos.length > 0 || vidRefAudios.length > 0);

  const displayRefImages    = getDisplayOrder(refImages,    draggingId, reorderOverId);
  const displayVidResources = getDisplayOrder(vidResources, draggingId, reorderOverId);
  const displayVidRefVideos = getDisplayOrder(vidRefVideos, draggingId, reorderOverId);
  const displayVidRefAudios = getDisplayOrder(vidRefAudios, draggingId, reorderOverId);

  const vidRequiresPrompt = isVideo && !!(vidModel?.apiInput.promptMaxLength);
  const canGenerate = kieKeySet === false ? false : submitting ? false : promptOverLimit ? false : (vidRequiresPrompt || !isVideo) ? prompt.trim().length > 0 : true;

  const handleAddReference = useCallback((url: string) => {
    if (refImages.some(r => r.cdnUrl === url || r.objectUrl === url)) {
      setRefError("Already added as a reference.");
      setTimeout(() => setRefError(""), 3000);
      return;
    }
    if (refImages.length >= maxImgs) return;
    setRefImages(prev => [...prev, { id: randomUUID(), objectUrl: url, cdnUrl: url, uploading: false, error: false }]);
  }, [refImages, maxImgs]);

  const handleGalleryItemDrop = useCallback((
    e: React.DragEvent,
    target: "refImage" | "startFrame" | "endFrame" | "resource" | "videoRef" | "referenceVideo",
    expectedKind: "image" | "video",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverSlotKey(null);
    const dragged = _galleryDragItem;
    _galleryDragItem = null;
    if (!dragged) return;
    const { url, mediaType } = dragged;
    if (mediaType !== expectedKind) return;
    const entry: RefImage = { id: randomUUID(), objectUrl: url, cdnUrl: url, uploading: false, error: false };
    if (target === "refImage") {
      handleAddReference(url);
    } else if (target === "startFrame") {
      setVidStartFrame(entry);
      if (modelId === "happyhorse") setVidResources([]);
      if (modelId === "seedance-2" || modelId === "seedance-2-fast") { setVidResources([]); setVidRefVideos([]); setVidRefAudios([]); }
    } else if (target === "endFrame") {
      setVidEndFrame(entry);
      if (modelId === "seedance-2" || modelId === "seedance-2-fast") { setVidResources([]); setVidRefVideos([]); setVidRefAudios([]); }
    } else if (target === "videoRef") {
      setVidVideoRef(entry);
    } else if (target === "resource") {
      if (modelId === "seedance-2" || modelId === "seedance-2-fast") { setVidStartFrame(null); setVidEndFrame(null); }
      setVidResources(prev => [...prev, entry]);
    } else if (target === "referenceVideo") {
      if (modelId === "seedance-2" || modelId === "seedance-2-fast") { setVidStartFrame(null); setVidEndFrame(null); }
      setVidRefVideos(prev => [...prev, entry]);
    }
  }, [handleAddReference, modelId]);

  const handleReorderDrop = (targetId: string, listTarget: "refImage" | "resource" | "referenceVideo" | "audioRef") => {
    const dragId = _reorderDragItem?.id;
    _reorderDragItem = null;
    _reorderOverId = null;
    setReorderOverId(null);
    setDraggingId(null);
    if (!dragId || dragId === targetId) return;
    _reorderJustDropped = true;
    setTimeout(() => { _reorderJustDropped = false; }, 300);

    let oldArr: RefImage[];
    let setter: (fn: (prev: RefImage[]) => RefImage[]) => void;
    if (listTarget === "refImage")         { oldArr = refImages;    setter = setRefImages; }
    else if (listTarget === "resource")    { oldArr = vidResources; setter = setVidResources; }
    else if (listTarget === "referenceVideo") { oldArr = vidRefVideos; setter = setVidRefVideos; }
    else                                   { oldArr = vidRefAudios; setter = setVidRefAudios; }

    const dragIdx = oldArr.findIndex(r => r.id === dragId);
    const targetIdx = oldArr.findIndex(r => r.id === targetId);
    if (dragIdx === -1 || targetIdx === -1) return;

    const newArr = [...oldArr];
    const [moved] = newArr.splice(dragIdx, 1);
    newArr.splice(targetIdx, 0, moved);
    setter(() => newArr);

    const { newTaggedImages, newPrompt } = reorderAndRenumberTags(oldArr, newArr, "image", taggedImages, prompt);
    setTaggedImages(newTaggedImages);
    setPrompt(newPrompt);
  };

  const handleCopyPrompt = useCallback((text: string, refUrls?: string[], meta?: { model?: string; aspectRatio?: string; quality?: string; azureResolution?: string }) => {
    const newRefs = (refUrls ?? []).map(url => ({
      id: randomUUID(), objectUrl: url, cdnUrl: url, uploading: false, error: false,
    }));

    let processedText = text;
    const tagged: TaggedImage[] = [];

    if (refUrls?.length) {
      // Attempt to un-resolve mentions: <<<image N>>> or @imageN -> @imageN
      processedText = text.replace(/<<<image (\d+)>>>|@image(\d+)/gi, (m, g1, g2) => {
        const n = parseInt(g1 || g2);
        const url = refUrls[n - 1];
        if (url) {
          const label = `image${n}`;
          if (!tagged.some(t => t.label === label)) {
            tagged.push({ label, refId: url, url });
          }
          return `@${label}`;
        }
        return m;
      });
    }

    if (tab === "videos") {
      const vm = VIDEO_MODELS.find(m => m.id === modelId);
      const handles = vm?.handles ?? [];
      
      // Clear existing video refs
      setVidStartFrame(null);
      setVidEndFrame(null);
      setVidResources([]);
      setVidVideoRef(null);
      setVidRefVideos([]);
      setVidRefAudios([]);
      setVidElements([]);

      let remaining = [...newRefs];
      if (handles.includes("startFrame") && remaining.length > 0) {
        setVidStartFrame(remaining.shift()!);
      }
      if (handles.includes("endFrame") && remaining.length > 0) {
        setVidEndFrame(remaining.shift()!);
      }
      if (handles.includes("videoRef") && remaining.length > 0) {
        setVidVideoRef(remaining.shift()!);
      }
      if (handles.includes("resource") && remaining.length > 0) {
        setVidResources(remaining);
      }
    } else {
      setRefImages(prev => {
        prev.forEach(r => URL.revokeObjectURL(r.objectUrl));
        return newRefs;
      });
    }

    setTaggedImages(tagged);
    setPrompt(processedText);
    if (meta?.model) setModelId(meta.model);
    if (meta?.aspectRatio) setAspectRatio(meta.aspectRatio);
    if (meta?.quality) setQuality(meta.quality);
    if (meta?.azureResolution) setAzureResolution(meta.azureResolution);
    requestAnimationFrame(() => {
      if (inputRef.current) resizeTextarea(inputRef.current);
    });
  }, [tab, modelId]);

  const clearDeletedFromNodes = useCallback((deletedUrls: Set<string>) => {
    const { nodes, updateNodeData } = useWorkflowStore.getState();
    for (const node of nodes) {
      const gens = ((node.data.generations as (string | null | { error: string })[]) ?? []);
      const filtered = gens.filter(g => !(typeof g === "string" && deletedUrls.has(g)));
      if (filtered.length === gens.length) continue;
      const newIdx = Math.max(0, Math.min((node.data.currentGenIdx as number | undefined) ?? 0, filtered.length - 1));
      const last = filtered[newIdx];
      const lastUrl = filtered.length > 0 && typeof last === "string" ? last : undefined;
      const isVideo = node.type === "videoGeneratorNode";
      updateNodeData(node.id, {
        generations: filtered,
        currentGenIdx: filtered.length > 0 ? newIdx : 0,
        ...(isVideo ? { videoUrl: lastUrl } : { imageUrl: lastUrl }),
        status: filtered.length > 0 ? "done" : "idle",
      });
    }
  }, []);

  const handleDelete = useCallback(async (id: string, source: "generation" | "upload") => {
    const token = await getToken();
    if (!token) return;
    const item = items.find(i => i.id === id);
    await fetch("/api/gallery", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, source }),
    });
    if (item) clearDeletedFromNodes(new Set([item.url, ...(item.imageUrls ?? [])]));
    setItems(prev => {
      const updated = prev.filter(i => i.id !== id);
      const src = sourceFilterRef.current === "uploaded" ? "upload" : "generation";
      galleryCache.set(`${tabRef.current}-${src}`, { items: updated, hasMore });
      return updated;
    });
  }, [hasMore, items, clearDeletedFromNodes]);

  const handleDownload = useCallback(async (url: string, itemIsVideo: boolean): Promise<void> => {
    const urlExt = url.split("?")[0].split(".").pop()?.toLowerCase();
    const ext = itemIsVideo ? "mp4" : (urlExt && ["png","jpg","jpeg","webp","gif"].includes(urlExt) ? urlExt : "png");
    const filename = `${Date.now()}.${ext}`;
    const taskId = randomUUID();
    setDownloads(prev => [...prev, { id: taskId, filename, status: "preparing" }]);
    try {
      const res = await fetch(`/api/download?url=${encodeURIComponent(url)}&filename=${filename}`);
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
      setDownloads(prev => prev.map(t => t.id === taskId ? { ...t, status: "ready" } : t));
    } catch {
      setDownloads(prev => prev.map(t => t.id === taskId ? { ...t, status: "error" } : t));
    }
  }, []);

  // Auto-dismiss download toast when all tasks complete
  useEffect(() => {
    if (downloads.length > 0 && downloads.every(d => d.status !== "preparing")) {
      const timer = setTimeout(() => setDownloads([]), 4000);
      return () => clearTimeout(timer);
    }
  }, [downloads]);

  const handleDownloadSelected = useCallback(async () => {
    const toDownload = items.filter(i => selectedIds.has(i.id));
    clearSelection();
    for (const item of toDownload) {
      await handleDownload(item.url, item.mediaType === "video");
    }
  }, [items, selectedIds, handleDownload]);

  const handleDeleteSelected = useCallback(async () => {
    const toDelete = items.filter(i => selectedIds.has(i.id));
    clearSelection();
    const token = await getToken();
    if (!token) return;
    await Promise.all(toDelete.map(item =>
      fetch("/api/gallery", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: item.id, source: item.source }),
      })
    ));
    const deletedUrls = new Set(toDelete.flatMap(i => [i.url, ...(i.imageUrls ?? [])]));
    clearDeletedFromNodes(deletedUrls);
    setItems(prev => {
      const ids = new Set(toDelete.map(i => i.id));
      const updated = prev.filter(i => !ids.has(i.id));
      const src = sourceFilterRef.current === "uploaded" ? "upload" : "generation";
      galleryCache.set(`${tabRef.current}-${src}`, { items: updated, hasMore });
      return updated;
    });
  }, [items, selectedIds, hasMore, clearDeletedFromNodes]);

  const GALLERY_GAP = 1;

  const filteredItems = useMemo(() => {
    const bySource = sourceFilter === "generated"
      ? items.filter(item => item.source === "generation")
      : items.filter(item => item.source === "upload");
    if (!selectedFolderId) return bySource;
    return bySource.filter(item => itemFolderMap[item.id]?.includes(selectedFolderId));
  }, [items, sourceFilter, selectedFolderId, itemFolderMap]);

  type GalleryLayoutItem =
    | { kind: "pending"; pg: PendingGen; ratio: number; width: number }
    | { kind: "gallery"; item: GalleryItem; ratio: number; width: number };

  // Justified row layout: items are packed into rows that each fill the full container width.
  // Zoom controls target row height — higher zoom = shorter rows = more items per row.
  const justifiedRows = useMemo(() => {
    if (containerWidth <= 0) return [] as Array<{ items: GalleryLayoutItem[]; height: number }>;
    const targetH = Math.max(80, Math.round(containerWidth / Math.max(1, zoom)));

    const toRatio = (ar: string | undefined, mediaType: "image" | "video", url: string): number => {
      const fallback = mediaType === "video" ? 16 / 9 : 4 / 3;
      if (ar && ar !== "auto") {
        const [w, h] = ar.split(":");
        const wn = parseFloat(w), hn = parseFloat(h);
        if (wn && hn) return wn / hn;
      }
      const cached = naturalRatioCache.get(url);
      if (cached) {
        const [w, h] = cached.split(" / ");
        const wn = parseFloat(w), hn = parseFloat(h);
        if (wn && hn) return wn / hn;
      }
      return fallback;
    };

    const toPendingEntry = (pg: PendingGen): GalleryLayoutItem => {
      const [ws, hs] = pg.aspectRatio.split(":");
      const w = parseFloat(ws), h = parseFloat(hs);
      return { kind: "pending" as const, pg, ratio: (w && h) ? w / h : 16 / 9, width: 0 };
    };

    // Pending gens are only shown in the "generated" source filter, not "uploaded".
    const allPendingVisible = sourceFilter === "generated"
      ? pendingGens.filter(pg => (pg.tab == null || pg.tab === tab) && (!selectedFolderId || pg.folderId === selectedFolderId))
      : [];
    const activePendings = allPendingVisible.filter(pg => !pg.error && !pg.retried);
    const mixedPendings = allPendingVisible.filter(pg => !!pg.error || !!pg.retried);

    type Dated = { t: number; entry: GalleryLayoutItem };
    const mixed: Dated[] = [
      ...mixedPendings.map(pg => ({ t: pg.createdAt ? new Date(pg.createdAt).getTime() : Date.now(), entry: toPendingEntry(pg) })),
      ...filteredItems.map(item => ({ t: new Date(item.created_at).getTime(), entry: { kind: "gallery" as const, item, ratio: toRatio(item.aspect_ratio, item.mediaType, item.url), width: 0 } })),
    ].sort((a, b) => b.t - a.t);

    const allItems: GalleryLayoutItem[] = [
      ...activePendings.map(toPendingEntry),
      ...mixed.map(d => d.entry),
    ];

    const rows: Array<{ items: GalleryLayoutItem[]; height: number }> = [];
    let cur: GalleryLayoutItem[] = [];
    let ratioSum = 0;

    const sealRow = (items: GalleryLayoutItem[], rSum: number, rowH: number) => {
      const totalGaps = (items.length - 1) * GALLERY_GAP;
      const availW = containerWidth - totalGaps;
      rows.push({ items: items.map(it => ({ ...it, width: availW * it.ratio / rSum })), height: rowH });
    };

    for (const entry of allItems) {
      cur.push(entry);
      ratioSum += entry.ratio;
      const gaps = (cur.length - 1) * GALLERY_GAP;
      const h = (containerWidth - gaps) / ratioSum;
      if (h <= targetH) { sealRow(cur, ratioSum, h); cur = []; ratioSum = 0; }
    }
    if (cur.length > 0) {
      // Last (partial) row: keep natural widths at targetH so ratios aren't distorted.
      const totalGaps = (cur.length - 1) * GALLERY_GAP;
      const naturalW = cur.reduce((s, it) => s + targetH * it.ratio, 0);
      if (naturalW + totalGaps <= containerWidth) {
        rows.push({ items: cur.map(it => ({ ...it, width: targetH * it.ratio })), height: targetH });
      } else {
        sealRow(cur, ratioSum, (containerWidth - totalGaps) / ratioSum);
      }
    }

    return rows;
  }, [containerWidth, zoom, pendingGens, filteredItems, GALLERY_GAP, natRatioVersion, tab, sourceFilter]);

  // Fixed-column justified layout: exactly `zoom` items per row, each row fills full width.
  // Last partial row keeps column widths consistent with full rows; empty slots are padded.
  const fixedRows = useMemo(() => {
    if (containerWidth <= 0) return [] as Array<{ items: GalleryLayoutItem[]; height: number; emptyCount: number }>;
    const allItems = justifiedRows.flatMap(row => row.items);
    const rows: Array<{ items: GalleryLayoutItem[]; height: number; emptyCount: number }> = [];
    const colWidth = (containerWidth - (zoom - 1) * GALLERY_GAP) / zoom;
    for (let i = 0; i < allItems.length; i += zoom) {
      const group = allItems.slice(i, i + zoom);
      const isFull = group.length === zoom;
      if (isFull) {
        const ratioSum = group.reduce((s, it) => s + it.ratio, 0);
        const totalGaps = (group.length - 1) * GALLERY_GAP;
        const availW = containerWidth - totalGaps;
        const height = availW / ratioSum;
        rows.push({ items: group.map(it => ({ ...it, width: availW * it.ratio / ratioSum })), height, emptyCount: 0 });
      } else {
        // Partial last row: each item gets the standard column width; height from average ratio.
        const avgRatio = group.reduce((s, it) => s + it.ratio, 0) / group.length;
        const height = colWidth / avgRatio;
        rows.push({ items: group.map(it => ({ ...it, width: colWidth })), height, emptyCount: zoom - group.length });
      }
    }
    return rows;
  }, [containerWidth, zoom, justifiedRows, GALLERY_GAP]);

  const orderedGalleryItems = useMemo(
    () => fixedRows.flatMap(r => r.items).filter((i): i is Extract<GalleryLayoutItem, { kind: "gallery" }> => i.kind === "gallery").map(i => i.item),
    [fixedRows],
  );

  // Fire probes for every uncached item without a stored aspect_ratio.
  // Images: 32px next/image probe (fast). Videos: <video preload="metadata"> probe.
  // Results are non-blocking for video (uses 16:9 default until resolved).
  useEffect(() => {
    const toProbe = filteredItems.filter(
      item => (!item.aspect_ratio || item.aspect_ratio === "auto") &&
              !naturalRatioCache.has(item.url),
    );
    if (toProbe.length === 0) return;

    let cancelled = false;
    const bump = () => { if (!cancelled) setNatRatioVersion(v => v + 1); };

    toProbe.forEach(item => {
      if (item.mediaType === "video") {
        const vid = document.createElement("video");
        vid.preload = "metadata";
        vid.onloadedmetadata = () => {
          if (vid.videoWidth && vid.videoHeight)
            naturalRatioCache.set(item.url, `${vid.videoWidth} / ${vid.videoHeight}`);
          else
            naturalRatioCache.set(item.url, "16 / 9");
          bump();
        };
        vid.onerror = () => { naturalRatioCache.set(item.url, "16 / 9"); bump(); };
        vid.src = item.url;
      } else {
        const probeUrl = item.imageUrls?.[0] ?? item.url;
        const img = new window.Image();
        img.onload = () => {
          if (img.naturalWidth && img.naturalHeight)
            naturalRatioCache.set(item.url, `${img.naturalWidth} / ${img.naturalHeight}`);
          bump();
        };
        img.onerror = () => { naturalRatioCache.set(item.url, "4 / 3"); bump(); };
        img.src = probeUrl;
      }
    });

    return () => { cancelled = true; };
  }, [filteredItems]);

  // Persist discovered aspect ratios whenever a new one is found so the next
  // cold page load skips the probe reflow entirely.
  useEffect(() => {
    try {
      const ratios = Object.fromEntries(naturalRatioCache);
      sessionStorage.setItem("hg-ratios", JSON.stringify(ratios));
    } catch {}
  }, [natRatioVersion]);

  // Persist loaded-image URLs on unmount so the shimmer is suppressed on the
  // next visit (images already in browser HTTP cache load instantly anyway).
  useEffect(() => {
    return () => {
      try { sessionStorage.setItem("hg-loaded", JSON.stringify([...loadedImageUrls])); } catch {}
    };
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!authLoaded) return <div style={{ flex: 1, background: "#0B0E14" }} />;


  return (
    <div style={{ flex: 1, background: "#0B0E14", display: "flex", flexDirection: "column", overflow: "hidden", color: "#fff", position: "relative" }}>
      <DotCanvasBackground />

      {/* ── Sub-navbar ── */}
      {user && <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 14px",
        height: "44px",
        background: "#0B0E14",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        flexShrink: 0,
        position: "relative",
        zIndex: 1,
      }}>
        {/* Left: source tabs */}
        <div style={{ display: "flex", gap: "2px" }}>
          {(["generated", "uploaded"] as const).map(src => (
            <button
              key={src}
              onClick={() => {
                setSourceFilter(src);
                const params = new URLSearchParams(searchParams.toString());
                params.set("source", src);
                router.replace(`${pathname}?${params.toString()}`);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "5px 12px",
                borderRadius: "8px",
                border: "none",
                background: sourceFilter === src ? "rgba(255,255,255,0.08)" : "transparent",
                color: sourceFilter === src ? "#ffffff" : "rgba(255,255,255,0.38)",
                fontSize: "13px",
                fontWeight: sourceFilter === src ? 500 : 400,
                cursor: "pointer",
                transition: "background 140ms, color 140ms",
                fontFamily: "inherit",
                letterSpacing: "-0.01em",
              }}
              onMouseEnter={e => { if (sourceFilter !== src) e.currentTarget.style.color = "rgba(255,255,255,0.65)"; }}
              onMouseLeave={e => { if (sourceFilter !== src) e.currentTarget.style.color = "rgba(255,255,255,0.38)"; }}
            >
              {src === "generated" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              )}
              {src === "generated" ? "Generated" : "Uploaded"}
            </button>
          ))}
        </div>

        {/* Right: zoom slider */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35M8 11h6" />
          </svg>
          <input
            type="range"
            min={4} max={8} step={1}
            value={12 - zoom}
            onChange={e => setZoom(12 - Number(e.target.value))}
            className="gallery-zoom-slider"
          />
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35M11 8v6M8 11h6" />
          </svg>
        </div>
      </div>}

      {/* ── Grid ── */}
      {!user && process.env.NEXT_PUBLIC_GUEST_MODE !== "true" ? <GalleryLoggedOut tab={tab} /> : <div ref={gridOuterRef} style={{ flex: 1, overflowY: "auto", paddingBottom: "260px", display: "flex", flexDirection: "column" }}>
        {loading || containerWidth === 0 ? (
          /* Skeleton — shown while loading or before container is measured */
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${zoom}, 1fr)`, gap: "1px", padding: "1px", alignItems: "start" }}>
            {Array.from({ length: zoom * 3 }).map((_, i) => (
              <div key={i} className="gallery-skeleton" style={{ aspectRatio: i % 3 === 1 ? "4 / 5" : i % 5 === 0 ? "16 / 9" : "1 / 1" }} />
            ))}
          </div>
        ) : filteredItems.length === 0 && (sourceFilter !== "generated" || pendingGens.filter(pg => pg.tab == null || pg.tab === tab).length === 0) ? (
          <GalleryLoggedOut tab={tab} />
        ) : (
          <div ref={gridRef} style={{ padding: "1px" }}>
            {fixedRows.map((row, rowIdx) => (
              <div key={rowIdx} style={{ display: "flex", height: row.height, gap: `${GALLERY_GAP}px`, marginBottom: rowIdx < fixedRows.length - 1 ? `${GALLERY_GAP}px` : 0 }}>
                {row.items.map((layoutItem) => {
              if (layoutItem.kind === "pending") {
                const pg = layoutItem.pg;
                return (
                  <div key={pg.id} className={pg.error ? "error-pending-tile" : undefined} style={{
                    width: layoutItem.width,
                    flex: "0 0 auto",
                    height: "100%",
                    position: "relative",
                    overflow: "hidden",
                    background: pg.error ? "#2a2427" : "#2a2d35",
                  }}>
                        {pg.error ? (
                          <>
                            {/* Top radial glow */}
                            <div style={{
                              position: "absolute", top: "-40%", left: "50%", transform: "translateX(-50%)",
                              width: "180%", height: "80%", pointerEvents: "none",
                              background: "radial-gradient(ellipse at 50% 20%, rgba(180,40,40,0.38) 0%, transparent 70%)",
                            }} />
                            {/* Error card body */}
                            <div style={{
                              position: "absolute", inset: 0,
                              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                              gap: "8px", padding: "16px",
                              zIndex: 1,
                            }}>
                              {/* Icon with border ring + glow */}
                              <div style={{
                                width: 40, height: 40, borderRadius: "50%",
                                border: "1px solid rgba(248,113,113,0.45)",
                                boxShadow: "0 0 18px 4px rgba(200,50,50,0.35), inset 0 0 8px rgba(248,113,113,0.08)",
                                background: "rgba(30,10,10,0.6)",
                                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                              }}>
                                <ShieldAlert size={18} strokeWidth={1.75} style={{ color: "#f87171" }} />
                              </div>
                              {/* Tag */}
                              <span style={{
                                fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
                                color: "rgba(248,113,113,0.8)",
                                background: "rgba(120,30,30,0.35)",
                                padding: "2px 8px", borderRadius: "4px",
                              }}>
                                {(pg.error === "moderation_blocked" || pg.error?.includes?.("moderation_blocked") || pg.error?.includes?.("flagged as sensitive") || pg.error?.includes?.("moderation")) ? "Moderation" : "Failed"}
                              </span>
                              {/* Error message */}
                              <div style={{
                                fontSize: "11px", color: "rgba(255,255,255,0.75)", textAlign: "center",
                                lineHeight: 1.5, wordBreak: "break-word",
                                display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden",
                              }}>
                                {pg.error}
                              </div>
                              {/* Credits refunded — only for moderation */}
                              {(pg.error === "moderation_blocked" || pg.error?.includes?.("moderation_blocked") || pg.error?.includes?.("flagged as sensitive") || pg.error?.includes?.("moderation")) && (
                                <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", fontFamily: "monospace", marginTop: 2 }}>
                                  Credits refunded
                                </div>
                              )}
                            </div>
                            {/* Action buttons column */}
                            <div className="error-tile-actions" style={{ position: "absolute", top: 8, right: 8, display: "flex", flexDirection: "column", gap: 5, zIndex: 5 }}>
                              <button className="gallery-action-btn" title="Paste prompt & images" onClick={() => handleCopyPrompt(pg.prompt, pg.referenceImageUrls)}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                              </button>
                              <button className="gallery-action-btn" title="Retry" onClick={async () => {
                                const newId = randomUUID();
                                const newPending: PendingGen = { id: newId, aspectRatio: pg.aspectRatio, prompt: pg.prompt, referenceImageUrls: pg.referenceImageUrls, createdAt: pg.createdAt ?? new Date().toISOString(), tab: pg.tab, retried: true, folderId: pg.folderId };
                                setPendingGens(prev => [...prev.filter(p => p.id !== pg.id), newPending]);
                                const token = await getToken();
                                if (!token) { setPendingGens(prev => prev.map(p => p.id === newId ? { ...p, error: "Please sign in." } : p)); return; }
                                const storedRefs = pg.referenceImageUrls ?? [];
                                const syntheticTagged: TaggedImage[] = storedRefs.map((url, i) => ({ label: `image${i + 1}`, refId: url, url }));
                                const { resolvedPrompt, extraUrls } = resolveGalleryMentions(pg.prompt, syntheticTagged);
                                const dedupedExtra = new Set(extraUrls);
                                const imageUrls = [...extraUrls, ...storedRefs.filter(u => !dedupedExtra.has(u))];
                                const azureBaseUrl    = (() => { try { return localStorage.getItem("aiui-azure-base-url") ?? ""; } catch { return ""; } })();
                                const azureDeployment = (() => { try { return JSON.parse(localStorage.getItem("aiui-azure-endpoints") ?? "{}")[modelId] ?? ""; } catch { return ""; } })();
                                const providerForModel = (() => { try { return JSON.parse(localStorage.getItem("aiui-model-providers") ?? "{}")[modelId] ?? "kie"; } catch { return "kie"; } })();
                                const isAzure = !!(azureBaseUrl && azureDeployment && providerForModel === "azure");
                                let taskId: string;
                                try {
                                  const res = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ prompt: resolvedPrompt, model: modelId, aspectRatio: pg.aspectRatio, quality, imageUrls, ...(isAzure ? { azureBaseUrl, azureDeployment, azureQuality: quality } : {}) }) });
                                  const d = await res.json() as { taskId?: string; error?: string };
                                  if (!res.ok) throw new Error(d.error ?? "Failed");
                                  taskId = d.taskId!;
                                  setPendingGens(prev => prev.map(p => p.id === newId ? { ...p, taskId } : p));
                                } catch (e: unknown) {
                                  setPendingGens(prev => prev.map(p => p.id === newId ? { ...p, error: e instanceof Error ? e.message : String(e) } : p));
                                  return;
                                }
                                try {
                                  await pollTask(taskId);
                                  const existingIds = new Set((galleryCache.get(`${tabRef.current}-generation`)?.items ?? []).map((i: GalleryItem) => i.id));
                                  const fresh = await fetchNewItems(tabRef.current);
                                  setPendingGens(prev => prev.filter(p => p.id !== newId));
                                  if (fresh.length > 0) {
                                    if (newPending.folderId) {
                                      const existingMap = useFolderStore.getState().itemFolderMap;
                                      const pendingTime = newPending.createdAt ? new Date(newPending.createdAt).getTime() - 30_000 : 0;
                                      const untaggedIds = fresh
                                        .filter(i => new Date(i.created_at).getTime() >= pendingTime)
                                        .map(i => i.id)
                                        .filter(id => !existingMap[id]);
                                      if (untaggedIds.length > 0) assignItemsToFolder(untaggedIds, newPending.folderId);
                                    }
                                    const genCacheKey = `${tabRef.current}-generation`;
                                    setItems(prev => {
                                      const base = sourceFilterRef.current === "generated" ? prev : (galleryCache.get(genCacheKey)?.items ?? []);
                                      const merged = mergeByNewest(base, fresh);
                                      galleryCache.set(genCacheKey, { items: merged, hasMore: true });
                                      return sourceFilterRef.current === "generated" ? (merged === base ? prev : merged) : prev;
                                    });
                                  }
                                  onGenComplete(newPending.folderId, fresh.filter(i => !existingIds.has(i.id)).map(i => i.id));
                                  window.dispatchEvent(new Event("credits-refresh"));
                                } catch (e: unknown) {
                                  setPendingGens(prev => prev.map(p => p.id === newId ? { ...p, error: e instanceof Error ? e.message : String(e) } : p));
                                }
                              }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
                                </svg>
                              </button>
                              <button className="gallery-action-btn gallery-delete-btn" title="Dismiss" onClick={() => setPendingGens(prev => prev.filter(p => p.id !== pg.id))}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                                </svg>
                              </button>
                            </div>
                          </>
                        ) : (
                          <PendingGenTile
                            pg={pg}
                            onCancel={() => setPendingGens(prev => prev.filter(p => p.id !== pg.id))}
                          />
                        )}
                      </div>
                    );
                  }
                  return (
                    <div key={layoutItem.item.id} style={{ width: layoutItem.width, flex: "0 0 auto", height: "100%", overflow: "hidden", background: selectedIds.has(layoutItem.item.id) ? "#ffffff" : "transparent", transition: "background 180ms ease" }}>
                      <GalleryCard
                        item={layoutItem.item}
                        displayWidth={layoutItem.width}
                        onOpen={() => setLightboxItem(layoutItem.item)}
                        onAddReference={layoutItem.item.mediaType === "image" && canAddImgs ? handleAddReference : undefined}
                        onCopyPrompt={handleCopyPrompt}
                        onDownload={handleDownload}
                        onDelete={handleDelete}
                        videoMuted={videoMuted}
                        onToggleMute={() => setVideoMuted(m => !m)}
                        onNaturalRatioDiscovered={() => setNatRatioVersion(v => v + 1)}
                        selected={selectedIds.has(layoutItem.item.id)}
                        anySelected={anySelected}
                        onSelect={() => toggleSelect(layoutItem.item.id)}
                        scrollContainer={gridOuterRef}
                        isTagged={taggedImages.some(t => t.refId === layoutItem.item.id)}
                        isNew={newItemIds.has(layoutItem.item.id)}
                        onMarkSeen={() => setNewItemIds(prev => { const n = new Set(prev); n.delete(layoutItem.item.id); return n; })}
                      />
                    </div>
                  );
                })}
                {Array.from({ length: row.emptyCount }).map((_, i) => (
                  <div key={`empty-${i}`} style={{ flex: "0 0 auto", width: row.items[0]?.width ?? 0, height: "100%" }} />
                ))}
              </div>
            ))}
          </div>
        )}
        {loadingMore && (
          <div style={{ padding: "20px", display: "flex", justifyContent: "center" }}>
            <span style={{ width: "20px", height: "20px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "rgba(255,255,255,0.4)", animation: "spin 0.8s linear infinite" }} />
          </div>
        )}
        <div ref={sentinelRef} style={{ height: "1px", width: "100%" }} />
      </div>}

      {/* ── Hidden file input ── */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={e => { if (e.target.files) { handleFilePick(e.target.files); e.target.value = ""; } }}
      />
      <input ref={vidImgInputRef}   type="file" accept="image/*" multiple style={{ display: "none" }}
        onChange={e => { if (e.target.files && vidPickTarget.current) { handleVidFilePick(e.target.files, vidPickTarget.current); e.target.value = ""; } }} />
      <input ref={vidVideoInputRef} type="file" accept="video/*" multiple style={{ display: "none" }}
        onChange={e => { if (e.target.files && vidPickTarget.current) { handleVidFilePick(e.target.files, vidPickTarget.current); e.target.value = ""; } }} />
      <input ref={vidAudioInputRef} type="file" accept="audio/*" multiple style={{ display: "none" }}
        onChange={e => { if (e.target.files && vidPickTarget.current) { handleVidFilePick(e.target.files, vidPickTarget.current); e.target.value = ""; } }} />

      {/* ── Selection toolbar ── */}
      <div style={{
        position: "fixed",
        bottom: "20px",
        left: isMobile ? "50%" : state === "collapsed" ? "calc(var(--sidebar-width-icon) / 2 + 50%)" : "calc(var(--sidebar-width) / 2 + 50%)",
        transform: `translateX(-50%) translateY(${anySelected ? "0" : "80px"})`,
        opacity: anySelected ? 1 : 0,
        transition: "transform 300ms cubic-bezier(0.16,1,0.3,1), opacity 240ms ease, left 200ms ease-linear",
        pointerEvents: anySelected ? "auto" : "none",
        zIndex: 300,
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "8px 8px 8px 16px",
        background: "rgba(14,16,18,0.92)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "16px",
        boxShadow: "0 8px 40px rgba(0,0,0,0.8), 0 2px 12px rgba(0,0,0,0.5)",
        fontFamily: "inherit",
      }}>
        <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.55)", fontWeight: 500, paddingRight: "6px", whiteSpace: "nowrap" }}>
          {selectedIds.size} selected
        </span>
        <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />
        <button
          onClick={handleDownloadSelected}
          style={{
            display: "flex", alignItems: "center", gap: "7px",
            padding: "7px 14px", borderRadius: "10px", border: "none",
            background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.85)",
            fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
            transition: "background 140ms",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.13)")}
          onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download
        </button>
        <button
          onClick={handleDeleteSelected}
          style={{
            display: "flex", alignItems: "center", gap: "7px",
            padding: "7px 14px", borderRadius: "10px", border: "none",
            background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.85)",
            fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
            transition: "background 140ms, color 140ms",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.15)"; e.currentTarget.style.color = "#f87171"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
          Remove
        </button>
        {/* Add to folder button + popup */}
        {folders.length > 0 && (() => {
          const selectedArr = [...selectedIds];
          return (
            <div style={{ position: "relative", flexShrink: 0 }}>
              <button
                ref={folderPickerBtnRef}
                onClick={() => setFolderPickerOpen(o => !o)}
                style={{
                  display: "flex", alignItems: "center", gap: "7px",
                  padding: "7px 14px", borderRadius: "10px", border: "none",
                  background: folderPickerOpen ? "rgba(45,212,191,0.12)" : "rgba(255,255,255,0.07)",
                  color: folderPickerOpen ? "#2DD4BF" : "rgba(255,255,255,0.85)",
                  fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                  transition: "background 140ms, color 140ms",
                }}
                onMouseEnter={e => { if (!folderPickerOpen) { e.currentTarget.style.background = "rgba(255,255,255,0.13)"; } }}
                onMouseLeave={e => { if (!folderPickerOpen) { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; } }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                Add to folder
              </button>

              {/* Popup */}
              {folderPickerOpen && (
                <div
                  ref={folderPickerRef}
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 10px)",
                    left: "50%",
                    transform: "translateX(-50%)",
                    minWidth: "220px",
                    background: "rgba(14,16,20,0.97)",
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "14px",
                    boxShadow: "0 16px 48px rgba(0,0,0,0.85), 0 2px 8px rgba(0,0,0,0.4)",
                    overflow: "hidden",
                    zIndex: 400,
                  }}
                >
                  {/* Header */}
                  <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "rgba(255,255,255,0.3)" }}>
                      Add to folder
                    </span>
                  </div>

                  {/* Folder rows */}
                  <div style={{ padding: "6px 0" }}>
                    {folders.map(folder => {
                      const getIds = (id: string) => itemFolderMap[id] ?? [];
                      const checkedCount = selectedArr.filter(id => getIds(id).includes(folder.id)).length;
                      const allChecked = checkedCount === selectedArr.length && selectedArr.length > 0;
                      const someChecked = checkedCount > 0 && !allChecked;
                      // Items in this folder across ALL loaded items (both tabs combined best-effort)
                      const totalInFolder = items.filter(it => (itemFolderMap[it.id] ?? []).includes(folder.id)).length;
                      // How many selected items would be newly added
                      const toAddCount = selectedArr.filter(id => !getIds(id).includes(folder.id)).length;

                      const toggleFolder = () => {
                        if (allChecked) {
                          removeItemsFromFolder(selectedArr, folder.id);
                        } else {
                          assignItemsToFolder(selectedArr, folder.id);
                        }
                      };

                      return (
                        <div
                          key={folder.id}
                          onClick={toggleFolder}
                          style={{
                            display: "flex", alignItems: "center", gap: "10px",
                            padding: "9px 14px", cursor: "pointer",
                            transition: "background 120ms",
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                        >
                          {/* Folder icon */}
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={allChecked ? "#2DD4BF" : someChecked ? "rgba(45,212,191,0.5)" : "rgba(255,255,255,0.35)"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: "stroke 150ms" }}>
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                          </svg>

                          {/* Name + count */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "13px", color: (allChecked || someChecked) ? "#fff" : "rgba(255,255,255,0.75)", fontWeight: 500, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                              {folder.name}
                            </div>
                            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginTop: "1px" }}>
                              {!allChecked && toAddCount > 0
                                ? `${totalInFolder} → ${totalInFolder + toAddCount} item${totalInFolder + toAddCount !== 1 ? "s" : ""}`
                                : `${totalInFolder} item${totalInFolder !== 1 ? "s" : ""}`}
                            </div>
                          </div>

                          {/* Custom checkbox matching gallery-checkbox style */}
                          <div
                            onClick={e => { e.stopPropagation(); toggleFolder(); }}
                            style={{
                              width: "18px", height: "18px", borderRadius: "5px", flexShrink: 0, cursor: "pointer",
                              border: `2px solid ${allChecked ? "#fff" : someChecked ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.45)"}`,
                              background: allChecked ? "#fff" : someChecked ? "rgba(255,255,255,0.15)" : "transparent",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              transition: "background 120ms, border-color 120ms",
                            }}
                          >
                            {allChecked && (
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0B0E14" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 6 9 17l-5-5"/>
                              </svg>
                            )}
                            {someChecked && !allChecked && (
                              <svg width="10" height="2" viewBox="0 0 10 2" fill="none">
                                <rect width="10" height="2" rx="1" fill="#0B0E14"/>
                              </svg>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.1)", flexShrink: 0, marginLeft: "2px" }} />
        <button
          onClick={clearSelection}
          title="Cancel selection"
          style={{
            width: "34px", height: "34px", borderRadius: "10px", border: "none",
            background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", flexShrink: 0, transition: "background 140ms, color 140ms",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.13)"; e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "rgba(255,255,255,0.55)"; }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── Prompt bar ── */}
      <div
        ref={promptBarRef}
        style={{
          position: "fixed",
          bottom: "32px",
          left: promptExpanded ? "50%" : (isMobile ? "50%" : state === "collapsed" ? "calc(var(--sidebar-width-icon) / 2 + 50%)" : "calc(var(--sidebar-width) / 2 + 50%)"),
          transform: `translateX(-50%) translateY(${anySelected && !promptExpanded ? "200px" : "0"})`,
          opacity: anySelected && !promptExpanded ? 0 : 1,
          transition: "transform 350ms cubic-bezier(0.4,0,0.2,1), opacity 240ms ease, left 350ms cubic-bezier(0.4,0,0.2,1), width 350ms cubic-bezier(0.4,0,0.2,1), height 350ms cubic-bezier(0.4,0,0.2,1)",
          pointerEvents: anySelected && !promptExpanded ? "none" : "auto",
          width: promptExpanded ? "75vw" : "min(860px, calc(100vw - 32px))",
          height: promptExpanded ? "75vh" : "auto",
          zIndex: 200,
        }}
      >

        {/* Toast */}
        {genError && (
          <div style={{
            marginBottom: "8px",
            padding: "8px 14px",
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: "10px",
            fontSize: "12px",
            color: "#f87171",
          }}>
            {genError}
          </div>
        )}

        <div style={{
          position: "relative",
          background: "rgba(14,16,18,0.55)",
          backdropFilter: "blur(48px)",
          WebkitBackdropFilter: "blur(48px)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "18px",
          boxShadow: "0 28px 80px rgba(0,0,0,0.9), 0 4px 20px rgba(0,0,0,0.5)",
          overflow: "hidden",
          height: promptExpanded ? "100%" : undefined,
          display: promptExpanded ? "flex" : undefined,
          flexDirection: promptExpanded ? "column" : undefined,
        }}>

          {/* Clear prompt button */}
          {(prompt || refImages.length > 0 || taggedImages.length > 0 || vidElements.length > 0 || vidStartFrame || vidEndFrame || vidVideoRef || vidResources.length > 0 || vidRefVideos.length > 0 || vidRefAudios.length > 0) && (
            <button
              onClick={() => {
                refImages.forEach(r => URL.revokeObjectURL(r.objectUrl));
                setPrompt("");
                setRefImages([]);
                setTaggedImages([]);
                setVidElements([]);
                setVidStartFrame(null);
                setVidEndFrame(null);
                setVidVideoRef(null);
                setVidResources([]);
                setVidRefVideos([]);
                setVidRefAudios([]);
              }}
              title="Clear prompt"
              style={{
                position: "absolute",
                top: "10px",
                right: "46px",
                width: "26px",
                height: "26px",
                borderRadius: "8px",
                border: "none",
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.35)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                zIndex: 10,
                transition: "background 140ms, color 140ms",
                flexShrink: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(248,113,113,0.15)"; e.currentTarget.style.color = "rgba(248,113,113,0.8)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.35)"; }}
            >
              <X size={12} strokeWidth={2.5} />
            </button>
          )}

          {/* Expand / collapse button */}
          <button
            onClick={() => setPromptExpanded(v => !v)}
            title={promptExpanded ? "Collapse prompt" : "Expand prompt"}
            style={{
              position: "absolute",
              top: "10px",
              right: "12px",
              width: "26px",
              height: "26px",
              borderRadius: "8px",
              border: "none",
              background: "rgba(255,255,255,0.06)",
              color: "rgba(255,255,255,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              zIndex: 10,
              transition: "background 140ms, color 140ms",
              flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.35)"; }}
          >
            {promptExpanded ? (
              <Minimize2 size={12} strokeWidth={2.2} />
            ) : (
              <Maximize2 size={12} strokeWidth={2.2} />
            )}
          </button>

          {/* ── Reference image thumbnails (Always visible, integrated) ── */}
          <div style={{ maxHeight: "200px", overflowY: "auto", borderBottom: "none" }}>
            {!isVideo && imgModel?.supportsImages && (hasRefImgs || canAddImgs) && (
              <div style={{ padding: "14px 16px 0", display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-start", paddingBottom: "14px" }} onPointerUp={() => { if (_reorderDragItem?.listTarget === "refImage") { _reorderDragItem = null; _reorderOverId = null; setDraggingId(null); setReorderOverId(null); } }}>
                {displayRefImages.map(img => {
                  const isRemoving = removingIds.has(img.id);
                  const isHovered = hoveredRefId === img.id;
                  const isDragging = draggingId === img.id;
                  return (
                    <div key={img.id} onMouseDown={e => e.preventDefault()} onPointerDown={e => { if (refImages.length <= 1 || img.uploading || img.error) return; _reorderDragItem = { id: img.id, listTarget: "refImage" }; _reorderOverId = null; setDraggingId(img.id); }} onPointerEnter={() => { if (!_reorderDragItem || _reorderDragItem.id === img.id || _reorderDragItem.listTarget !== "refImage") return; _reorderOverId = img.id; setReorderOverId(img.id); }} onPointerUp={e => { const info = _reorderDragItem; if (!info || info.listTarget !== "refImage") return; e.stopPropagation(); if (_reorderOverId) e.preventDefault(); const target = _reorderOverId ?? img.id; handleReorderDrop(target, "refImage"); }} onMouseEnter={() => { if (!draggingId) setHoveredRefId(img.id); }} onMouseLeave={() => setHoveredRefId(null)} onClick={() => { if (_reorderJustDropped) { _reorderJustDropped = false; return; } if (!img.uploading && !img.error && !draggingId) setRefPreview({ url: img.objectUrl, mediaKind: "image" }); }} onDragOver={e => { if (!e.dataTransfer.types.includes("application/x-gallery-item")) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setDragOverSlotKey(`refimg-filled-${img.id}`); }} onDragLeave={() => setDragOverSlotKey(null)} onDrop={e => handleGalleryItemDrop(e, "refImage", "image")} style={{ position: "relative", width: "64px", height: "64px", borderRadius: "8px", overflow: "hidden", background: "#1A1C1F", flexShrink: 0, touchAction: refImages.length > 1 ? "none" : undefined, transition: "border 120ms, box-shadow 120ms, opacity 120ms", border: img.error ? "1px solid rgba(248,113,113,0.4)" : dragOverSlotKey === `refimg-filled-${img.id}` ? "2.5px solid #2DD4BF" : taggedImages.some(t => t.refId === img.id) ? "2.5px solid #10b981" : "1px solid rgba(255,255,255,0.08)", boxShadow: dragOverSlotKey === `refimg-filled-${img.id}` ? "0 0 0 3px rgba(45,212,191,0.25)" : undefined, cursor: (!img.uploading && !img.error) ? (refImages.length > 1 ? (draggingId === img.id ? "grabbing" : "grab") : "zoom-in") : "default", animation: isRemoving ? "none" : (isDragging ? "none" : "refImgIn 260ms cubic-bezier(0.16,1,0.3,1)"), opacity: isDragging ? 0.3 : undefined, ...(isRemoving ? { transition: "opacity 170ms, transform 170ms", opacity: 0, transform: "translateY(-10px) scale(0.92)" } : {}) }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbSrc(img.objectUrl)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      {isHovered && !img.uploading && !img.error && (
                        <div onClick={e => { if (_reorderJustDropped || draggingId) { _reorderJustDropped = false; e.stopPropagation(); return; } e.stopPropagation(); setRefPreview({ url: img.objectUrl, mediaKind: "image" }); }} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-in" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></div>
                      )}
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "8px 4px 3px", background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)", textAlign: "center" }}><span style={{ fontSize: "8px", fontWeight: 700, letterSpacing: "0.04em", color: "rgba(255,255,255,0.85)", textTransform: "uppercase" }}>Image</span></div>
                      {img.uploading && (<div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ width: "14px", height: "14px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "#2DD4BF", display: "inline-block", animation: "spin 0.75s linear infinite" }} /></div>)}
                      {img.error && (<div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg></div>)}
                      <button onClick={e => { e.stopPropagation(); removeImage(img.id); }} style={{ position: "absolute", top: "3px", right: "3px", width: "16px", height: "16px", borderRadius: "50%", background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.85)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, fontSize: "10px", zIndex: 2 }}>
<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
                    </div>
                  );
                })}
                {canAddImgs && (
                  <button
                    onClick={() => openPicker("refImage", "image")}
                    disabled={submitting}
                    onDragOver={e => { if (!e.dataTransfer.types.includes("application/x-gallery-item")) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setDragOverSlotKey("refImage-add"); }}
                    onDragLeave={() => setDragOverSlotKey(null)}
                    onDrop={e => handleGalleryItemDrop(e, "refImage", "image")}
                    style={{ width: "64px", height: "64px", borderRadius: "8px", border: dragOverSlotKey === "refImage-add" ? "2.5px solid #2DD4BF" : "1.5px dashed rgba(255,255,255,0.2)", boxShadow: dragOverSlotKey === "refImage-add" ? "0 0 0 3px rgba(45,212,191,0.25)" : undefined, background: dragOverSlotKey === "refImage-add" ? "rgba(45,212,191,0.07)" : "rgba(255,255,255,0.03)", cursor: submitting ? "not-allowed" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", color: dragOverSlotKey === "refImage-add" ? "#2DD4BF" : "rgba(255,255,255,0.45)", flexShrink: 0, transition: "all 140ms" }}>
                    <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.04em" }}>IMAGE</span>
                    <span style={{ fontSize: "8px", color: dragOverSlotKey === "refImage-add" ? "#2DD4BF" : "rgba(255,255,255,0.3)" }}>
                      {maxImgs - refImages.length} left
                    </span>

                  </button>
                )}
              </div>
            )}
            {isVideo && vidRefHandles.length > 0 && (() => {
              type VidSlot =
                | { kind: "filled"; target: "startFrame"|"endFrame"|"resource"|"videoRef"|"referenceVideo"|"audioRef"; mediaKind: "image"|"video"|"audio"; label: string; ref: RefImage }
                | { kind: "add";    target: "startFrame"|"endFrame"|"resource"|"videoRef"|"referenceVideo"|"audioRef"; mediaKind: "image"|"video"|"audio"; label: string; countLeft: number }
                | { kind: "element-filled"; element: KlingElement }
                | { kind: "element-add"; countLeft: number };
              const slots: VidSlot[] = [];
              const useElems = !!(vidModel?.apiInput.useKlingElements);
              const isHappyHorse = vidModel?.id === "happyhorse";
              const isVeo = modelId === "veo3" || modelId === "veo3_fast" || modelId === "veo3_lite";
              for (const h of vidRefHandles) {
                if (isVeo) {
                  if (veoMode === "references" && (h === "startFrame" || h === "endFrame")) continue;
                  if (veoMode === "frames" && h === "resource") continue;
                  if (h === "videoRef" || h === "referenceVideo" || h === "audioRef") continue;
                }
                if (isHappyHorse && h === "startFrame" && vidResources.length > 0) continue;
                if (isHappyHorse && h === "resource" && vidStartFrame) continue;
                const isSeedance = vidModel?.id === "seedance-2" || vidModel?.id === "seedance-2-fast";
                const seedanceHasFrame = !!(vidStartFrame || vidEndFrame);
                const seedanceHasRef   = vidResources.length > 0 || vidRefVideos.length > 0 || vidRefAudios.length > 0;
                if (isSeedance && seedanceHasFrame && (h === "resource" || h === "referenceVideo" || h === "audioRef")) continue;
                if (isSeedance && seedanceHasRef   && (h === "startFrame" || h === "endFrame")) continue;
                if (h === "startFrame") {
                  if (vidStartFrame) slots.push({ kind: "filled", target: h, mediaKind: "image", label: "Start Frame", ref: vidStartFrame });
                  else               slots.push({ kind: "add",    target: h, mediaKind: "image", label: "Start Frame", countLeft: 1 });
                } else if (h === "endFrame") {
                  if (vidEndFrame)   slots.push({ kind: "filled", target: h, mediaKind: "image", label: "End Frame", ref: vidEndFrame });
                  else               slots.push({ kind: "add",    target: h, mediaKind: "image", label: "End Frame", countLeft: 1 });
                } else if (h === "videoRef") {
                  if (vidVideoRef)   slots.push({ kind: "filled", target: h, mediaKind: "video", label: "Ref Video", ref: vidVideoRef });
                  else               slots.push({ kind: "add",    target: h, mediaKind: "video", label: "Ref Video", countLeft: 1 });
                } else if (h === "resource") {
                  if (useElems) {
                    vidElements.forEach(el => slots.push({ kind: "element-filled", element: el }));
                    if (vidElements.length < 3) slots.push({ kind: "element-add", countLeft: 3 - vidElements.length });
                  } else {
                    const maxRes = vidModel?.maxResources ?? 3;
                    const resLabel = vidModel?.id === "happyhorse" ? "Character" : "Image";
                    displayVidResources.forEach(r => slots.push({ kind: "filled", target: h, mediaKind: "image", label: resLabel, ref: r }));
                    if (vidResources.length < maxRes)
                      slots.push({ kind: "add", target: h, mediaKind: "image", label: resLabel, countLeft: maxRes - vidResources.length });
                  }
                } else if (h === "referenceVideo") {
                  const maxRefVid = vidModel?.maxReferenceVideos ?? 3;
                  displayVidRefVideos.forEach(r => slots.push({ kind: "filled", target: h, mediaKind: "video", label: "Ref Video", ref: r }));
                  if (vidRefVideos.length < maxRefVid)
                    slots.push({ kind: "add", target: h, mediaKind: "video", label: "Ref Video", countLeft: maxRefVid - vidRefVideos.length });
                } else if (h === "audioRef") {
                  const maxRefAud = vidModel?.maxReferenceAudios ?? 3;
                  displayVidRefAudios.forEach(r => slots.push({ kind: "filled", target: h, mediaKind: "audio", label: "Audio", ref: r }));
                  if (vidRefAudios.length < maxRefAud)
                    slots.push({ kind: "add", target: h, mediaKind: "audio", label: "Audio", countLeft: maxRefAud - vidRefAudios.length });
                }
              }
              return (
                <div style={{ padding: "14px 16px 14px", display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "flex-start" }} onPointerUp={() => { if (_reorderDragItem) { _reorderDragItem = null; _reorderOverId = null; setDraggingId(null); setReorderOverId(null); } }}>
                  {slots.map((slot, idx) => {
                    if (slot.kind === "element-filled") {
                      const el = slot.element; const thumb = el.imageUrls[0]; const hovId = `elem-${el.id}`;
                      return (
                        <div key={el.id} onMouseEnter={() => setHoveredRefId(hovId)} onMouseLeave={() => setHoveredRefId(null)} style={{ position: "relative", width: "64px", height: "64px", borderRadius: "8px", overflow: "hidden", flexShrink: 0, background: "#1a1c1f", border: "1px solid rgba(255,255,255,0.12)" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          {hoveredRefId === hovId && (
                            <div onClick={() => setRefPreview({ url: thumb, mediaKind: "image" })} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-in", zIndex: 1 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></div>
                          )}
                          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "8px 4px 3px", background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)", textAlign: "center" }}><span style={{ fontSize: "8px", fontWeight: 700, letterSpacing: "0.04em", color: "rgba(255,255,255,0.85)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block", padding: "0 4px" }}>{el.name.toUpperCase()}</span></div>
                          <button onClick={() => setVidElements(prev => prev.filter(e => e.id !== el.id))} style={{ position: "absolute", top: "3px", right: "3px", width: "16px", height: "16px", borderRadius: "50%", background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.85)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "background 120ms", zIndex: 2 }}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                        </div>
                        );
                        }
                        if (slot.kind === "element-add") {
                        return (
                        <button key={`element-add-${idx}`} onClick={() => setElementPickerOpen(true)} disabled={submitting} style={{ width: "64px", height: "64px", borderRadius: "8px", flexShrink: 0, border: "1.5px dashed rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.03)", cursor: submitting ? "not-allowed" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "2px", color: "rgba(255,255,255,0.4)", transition: "all 140ms" }}>
                        <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.04em" }}>ELEM</span>
                        <span style={{ fontSize: "8px", color: "rgba(255,255,255,0.3)" }}>{slot.countLeft} left</span>
                        </button>
                        );
                        }
                        if (slot.kind === "filled") {
                        const r = slot.ref; const hovId = `slot-${r.id}`; const dragKey = `vidfilled-${r.id}`;
                        const isMultiTarget = slot.target === "resource" || slot.target === "referenceVideo" || slot.target === "audioRef";
                        const listForSlot = slot.target === "resource" ? vidResources : slot.target === "referenceVideo" ? vidRefVideos : vidRefAudios;
                        const isSlotDragging = draggingId === r.id;
                        return (
                        <div key={r.id} onMouseDown={e => e.preventDefault()} onPointerDown={e => { if (!isMultiTarget || listForSlot.length <= 1 || r.uploading || r.error) return; _reorderDragItem = { id: r.id, listTarget: slot.target as "resource"|"referenceVideo"|"audioRef" }; _reorderOverId = null; setDraggingId(r.id); }} onPointerEnter={() => { if (!_reorderDragItem || _reorderDragItem.id === r.id || _reorderDragItem.listTarget !== slot.target) return; _reorderOverId = r.id; setReorderOverId(r.id); }} onPointerUp={e => { const info = _reorderDragItem; if (!info || info.listTarget !== slot.target) return; e.stopPropagation(); if (_reorderOverId) e.preventDefault(); const target = _reorderOverId ?? r.id; handleReorderDrop(target, slot.target as "resource"|"referenceVideo"|"audioRef"); }} onMouseEnter={() => { if (!draggingId) setHoveredRefId(hovId); }} onMouseLeave={() => setHoveredRefId(null)} onDragOver={e => { if (slot.mediaKind === "audio" || !e.dataTransfer.types.includes("application/x-gallery-item")) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setDragOverSlotKey(dragKey); }} onDragLeave={() => setDragOverSlotKey(null)} onDrop={e => { if (slot.mediaKind !== "audio") handleGalleryItemDrop(e, slot.target as any, slot.mediaKind as "image" | "video"); }} style={{ position: "relative", width: "64px", height: "64px", borderRadius: "8px", overflow: "hidden", flexShrink: 0, background: "#1a1c1f", touchAction: (isMultiTarget && listForSlot.length > 1) ? "none" : undefined, transition: "border 120ms, box-shadow 120ms, opacity 120ms", border: r.error ? "1px solid rgba(248,113,113,0.4)" : dragOverSlotKey === dragKey ? "2.5px solid #2DD4BF" : taggedImages.some(t => t.refId === r.id) ? "2.5px solid #10b981" : "1px solid rgba(255,255,255,0.12)", boxShadow: dragOverSlotKey === dragKey ? "0 0 0 3px rgba(45,212,191,0.25)" : undefined, opacity: isSlotDragging ? 0.3 : undefined, cursor: (isMultiTarget && listForSlot.length > 1 && !r.uploading && !r.error) ? (draggingId === r.id ? "grabbing" : "grab") : undefined }}>
                          {slot.mediaKind === "image" ? <img src={thumbSrc(r.objectUrl)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : slot.mediaKind === "video" ? <video src={r.objectUrl} autoPlay muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.04)" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>}
                          {hoveredRefId === hovId && !r.uploading && !r.error && slot.mediaKind !== "audio" && (
                            <div onClick={() => { if (_reorderJustDropped || draggingId) { _reorderJustDropped = false; return; } setRefPreview({ url: r.objectUrl, mediaKind: slot.mediaKind }); }} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-in", zIndex: 1 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></div>
                          )}
                          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "8px 4px 3px", background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)", textAlign: "center" }}><span style={{ fontSize: "8px", fontWeight: 700, letterSpacing: "0.04em", color: "rgba(255,255,255,0.85)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block", padding: "0 4px" }}>{slot.label.toUpperCase()}</span></div>
                          <button onClick={() => removeVidRef(r.id, slot.target)} style={{ position: "absolute", top: "3px", right: "3px", width: "16px", height: "16px", borderRadius: "50%", background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.85)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "background 120ms", zIndex: 2 }}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                        </div>
                        );
                        }
                        const vidAddKey = `vidadd-${slot.target}-${idx}`;
                        return (
                        <button key={`${slot.target}-add-${idx}`} onClick={() => slot.mediaKind === "audio" ? (vidPickTarget.current = slot.target, vidAudioInputRef.current?.click()) : openPicker(slot.target as any, slot.mediaKind)} disabled={submitting} onDragOver={e => { if (slot.mediaKind === "audio" || !e.dataTransfer.types.includes("application/x-gallery-item")) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setDragOverSlotKey(vidAddKey); }} onDragLeave={() => setDragOverSlotKey(null)} onDrop={e => { if (slot.mediaKind !== "audio") handleGalleryItemDrop(e, slot.target as any, slot.mediaKind as "image" | "video"); }} style={{ width: "64px", height: "64px", borderRadius: "8px", flexShrink: 0, border: dragOverSlotKey === vidAddKey ? "2.5px solid #2DD4BF" : "1.5px dashed rgba(255,255,255,0.2)", boxShadow: dragOverSlotKey === vidAddKey ? "0 0 0 3px rgba(45,212,191,0.25)" : undefined, background: dragOverSlotKey === vidAddKey ? "rgba(45,212,191,0.07)" : "rgba(255,255,255,0.03)", cursor: submitting ? "not-allowed" : "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "2px", color: dragOverSlotKey === vidAddKey ? "#2DD4BF" : "rgba(255,255,255,0.4)", transition: "all 140ms" }}>
                        <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.04em" }}>{slot.label === "Ref Video" ? "VIDEO" : slot.label === "Audio" ? "AUDIO" : slot.label.toUpperCase()}</span>
                        <span style={{ fontSize: "8px", color: dragOverSlotKey === vidAddKey ? "#2DD4BF" : "rgba(255,255,255,0.3)" }}>{slot.countLeft} left</span>
                        </button>
                        );
                  })}
                </div>
              );
            })()}
          </div>

          {/* ── Prompt input ── */}
          {/* ── Input + Controls + Generate ── */}
          <div style={{
            padding: `${(isVideo && vidRefHandles.length > 0) || (!isVideo && !!imgModel?.supportsImages) ? 0 : 16}px 14px 14px 16px`,
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            flex: promptExpanded ? 1 : undefined,
          }}>
            {/* Multi-prompt mode strip */}
            {multiPromptMode && (
              <div style={{
                display: "flex", alignItems: "center", gap: "6px",
                fontSize: "11px", fontWeight: 500, color: "rgba(255,255,255,0.45)",
                letterSpacing: "0.02em", marginBottom: "-2px",
              }}>
                <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#2DD4BF", flexShrink: 0 }} />
                Multi <strong style={{ color: "#2DD4BF", fontWeight: 600 }}>on</strong>
                {" · "}
                {prompt.split(/\n\n+/).filter(p => p.trim()).length} prompt{prompt.split(/\n\n+/).filter(p => p.trim()).length !== 1 ? "s" : ""}
              </div>
            )}

            {/* Prompt input with inline mention chips — hidden in multi-prompt mode */}
            <div style={{ position: "relative", flex: promptExpanded ? "1 1 0" : "none", minHeight: 0, overflow: promptExpanded ? "hidden" : undefined, display: multiPromptMode ? "none" : undefined }}>
              {/* Transparent textarea — editing layer */}
              <textarea
                ref={inputRef}
                data-prompt-input=""
                value={prompt}
                rows={1}
                onChange={e => {
                  const text = e.target.value;
                  const cursor = e.target.selectionStart ?? text.length;
                  setPrompt(text);
                  if (!promptExpanded) resizeTextarea(e.target, 264);
                  if (!isVideo) {
                    const match = text.slice(0, cursor).match(/@(\w*)$/);
                    setMentionQuery(match ? match[1] : null);
                  }
                }}
                onSelect={e => {
                  const ta = e.currentTarget;
                  const cursor = ta.selectionStart ?? ta.value.length;
                  const match = ta.value.slice(0, cursor).match(/@(\w*)$/);
                  setMentionQuery(match ? match[1] : null);
                }}
                onScroll={e => {
                  if (overlayInnerRef.current)
                    overlayInnerRef.current.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
                }}
                onKeyDown={e => {
                  if (atMenuOpen) {
                    if (e.key === "ArrowDown") { e.preventDefault(); setMentionSelIdx(i => (i + 1) % filteredMentions.length); return; }
                    if (e.key === "ArrowUp") { e.preventDefault(); setMentionSelIdx(i => (i - 1 + filteredMentions.length) % filteredMentions.length); return; }
                    if (e.key === "Enter") { e.preventDefault(); insertMention(filteredMentions[mentionSelIdx]); return; }
                    if (e.key === "Escape") { setMentionQuery(null); return; }
                  }
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !submitting) { e.preventDefault(); generate(); }
                }}
                disabled={submitting}
                style={{
                  position: "relative",
                  display: "block",
                  width: "100%",
                  ...(promptExpanded ? { height: "100%", maxHeight: "none" } : { maxHeight: "264px" }),
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "transparent",
                  caretColor: "#2DD4BF",
                  fontSize: "14.5px",
                  fontFamily: promptTextMode !== "text" ? "monospace" : "inherit",
                  lineHeight: "22px",
                  letterSpacing: promptTextMode !== "text" ? "normal" : "-0.01em",
                  padding: 0,
                  resize: "none",
                  overflowY: "auto",
                  scrollbarWidth: "none",
                } as React.CSSProperties}
              />
              {/* Chip overlay — visually replaces the transparent text */}
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  overflow: "hidden",
                  pointerEvents: "none",
                }}
              >
                <div
                  ref={overlayInnerRef}
                  style={{
                    display: "block",
                    fontSize: "14.5px",
                    fontFamily: promptTextMode !== "text" ? "monospace" : "inherit",
                    lineHeight: "22px",
                    letterSpacing: promptTextMode !== "text" ? "normal" : "-0.01em",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    willChange: "transform",
                  }}
                >
                  {promptTextMode !== "text" ? (
                    promptTextMode === "yaml"
                      ? syntaxHighlightYaml(prompt, taggedImages, (tag, rect) => setChipPreview({ tag, rect }), () => setChipPreview(null), tag => { const idx = prompt.indexOf(`@${tag.label}`); const pos = idx >= 0 ? idx + tag.label.length + 1 : prompt.length; inputRef.current?.focus(); inputRef.current?.setSelectionRange(pos, pos); })
                      : syntaxHighlightJson(prompt, taggedImages, (tag, rect) => setChipPreview({ tag, rect }), () => setChipPreview(null), tag => { const idx = prompt.indexOf(`@${tag.label}`); const pos = idx >= 0 ? idx + tag.label.length + 1 : prompt.length; inputRef.current?.focus(); inputRef.current?.setSelectionRange(pos, pos); })
                  ) : promptMaxLength !== null && prompt.length > promptMaxLength ? (
                    <>
                      {renderGalleryMentions(
                        prompt.slice(0, promptMaxLength), taggedImages,
                        (tag, rect) => setChipPreview({ tag, rect }),
                        () => setChipPreview(null),
                        tag => {
                          const idx = prompt.indexOf(`@${tag.label}`);
                          const pos = idx >= 0 ? idx + tag.label.length + 1 : prompt.length;
                          inputRef.current?.focus();
                          inputRef.current?.setSelectionRange(pos, pos);
                        },
                      )}
                      <span style={{ background: "rgba(239,68,68,0.22)", color: "#f87171", borderRadius: 2 }}>
                        {prompt.slice(promptMaxLength)}
                      </span>
                    </>
                  ) : renderGalleryMentions(
                    prompt, taggedImages,
                    (tag, rect) => setChipPreview({ tag, rect }),
                    () => setChipPreview(null),
                    tag => {
                      const idx = prompt.indexOf(`@${tag.label}`);
                      const pos = idx >= 0 ? idx + tag.label.length + 1 : prompt.length;
                      inputRef.current?.focus();
                      inputRef.current?.setSelectionRange(pos, pos);
                    },
                  )}
                </div>
              </div>
              {/* Placeholder */}
              {!prompt && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "block",
                    lineHeight: "22px",
                    fontSize: "14.5px",
                    fontFamily: "inherit",
                    letterSpacing: "-0.01em",
                    color: "rgba(255,255,255,0.3)",
                    pointerEvents: "none",
                  }}
                >
                  {isVideo ? "Describe the video you imagine…" : "Describe the scene you imagine…"}
                </div>
              )}
            </div>

            {/* Multi-prompt stack — blocks separated by \n\n */}
            {multiPromptMode && (() => {
              const blocks = prompt.split(/\n\n+/).reduce<string[]>((acc, b) => {
                if (!b.trim() && acc.some(x => !x.trim())) return acc; // max one empty block
                return [...acc, b];
              }, []);
              let promptIndex = 0;
              return (
                <div data-prompt-stack="" style={{
                  display: "flex", flexDirection: "column", gap: "6px",
                  maxHeight: promptExpanded ? "calc(75vh - 220px)" : "204px", overflowY: "auto", scrollbarWidth: "none",
                }}>
                  {blocks.map((block, blockIdx) => {
                    const isNonEmpty = !!block.trim();
                    const displayIdx = isNonEmpty ? ++promptIndex : null;
                    const isExpanded = expandedPromptIdx === blockIdx;
                    return (
                      <div
                        key={blockIdx}
                        onClick={(e) => {
                          const next = isExpanded ? null : blockIdx;
                          setExpandedPromptIdx(next);
                          if (next !== null) {
                            requestAnimationFrame(() => {
                              const stack = document.querySelector('[data-prompt-stack]');
                              const ta = stack?.querySelectorAll<HTMLTextAreaElement>('textarea')[blockIdx];
                              if (ta) ta.focus();
                            });
                          } else {
                            const rowEl = e.currentTarget as HTMLElement;
                            requestAnimationFrame(() => rowEl.scrollIntoView({ block: "nearest", behavior: "smooth" }));
                          }
                        }}
                        style={{
                          position: "relative",
                          display: "flex", alignItems: "flex-start", gap: "8px",
                          background: isExpanded ? "rgba(45,212,191,0.04)" : "rgba(255,255,255,0.03)",
                          border: `1px solid ${isExpanded ? "rgba(45,212,191,0.18)" : isNonEmpty ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.04)"}`,
                          borderRadius: "8px", padding: "7px 24px 7px 10px",
                          opacity: isNonEmpty ? 1 : 0.4,
                          cursor: isExpanded ? "default" : "pointer",
                          transition: "background 120ms, border-color 120ms",
                          flexShrink: 0,
                        }}
                      >
                        <span style={{
                          fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
                          color: isNonEmpty ? "#2DD4BF" : "rgba(255,255,255,0.25)",
                          fontFamily: "monospace", lineHeight: "22px", flexShrink: 0, minWidth: "18px",
                        }}>
                          {displayIdx !== null ? String(displayIdx).padStart(2, '0') : "—"}
                        </span>
                        <div data-block-wrapper="" style={{ flex: 1, position: "relative", minWidth: 0 }}>
                        <textarea
                          value={block}
                          rows={1}
                          data-prompt-input=""
                          placeholder={blockIdx === 0 && !isNonEmpty ? "Describe the scene you imagine…" : undefined}
                          onClick={e => { if (isExpanded) e.stopPropagation(); }}
                          onFocus={e => {
                            activeBlockRef.current = e.currentTarget;
                            activeBlockIdxRef.current = blockIdx;
                            const ta = e.currentTarget;
                            const cursor = ta.selectionStart ?? ta.value.length;
                            const match = ta.value.slice(0, cursor).match(/@(\w*)$/);
                            setMentionQuery(match ? match[1] : null);
                          }}
                          onSelect={e => {
                            const ta = e.currentTarget;
                            const cursor = ta.selectionStart ?? ta.value.length;
                            const match = ta.value.slice(0, cursor).match(/@(\w*)$/);
                            setMentionQuery(match ? match[1] : null);
                          }}
                          onScroll={e => {
                            const st = e.currentTarget.scrollTop;
                            const wrapper = (e.target as HTMLElement).closest('[data-block-wrapper]');
                            if (promptTextMode !== "text") {
                              const overlay = wrapper?.querySelector('[data-block-overlay]') as HTMLElement | null;
                              if (overlay) overlay.style.transform = `translateY(-${st}px)`;
                            } else {
                              const overlay = wrapper?.querySelector('[data-block-text-overlay]') as HTMLElement | null;
                              if (overlay) overlay.style.transform = `translateY(-${st}px)`;
                            }
                          }}
                          onChange={e => {
                            const newVal = e.target.value;
                            const cursor = e.target.selectionStart ?? newVal.length;
                            const match = newVal.slice(0, cursor).match(/@(\w*)$/);
                            setMentionQuery(match ? match[1] : null);
                            if (newVal.includes('\n\n')) {
                              // Double newline → split into a new block
                              const splitIdx = newVal.indexOf('\n\n');
                              const before = newVal.slice(0, splitIdx);
                              const after = newVal.slice(splitIdx + 2);
                              const raw = [...blocks.slice(0, blockIdx), before, after, ...blocks.slice(blockIdx + 1)];
                              const normalized = raw.reduce<string[]>((acc, b) => {
                                if (!b.trim() && acc.some(x => !x.trim())) return acc;
                                return [...acc, b];
                              }, []);
                              setPrompt(normalized.join('\n\n'));
                              const focusIdx = blockIdx + 1;
                              setExpandedPromptIdx(focusIdx);
                              activeBlockIdxRef.current = focusIdx;
                              requestAnimationFrame(() => {
                                const stack = document.querySelector('[data-prompt-stack]');
                                const rows = stack?.querySelectorAll<HTMLTextAreaElement>('textarea');
                                const newRow = rows?.[focusIdx];
                                if (newRow) {
                                  activeBlockRef.current = newRow;
                                  newRow.focus();
                                  newRow.setSelectionRange(0, 0);
                                }
                              });
                            } else {
                              const updated = [...blocks];
                              updated[blockIdx] = newVal;
                              setPrompt(updated.join('\n\n'));
                            }
                          }}
                          onKeyDown={e => {
                            if (atMenuOpen) {
                              if (e.key === "ArrowDown") { e.preventDefault(); setMentionSelIdx(i => (i + 1) % filteredMentions.length); return; }
                              if (e.key === "ArrowUp") { e.preventDefault(); setMentionSelIdx(i => (i - 1 + filteredMentions.length) % filteredMentions.length); return; }
                              if (e.key === "Enter") { e.preventDefault(); insertMention(filteredMentions[mentionSelIdx]); return; }
                              if (e.key === "Escape") { setMentionQuery(null); return; }
                            }
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !submitting) { e.preventDefault(); generate(); return; }
                            if (e.key === "Enter" && !isExpanded) {
                              // Expand collapsed block on Enter instead of inserting newline
                              e.preventDefault();
                              setExpandedPromptIdx(blockIdx);
                              requestAnimationFrame(() => {
                                const stack = document.querySelector('[data-prompt-stack]');
                                const ta = stack?.querySelectorAll<HTMLTextAreaElement>('textarea')[blockIdx];
                                if (ta) {
                                  ta.focus();
                                  ta.setSelectionRange(ta.value.length, ta.value.length);
                                }
                              });
                              return;
                            }
                            if ((e.key === "Backspace" || e.key === "Delete") && !block.trim() && blocks.length > 1) {
                              e.preventDefault();
                              const updated = blocks.filter((_, i) => i !== blockIdx);
                              setPrompt(updated.join('\n\n'));
                              const focusIdx = Math.max(0, blockIdx - 1);
                              setExpandedPromptIdx(focusIdx);
                              requestAnimationFrame(() => {
                                const stack = document.querySelector('[data-prompt-stack]');
                                const rows = stack?.querySelectorAll<HTMLTextAreaElement>('textarea');
                                const target = rows?.[focusIdx];
                                if (target) {
                                  target.focus();
                                  target.setSelectionRange(target.value.length, target.value.length);
                                }
                              });
                            }
                          }}
                          disabled={submitting}
                          style={{
                            display: "block", width: "100%",
                            background: "transparent", border: "none", outline: "none",
                            color: "transparent",
                            caretColor: "#2DD4BF",
                            fontSize: "13.5px",
                            fontFamily: promptTextMode !== "text" ? "monospace" : "inherit",
                            lineHeight: "22px",
                            letterSpacing: promptTextMode !== "text" ? "normal" : "-0.01em",
                            padding: 0, resize: "none",
                            ...(isExpanded
                              ? { fieldSizing: "content", maxHeight: "330px", overflowY: "auto", scrollbarWidth: "none" }
                              : { height: "22px", maxHeight: "22px", overflowY: "hidden", whiteSpace: "nowrap" }
                            ),
                          } as React.CSSProperties}
                        />
                        {promptTextMode !== "text" ? (
                          <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
                            <div
                              data-block-overlay=""
                              style={{
                                fontSize: "13.5px", fontFamily: "monospace", lineHeight: "22px",
                                whiteSpace: isExpanded ? "pre-wrap" : "nowrap",
                                wordBreak: "break-word",
                              }}
                            >
                              {promptTextMode === "yaml"
                                ? syntaxHighlightYaml(block, taggedImages, (tag, rect) => setChipPreview({ tag, rect }), () => setChipPreview(null), tag => { const stack = document.querySelector('[data-prompt-stack]'); const ta = stack?.querySelectorAll<HTMLTextAreaElement>('textarea')[blockIdx]; if (!ta) return; activeBlockRef.current = ta; activeBlockIdxRef.current = blockIdx; const pos = block.indexOf(`@${tag.label}`); ta.focus(); ta.setSelectionRange(pos >= 0 ? pos + tag.label.length + 1 : block.length, pos >= 0 ? pos + tag.label.length + 1 : block.length); })
                                : syntaxHighlightJson(block, taggedImages, (tag, rect) => setChipPreview({ tag, rect }), () => setChipPreview(null), tag => { const stack = document.querySelector('[data-prompt-stack]'); const ta = stack?.querySelectorAll<HTMLTextAreaElement>('textarea')[blockIdx]; if (!ta) return; activeBlockRef.current = ta; activeBlockIdxRef.current = blockIdx; const pos = block.indexOf(`@${tag.label}`); ta.focus(); ta.setSelectionRange(pos >= 0 ? pos + tag.label.length + 1 : block.length, pos >= 0 ? pos + tag.label.length + 1 : block.length); })}
                            </div>
                          </div>
                        ) : (
                          <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
                            <div
                              data-block-text-overlay=""
                              style={{
                                fontSize: "13.5px", fontFamily: "inherit", lineHeight: "22px",
                                letterSpacing: "-0.01em",
                                whiteSpace: isExpanded ? "pre-wrap" : "nowrap",
                                wordBreak: "break-word",
                                willChange: "transform",
                              }}
                            >
                              {renderGalleryMentions(
                                block,
                                taggedImages,
                                (tag, rect) => setChipPreview({ tag, rect }),
                                () => setChipPreview(null),
                                tag => {
                                  const stack = document.querySelector('[data-prompt-stack]');
                                  const ta = stack?.querySelectorAll<HTMLTextAreaElement>('textarea')[blockIdx];
                                  if (!ta) return;
                                  activeBlockRef.current = ta;
                                  activeBlockIdxRef.current = blockIdx;
                                  const pos = block.indexOf(`@${tag.label}`);
                                  ta.focus();
                                  ta.setSelectionRange(pos >= 0 ? pos + tag.label.length + 1 : block.length, pos >= 0 ? pos + tag.label.length + 1 : block.length);
                                },
                              )}
                            </div>
                          </div>
                        )}
                        </div>
                        {isNonEmpty && promptMaxLength !== null && (
                          <span style={{
                            fontSize: "10px", fontWeight: 600,
                            color: block.length > promptMaxLength ? "#f87171" : "rgba(255,255,255,0.25)",
                            fontFamily: "monospace", lineHeight: "22px",
                            fontVariantNumeric: "tabular-nums",
                            ...(isExpanded
                              ? { position: "absolute", bottom: "6px", right: "24px" }
                              : { flexShrink: 0 }
                            ),
                          } as React.CSSProperties}>
                            {block.length}/{promptMaxLength}
                          </span>
                        )}
                        {blocks.length > 1 && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              const updated = blocks.filter((_, i) => i !== blockIdx);
                              setPrompt(updated.join('\n\n'));
                              setExpandedPromptIdx(prev => {
                                if (prev === null) return null;
                                if (prev === blockIdx) return null;
                                return prev > blockIdx ? prev - 1 : prev;
                              });
                            }}
                            disabled={submitting}
                            style={{
                              position: "absolute", top: "50%", right: "5px",
                              transform: "translateY(-50%)",
                              width: "16px", height: "16px",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              background: "none", border: "none", padding: 0,
                              color: "rgba(255,255,255,0.3)",
                              cursor: submitting ? "not-allowed" : "pointer",
                              borderRadius: "4px",
                              fontSize: "12px", lineHeight: 1,
                              transition: "color 120ms",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.75)")}
                            onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Bottom row: controls + generate button — always stays at the bottom, never moves on expand */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "12px", marginTop: promptExpanded ? "auto" : "4px" }}>
              {/* Controls group */}
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap" }}>
                {/* Model picker */}
                <CustomDropdown
                  value={modelId}
                  onChange={setModelId}
                  disabled={submitting}
                  options={models.map(m => ({
                    value: m.id,
                    label: m.name,
                    group: ("provider" in m ? (m as { provider: string }).provider : undefined),
                    providerIcon: "provider" in m ? <ProviderIcon provider={(m as { provider: string }).provider} /> : undefined,
                  }))}
                  showChevron
                />

                {/* Quality */}
                {supportsQ && (
                  <CustomDropdown
                    value={quality}
                    onChange={setQuality}
                    disabled={submitting}
                    options={qualityOpts.map(q => ({ value: q, label: q.toUpperCase() }))}
                    icon={<DiamondIcon />}
                  />
                )}

                {/* Azure Resolution (gpt-image-2 + Azure provider only) */}
                {azureResolutionOpts.length > 0 && (
                  <CustomDropdown
                    value={azureResolution}
                    onChange={setAzureResolution}
                    disabled={submitting}
                    options={azureResolutionOpts.map(r => ({ value: r, label: r.toUpperCase() }))}
                    icon={<DiamondIcon />}
                  />
                )}

                {/* Aspect ratio */}
                {ratios.length > 0 && (
                  <CustomDropdown
                    value={aspectRatio}
                    onChange={setAspectRatio}
                    disabled={submitting}
                    options={ratios.map(r => ({ value: r, label: r, preview: <RatioPreview ratio={r} /> }))}
                    icon={<RatioTriggerPreview ratio={aspectRatio} />}
                  />
                )}

                {/* Duration (video) — slider pill */}
                {isVideo && durations.length > 0 && (
                  <button
                    ref={durPillRef}
                    onClick={() => durPickerOpen ? closeDurPicker() : openDurPicker()}
                    disabled={submitting}
                    style={{
                      display: "flex", alignItems: "center", gap: "5px",
                      height: "36px", padding: "0 11px",
                      borderRadius: "8px",
                      border: durPickerOpen ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(255,255,255,0.1)",
                      background: durPickerOpen ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)",
                      color: "#fff", fontSize: "13px", fontFamily: "inherit",
                      cursor: submitting ? "not-allowed" : "pointer",
                      transition: "border-color 140ms, background 140ms",
                      flexShrink: 0,
                    }}>
                    <span style={{ fontVariantNumeric: "tabular-nums", display: "inline-block", width: "2ch", textAlign: "right" }}>{duration}</span><span>s</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2.5" strokeLinecap="round" style={{ transition: "transform 180ms cubic-bezier(0.16,1,0.3,1)", transform: durPickerOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                )}

                {/* Mode (video) */}
                {isVideo && vidModes.length > 0 && (
                  <CustomDropdown
                    value={mode}
                    onChange={setMode}
                    disabled={submitting}
                    options={vidModes.map(m => ({ value: m.value, label: m.label }))}
                  />
                )}

                {/* Resolution (video) */}
                {isVideo && (vidModel?.resolutions?.length ?? 0) > 0 && (
                  <CustomDropdown
                    value={resolution || vidModel!.defaultResolution!}
                    onChange={setResolution}
                    disabled={submitting}
                    options={vidModel!.resolutions!.map(r => ({ value: r, label: r }))}
                  />
                )}

                {/* Sound toggle (video) */}
                {isVideo && vidModel?.sound && (
                  <button
                    onClick={() => setSound(s => !s)}
                    disabled={submitting}
                    style={{
                      display: "flex", alignItems: "center", gap: "7px",
                      height: "36px", padding: "0 12px",
                      borderRadius: "8px",
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: sound ? "rgba(94,234,212,0.12)" : "rgba(255,255,255,0.05)",
                      color: sound ? "#5EEAD4" : "rgba(255,255,255,0.55)",
                      fontSize: "13px", fontFamily: "inherit",
                      cursor: submitting ? "not-allowed" : "pointer",
                      transition: "background 150ms, color 150ms, border-color 150ms",
                      flexShrink: 0,
                    }}>
                    {/* Toggle pill */}
                    <span style={{
                      width: "28px", height: "16px", borderRadius: "8px",
                      background: sound ? "#5EEAD4" : "rgba(255,255,255,0.18)",
                      position: "relative", flexShrink: 0,
                      transition: "background 150ms",
                    }}>
                      <span style={{
                        position: "absolute", top: "2px",
                        left: sound ? "14px" : "2px",
                        width: "12px", height: "12px", borderRadius: "50%",
                        background: sound ? "#1e1040" : "#ffffff",
                        transition: "left 150ms",
                      }} />
                    </span>
                    Sound
                  </button>
                )}

                {/* Veo mode toggle (frames vs references) */}
                {isVideo && (modelId === "veo3" || modelId === "veo3_fast") && (
                  <button
                    onClick={() => setVeoMode(m => m === "frames" ? "references" : "frames")}
                    disabled={submitting}
                    style={{
                      display: "flex", alignItems: "center", gap: "7px",
                      height: "36px", padding: "0 12px",
                      borderRadius: "8px",
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: veoMode === "references" ? "rgba(251,146,60,0.12)" : "rgba(255,255,255,0.05)",
                      color: veoMode === "references" ? "#fb923c" : "rgba(255,255,255,0.55)",
                      fontSize: "13px", fontFamily: "inherit",
                      cursor: submitting ? "not-allowed" : "pointer",
                      transition: "background 150ms, color 150ms, border-color 150ms",
                      flexShrink: 0,
                    }}>
                    <span style={{
                      width: "28px", height: "16px", borderRadius: "8px",
                      background: veoMode === "references" ? "#fb923c" : "rgba(255,255,255,0.18)",
                      position: "relative", flexShrink: 0,
                      transition: "background 150ms",
                    }}>
                      <span style={{
                        position: "absolute", top: "2px",
                        left: veoMode === "references" ? "14px" : "2px",
                        width: "12px", height: "12px", borderRadius: "50%",
                        background: veoMode === "references" ? "#401010" : "#ffffff",
                        transition: "left 150ms",
                      }} />
                    </span>
                    {veoMode === "references" ? "References" : "Frames"}
                  </button>
                )}

                {/* Seed (video, models that support it) */}
                {isVideo && vidModel?.supportsSeeds && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    height: "36px", padding: "0 11px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.05)",
                    flexShrink: 0,
                  }}>
                    <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", userSelect: "none", whiteSpace: "nowrap" }}>Seed</span>
                    <input
                      type="number"
                      min={0}
                      max={2147483647}
                      placeholder="—"
                      value={seed ?? 0}
                      onChange={(e) => setSeed(e.target.value === "" ? 0 : Math.max(0, Math.min(2147483647, parseInt(e.target.value, 10))))}
                      disabled={submitting}
                      className="seed-input"
                      style={{
                        width: "72px", background: "transparent", border: "none", outline: "none",
                        color: "#fff", fontSize: "12px", fontFamily: "inherit",
                        textAlign: "right", fontVariantNumeric: "tabular-nums",
                        cursor: submitting ? "not-allowed" : "text",
                        MozAppearance: "textfield", appearance: "textfield",
                      }}
                    />
                  </div>
                )}

                {/* Count stepper (image only, hidden in multi-prompt mode) */}
                {!isVideo && !multiPromptMode && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    height: "36px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.05)",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}>
                    <button
                      onClick={() => setCount(c => Math.max(1, c - 1))}
                      disabled={submitting || count <= 1}
                      style={{
                        width: "34px", height: "100%", border: "none", background: "transparent",
                        color: count <= 1 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.55)",
                        cursor: submitting || count <= 1 ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "16px", fontFamily: "inherit", transition: "color 140ms",
                      }}
                    >−</button>
                    <span style={{
                      fontSize: "12.5px", color: "#ffffff",
                      minWidth: "30px", textAlign: "center",
                      fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em",
                    }}>
                      {count}/4
                    </span>
                    <button
                      onClick={() => setCount(c => Math.min(4, c + 1))}
                      disabled={submitting || count >= 4}
                      style={{
                        width: "34px", height: "100%", border: "none", background: "transparent",
                        color: count >= 4 ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.55)",
                        cursor: submitting || count >= 4 ? "not-allowed" : "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "16px", fontFamily: "inherit", transition: "color 140ms",
                      }}
                    >+</button>
                  </div>
                )}

                {/* Multi-prompt toggle */}
                <button
                  onClick={() => {
                    setMultiPromptMode(m => {
                      if (m) {
                        // switching OFF — resize the single textarea once it's visible again
                        requestAnimationFrame(() => {
                          if (inputRef.current) resizeTextarea(inputRef.current);
                        });
                      }
                      return !m;
                    });
                    setExpandedPromptIdx(null);
                  }}
                  disabled={submitting}
                  style={{
                    display: "flex", alignItems: "center", gap: "7px",
                    height: "36px", padding: "0 12px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: multiPromptMode ? "rgba(45,212,191,0.12)" : "rgba(255,255,255,0.05)",
                    color: multiPromptMode ? "#2DD4BF" : "rgba(255,255,255,0.55)",
                    fontSize: "13px", fontFamily: "inherit",
                    cursor: submitting ? "not-allowed" : "pointer",
                    transition: "background 150ms, color 150ms",
                    flexShrink: 0,
                  }}>
                  <span style={{
                    width: "28px", height: "16px", borderRadius: "8px",
                    background: multiPromptMode ? "#2DD4BF" : "rgba(255,255,255,0.18)",
                    position: "relative", flexShrink: 0,
                    transition: "background 150ms",
                  }}>
                    <span style={{
                      position: "absolute", top: "2px",
                      left: multiPromptMode ? "14px" : "2px",
                      width: "12px", height: "12px", borderRadius: "50%",
                      background: multiPromptMode ? "#0B3B38" : "#ffffff",
                      transition: "left 150ms",
                    }} />
                  </span>
                  Multi
                </button>

                {/* Text / JSON / YAML mode toggle */}
                <button
                  onClick={() => {
                    if (promptTextMode !== "text") {
                      setPromptTextMode("text");
                    } else {
                      // Auto-detect format
                      try {
                        const formatted = JSON.stringify(JSON.parse(prompt), null, 2);
                        setPrompt(formatted);
                        requestAnimationFrame(() => { if (inputRef.current) resizeTextarea(inputRef.current); });
                        setPromptTextMode("json");
                      } catch {
                        // Not JSON — check for YAML patterns
                        const looksLikeYaml = /^(\s*[\w\-./]+\s*:|---|\s*-\s)/m.test(prompt);
                        setPromptTextMode(looksLikeYaml ? "yaml" : "json");
                      }
                    }
                  }}
                  disabled={submitting}
                  style={{
                    display: "flex", alignItems: "center", gap: "7px",
                    height: "36px", padding: "0 12px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: promptTextMode !== "text" ? "rgba(45,212,191,0.12)" : "rgba(255,255,255,0.05)",
                    color: promptTextMode !== "text" ? "#2DD4BF" : "rgba(255,255,255,0.55)",
                    fontSize: "13px", fontFamily: "inherit",
                    cursor: submitting ? "not-allowed" : "pointer",
                    transition: "background 150ms, color 150ms, border-color 150ms",
                    flexShrink: 0,
                  }}>
                  <span style={{
                    width: "28px", height: "16px", borderRadius: "8px",
                    background: promptTextMode !== "text" ? "#2DD4BF" : "rgba(255,255,255,0.18)",
                    position: "relative", flexShrink: 0,
                    transition: "background 150ms",
                  }}>
                    <span style={{
                      position: "absolute", top: "2px",
                      left: promptTextMode !== "text" ? "14px" : "2px",
                      width: "12px", height: "12px", borderRadius: "50%",
                      background: promptTextMode !== "text" ? "#0B3B38" : "#ffffff",
                      transition: "left 150ms",
                    }} />
                  </span>
                  JSON/YAML
                </button>
              </div>{/* end controls group */}

              {/* Character count + Generate button */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0 }}>
                {promptMaxLength !== null && !multiPromptMode && (
                  <div
                    aria-hidden
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                      color: promptOverLimit ? "#f87171" : "rgba(255,255,255,0.3)",
                      pointerEvents: "none",
                      userSelect: "none",
                    }}
                  >
                    {prompt.length.toLocaleString()}/{promptMaxLength.toLocaleString()}
                  </div>
                )}

                <Button
                  onClick={generate}
                  disabled={!canGenerate}
                  variant="outline"
                  size="sm"
                  className="border-none bg-[rgba(45,212,191,0.25)] text-[rgba(45,212,191,0.9)] hover:bg-[rgba(45,212,191,0.38)] hover:text-[rgba(45,212,191,0.9)] disabled:bg-[rgba(45,212,191,0.1)] disabled:text-[rgba(45,212,191,0.3)]"
                >
                  {submitting ? (
                    <span style={{
                      width: "11px", height: "11px", borderRadius: "50%",
                      border: "2px solid rgba(45,212,191,0.25)", borderTopColor: "rgba(45,212,191,0.9)",
                      display: "inline-block", animation: "spin 0.75s linear infinite",
                    }} />
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon="inline-start">
                      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
                      <path d="m21.854 2.147-10.94 10.939" />
                    </svg>
                  )}
                  {!submitting && (
                    <KbdGroup data-icon="inline-end" className="gap-0.5">
                      <Kbd>⌘</Kbd>
                      <Kbd>↵</Kbd>
                    </KbdGroup>
                  )}
                </Button>
              </div>
            </div>{/* end bottom row */}
          </div>
        </div>
      </div>

      <style>{GALLERY_CSS}</style>

      {/* ── @ image picker menu ── */}
      {atMenuOpen && promptBarRef.current && createPortal(
        <div
          data-at-menu=""
          style={{
            position: "fixed",
            left: promptBarRef.current.getBoundingClientRect().left,
            bottom: Math.max(8, window.innerHeight - promptBarRef.current.getBoundingClientRect().top + 6),
            width: promptBarRef.current.getBoundingClientRect().width,
            maxHeight: `${promptBarRef.current.getBoundingClientRect().top - 16}px`,
            background: "#0E1012",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "14px",
            boxShadow: "0 8px 48px rgba(0,0,0,0.75), 0 2px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            zIndex: 9999,
            animation: "dropIn 130ms cubic-bezier(0.16,1,0.3,1)",
          }}
          onMouseDown={e => e.preventDefault()}
        >
          <div style={{ padding: "6px 12px 4px", borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
            <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500 }}>
              {isVideo ? "Reference assets" : "Gallery images"}
            </span>
          </div>
          <div style={{ maxHeight: "280px", overflowY: "auto", padding: "4px", flex: 1, minHeight: 0 }}>
            {filteredMentions.map((ref, idx) => (
              <button
                key={ref.id}
                onClick={() => insertMention(ref)}
                onMouseEnter={() => setMentionSelIdx(idx)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: "9px",
                  border: "none",
                  background: idx === mentionSelIdx ? "rgba(119,229,68,0.07)" : "transparent",
                  color: idx === mentionSelIdx ? "#2DD4BF" : "rgba(255,255,255,0.65)",
                  fontSize: "13px",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 80ms",
                  letterSpacing: "-0.01em",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbSrc(ref.objectUrl)}
                  alt=""
                  style={{ width: "30px", height: "30px", borderRadius: "6px", objectFit: "cover", flexShrink: 0, background: "#1a1c1f" }}
                />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {(ref as any).role} ({(ref as any).label})
                </span>

                {idx === mentionSelIdx && (
                  <span style={{ marginLeft: "auto", fontSize: "10px", color: "rgba(255,255,255,0.2)", flexShrink: 0 }}>↵</span>
                )}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}

      {/* ── Chip hover preview ── */}
      {chipPreview && createPortal(
        /* Outer: positioning only — no animation so transform stays stable */
        <div
          style={{
            position: "fixed",
            left: Math.max(110, Math.min(
              chipPreview.rect.left + chipPreview.rect.width / 2,
              window.innerWidth - 110,
            )),
            ...(chipPreview.rect.top > 190
              ? { bottom: window.innerHeight - chipPreview.rect.top + 8 }
              : { top: chipPreview.rect.bottom + 8 }),
            transform: "translateX(-50%)",
            zIndex: 99999,
            pointerEvents: "none",
          }}
        >
          {/* Inner: animation + scroll so popup never overflows viewport */}
          <div
            style={{
              borderRadius: "10px",
              overflowY: "auto",
              overflowX: "hidden",
              boxShadow: "0 8px 32px rgba(0,0,0,0.65), 0 2px 8px rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.08)",
              animation: "dropIn 140ms cubic-bezier(0.16,1,0.3,1)",
              maxHeight: chipPreview.rect.top > 190
                ? `${Math.min(200, chipPreview.rect.top - 16)}px`
                : `${Math.min(200, window.innerHeight - chipPreview.rect.bottom - 16)}px`,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbSrc(chipPreview.tag.url, 256)}
              alt=""
              style={{ display: "block", maxWidth: "200px", maxHeight: "160px", width: "auto", height: "auto", objectFit: "contain" }}
            />
          </div>
        </div>,
        document.body,
      )}

      {lightboxItem && (() => {
        const idx = orderedGalleryItems.findIndex(i => i.id === lightboxItem.id);
        return (
          <Lightbox
            item={lightboxItem}
            onClose={() => setLightboxItem(null)}
            onCopyPrompt={handleCopyPrompt}
            onPrev={idx > 0 ? () => setLightboxItem(orderedGalleryItems[idx - 1]) : undefined}
            onNext={idx < orderedGalleryItems.length - 1 ? () => setLightboxItem(orderedGalleryItems[idx + 1]) : undefined}
          />
        );
      })()}

      {/* Ref media preview modal */}
      {refPreview && (
        <div
          data-prompt-overlay=""
          onClick={() => setRefPreview(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 99000,
            background: "rgba(0,0,0,0.82)",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "fadeIn 150ms ease",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: "relative",
              maxWidth: "90vw", maxHeight: "90vh",
              borderRadius: "12px", overflow: "hidden",
              boxShadow: "0 24px 80px rgba(0,0,0,0.8)",
              animation: "dropIn 160ms cubic-bezier(0.16,1,0.3,1)",
            }}
          >
            {refPreview.mediaKind === "video" ? (
              <video
                src={refPreview.url}
                controls
                autoPlay
                style={{ display: "block", maxWidth: "90vw", maxHeight: "90vh" }}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={refPreview.url}
                alt=""
                style={{ display: "block", maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain" }}
              />
            )}
            <button
              onClick={() => setRefPreview(null)}
              style={{
                position: "absolute", top: "10px", right: "10px",
                width: "32px", height: "32px", borderRadius: "50%",
                background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.15)",
                color: "rgba(255,255,255,0.9)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: 0,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Duration picker popover — portal so it escapes overflow/transform ancestors */}
      {(durPickerOpen || durPickerClosing) && durPickerPos && createPortal(
        <div
          onMouseDown={e => e.stopPropagation()}
          className={durPickerClosing ? "dur-picker-out" : "dur-picker-in"}
          style={{
            position: "fixed",
            left: durPickerPos.left,
            bottom: durPickerPos.bottom,
            zIndex: 9200,
            background: "rgba(18,20,22,0.98)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "12px",
            padding: "12px 14px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
            minWidth: "220px",
            transformOrigin: "bottom left",
          }}>
          <p style={{ margin: "0 0 10px", fontSize: "12px", fontWeight: 600, color: "#fff" }}>Duration</p>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "8px", background: "#141C28" }}>
            <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", fontVariantNumeric: "tabular-nums", minWidth: "24px" }}>{duration}s</span>
            <div style={{ width: "1px", height: "14px", background: "#2A2A2A", flexShrink: 0 }} />
            <input
              type="range"
              min={0}
              max={durations.length - 1}
              step={1}
              value={Math.max(0, durations.indexOf(duration))}
              onChange={e => setDuration(durations[parseInt(e.target.value)])}
              className="dur-slider"
              style={{ flex: 1 }}
            />
          </div>
        </div>,
        document.body,
      )}

      <MediaPickerModal
        open={pickerOpen}
        mediaKind={pickerUploadKind}
        onClose={() => setPickerOpen(false)}
        onPickUrl={handlePickerSelect}
        onDeselect={handlePickerDeselect}
        onUpload={handlePickerUpload}
        anchorRef={promptBarRef}
        selectedUrls={
          pickerTarget === "refImage" ? refImages.filter(r => r.cdnUrl).map(r => r.cdnUrl!) :
          pickerTarget === "resource" ? vidResources.filter(r => r.cdnUrl).map(r => r.cdnUrl!) :
          pickerTarget === "referenceVideo" ? vidRefVideos.filter(r => r.cdnUrl).map(r => r.cdnUrl!) :
          undefined
        }
        maxCount={
          pickerTarget === "refImage" ? maxImgs :
          pickerTarget === "resource" ? (vidModel?.maxResources ?? 3) :
          pickerTarget === "referenceVideo" ? (vidModel?.maxReferenceVideos ?? 3) :
          undefined
        }
      />

      <ElementPickerModal
        open={elementPickerOpen}
        attached={vidElements}
        onClose={() => setElementPickerOpen(false)}
        onAttach={el => {
          setVidElements(prev => prev.some(e => e.id === el.id) ? prev : [...prev, el]);
          setElementPickerOpen(false);
        }}
      />

      <DownloadToast downloads={downloads} onClear={() => setDownloads([])} />

      {refError && (
        <div style={{
          position: "fixed",
          top: "64px",
          right: "16px",
          zIndex: 9600,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "10px 14px",
          borderRadius: "12px",
          background: "rgba(16,18,20,0.97)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(248,113,113,0.25)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
          fontSize: "13px",
          color: "#f87171",
          fontFamily: "inherit",
          letterSpacing: "-0.01em",
          animation: "dropIn 160ms cubic-bezier(0.16,1,0.3,1)",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
          </svg>
          {refError}
        </div>
      )}

      <QuickAssist />
    </div>
  );
}

export default function GalleryPage() {
  return (
    <Suspense fallback={<div style={{ flex: 1, background: "#0B0E14" }} />}>
      <GalleryInner />
    </Suspense>
  );
}

// ── CustomDropdown ────────────────────────────────────────────────────────────

interface DropOption {
  value: string;
  label: string;
  group?: string;
  preview?: React.ReactNode;
  providerIcon?: React.ReactNode;
}

// ── Element picker modal ─────────────────────────────────────────────────────

function ElementPickerModal({
  open,
  attached,
  onClose,
  onAttach,
}: {
  open: boolean;
  attached: KlingElement[];
  onClose: () => void;
  onAttach: (el: KlingElement) => void;
}) {
  const [view, setView] = useState<"browse" | "create">("browse");
  const [elements, setElements] = useState<KlingElement[]>([]);

  // Create form state
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createImages, setCreateImages] = useState<{ id: string; objectUrl: string; cdnUrl: string | null; uploading: boolean; error: boolean }[]>([]);
  const [creating, setCreating] = useState(false);
  const createFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setView("browse");
    setElements(loadKlingElements());
    setCreateName("");
    setCreateDesc("");
    setCreateImages([]);
    setCreating(false);
  }, [open]);

  if (!open) return null;

  const handleDeleteElement = (id: string) => {
    const updated = elements.filter(e => e.id !== id);
    setElements(updated);
    saveKlingElements(updated);
  };

  const handleCreateImages = async (files: FileList) => {
    const remaining = 4 - createImages.length;
    const toAdd = Array.from(files).slice(0, remaining).filter(
      f => (f.type === "image/jpeg" || f.type === "image/png") && f.size <= 10 * 1024 * 1024
    );
    if (!toAdd.length) return;
    const newEntries = toAdd.map(f => ({
      id: randomUUID(),
      objectUrl: URL.createObjectURL(f),
      cdnUrl: null as string | null,
      uploading: true,
      error: false,
    }));
    setCreateImages(prev => [...prev, ...newEntries]);
    const token = await getToken();
    await Promise.all(toAdd.map(async (file, i) => {
      const entry = newEntries[i];
      try {
        const res = await fetch("/api/upload-asset", {
          method: "POST",
          headers: { "Content-Type": file.type, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: file,
        });
        const data = await res.json() as { cdnUrl?: string; error?: string };
        if (!res.ok || !data.cdnUrl) throw new Error(data.error ?? "Upload failed");
        setCreateImages(prev => prev.map(e => e.id === entry.id ? { ...e, cdnUrl: data.cdnUrl!, uploading: false } : e));
      } catch {
        setCreateImages(prev => prev.map(e => e.id === entry.id ? { ...e, uploading: false, error: true } : e));
      }
    }));
  };

  const readyImages = createImages.filter(e => e.cdnUrl && !e.error);
  const canCreate = createName.trim().length > 0
    && readyImages.length >= 2
    && !createImages.some(e => e.uploading)
    && !creating;

  const handleCreate = () => {
    if (!canCreate) return;
    setCreating(true);
    const newEl: KlingElement = {
      id: randomUUID(),
      name: createName.trim(),
      description: createDesc.trim(),
      imageUrls: readyImages.map(e => e.cdnUrl!),
    };
    const updated = [...loadKlingElements(), newEl];
    saveKlingElements(updated);
    createImages.forEach(e => URL.revokeObjectURL(e.objectUrl));
    onAttach(newEl);
  };

  return createPortal(
    <div data-prompt-overlay="" style={{ position: "fixed", inset: 0, zIndex: 9100, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "absolute", inset: 0, pointerEvents: "auto" }} />
      <div data-element-picker-modal="" style={{
        position: "relative",
        width: "min(520px, calc(100vw - 32px))",
        maxHeight: "80vh",
        background: "rgba(14,16,18,0.98)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: "18px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 32px 80px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.04)",
        pointerEvents: "auto",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 18px 14px", display: "flex", alignItems: "center", gap: "10px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
          {view === "create" && (
            <button onClick={() => setView("browse")} style={{ width: "28px", height: "28px", borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 120ms" }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.13)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          )}
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#fff", letterSpacing: "-0.01em" }}>
            {view === "browse" ? "Elements" : "New Element"}
          </span>
          <button onClick={onClose} style={{ marginLeft: "auto", width: "28px", height: "28px", borderRadius: "50%", background: "rgba(255,255,255,0.07)", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 120ms" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.13)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {view === "browse" ? (
          /* ── Browse view ── */
          <div className="picker-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 18px 18px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
              {/* Create new card */}
              <button onClick={() => setView("create")} style={{
                aspectRatio: "1", borderRadius: "10px", border: "1.5px dashed rgba(255,255,255,0.16)",
                background: "rgba(255,255,255,0.025)", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px",
                color: "rgba(255,255,255,0.5)", transition: "background 150ms, border-color 150ms, color 150ms", padding: 0,
              }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.055)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}>
                <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "rgba(255,255,255,0.09)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                </div>
                <span style={{ fontSize: "11px", fontWeight: 500 }}>New element</span>
              </button>

              {/* Element cards */}
              {elements.map(el => {
                const isAttached = attached.some(a => a.id === el.id);
                const atMax = attached.length >= 3 && !isAttached;
                return (
                  <div key={el.id} style={{ position: "relative", aspectRatio: "1" }}>
                    <button
                      onClick={() => { if (!isAttached && !atMax) onAttach(el); }}
                      disabled={isAttached || atMax}
                      style={{
                        width: "100%", height: "100%", borderRadius: "10px", overflow: "hidden",
                        border: isAttached ? "2px solid #77e544" : "2px solid transparent",
                        background: "#1a1c1f", cursor: isAttached || atMax ? "default" : "pointer",
                        padding: 0, display: "block", position: "relative",
                        transition: "border-color 110ms, opacity 110ms",
                        opacity: atMax ? 0.4 : 1,
                      }}
                      onMouseEnter={e => { if (!isAttached && !atMax) e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)"; }}
                      onMouseLeave={e => { if (!isAttached) e.currentTarget.style.borderColor = "transparent"; }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={el.imageUrls[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      {el.imageUrls.length > 1 && (
                        <div style={{ position: "absolute", top: "5px", left: "5px", background: "rgba(0,0,0,0.65)", borderRadius: "4px", padding: "1px 5px", fontSize: "9px", fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>
                          {el.imageUrls.length}
                        </div>
                      )}
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "14px 6px 5px", background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)" }}>
                        <span style={{ fontSize: "10px", fontWeight: 600, color: "rgba(255,255,255,0.9)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>{el.name}</span>
                      </div>
                      {isAttached && (
                        <div style={{ position: "absolute", top: "5px", right: "5px", width: "18px", height: "18px", borderRadius: "50%", background: "#77e544", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        </div>
                      )}
                    </button>
                    {/* Delete button */}
                    <button onClick={e => { e.stopPropagation(); handleDeleteElement(el.id); }} style={{
                      position: "absolute", bottom: "5px", right: "5px", width: "20px", height: "20px",
                      borderRadius: "50%", background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.15)",
                      color: "rgba(255,255,255,0.7)", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "background 120ms, color 120ms",
                      zIndex: 2,
                    }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(220,40,40,0.85)"; e.currentTarget.style.color = "#fff"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,0,0,0.7)"; e.currentTarget.style.color = "rgba(255,255,255,0.7)"; }}>
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                );
              })}

              {elements.length === 0 && (
                <div style={{ gridColumn: "1 / -1", padding: "32px 0", textAlign: "center", color: "rgba(255,255,255,0.22)", fontSize: "13px" }}>
                  No elements yet — create your first one
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── Create view ── */
          <div className="picker-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 18px 18px", display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Images */}
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.4)", marginBottom: "8px" }}>Images (2–4 · JPG/PNG · max 10 MB each)</div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" as const }}>
                {createImages.map((img, i) => (
                  <div key={img.id} style={{ position: "relative", width: "72px", height: "72px", borderRadius: "8px", overflow: "hidden", border: img.error ? "1px solid rgba(248,113,113,0.4)" : "1px solid rgba(255,255,255,0.12)", background: "#1a1c1f", flexShrink: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.objectUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    {img.uploading && (
                      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ width: "14px", height: "14px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.8)", display: "inline-block", animation: "spin 0.75s linear infinite" }} />
                      </div>
                    )}
                    {img.error && (
                      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                      </div>
                    )}
                    <button onClick={() => setCreateImages(prev => { URL.revokeObjectURL(img.objectUrl); return prev.filter((_, j) => j !== i); })} style={{
                      position: "absolute", top: "3px", right: "3px", width: "16px", height: "16px",
                      borderRadius: "50%", background: "rgba(0,0,0,0.7)", border: "none",
                      color: "rgba(255,255,255,0.85)", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
                    }}>
                      <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                ))}
                {createImages.length < 4 && (
                  <button onClick={() => { if (DEMO_MODE) { useWorkflowStore.getState().setAuthModalOpen(true); return; } createFileRef.current?.click(); }} style={{
                    width: "72px", height: "72px", borderRadius: "8px", flexShrink: 0,
                    border: "1.5px dashed rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.025)",
                    cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px",
                    color: "rgba(255,255,255,0.4)", transition: "background 140ms, border-color 140ms, color 140ms",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.055)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; e.currentTarget.style.color = "rgba(255,255,255,0.8)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                    <span style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.04em" }}>ADD</span>
                  </button>
                )}
              </div>
              <input ref={createFileRef} type="file" accept="image/jpeg,image/png" multiple style={{ display: "none" }}
                onChange={e => { if (e.target.files) { handleCreateImages(e.target.files); e.target.value = ""; } }} />
            </div>

            {/* Name */}
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.4)", marginBottom: "8px" }}>Name</div>
              <input
                value={createName}
                onChange={e => setCreateName(e.target.value)}
                placeholder="Element name"
                maxLength={50}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: "8px",
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  color: "#fff", fontSize: "13.5px", fontFamily: "inherit", outline: "none",
                  boxSizing: "border-box" as const,
                }}
              />
            </div>

            {/* Description */}
            <div>
              <div style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" as const, color: "rgba(255,255,255,0.4)", marginBottom: "8px" }}>Description</div>
              <textarea
                value={createDesc}
                onChange={e => setCreateDesc(e.target.value)}
                placeholder="Describe this element…"
                rows={3}
                maxLength={500}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: "8px",
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  color: "#fff", fontSize: "13.5px", fontFamily: "inherit", outline: "none",
                  resize: "none", boxSizing: "border-box" as const,
                }}
              />
            </div>

            {/* Create button */}
            <button
              onClick={handleCreate}
              disabled={!canCreate}
              style={{
                padding: "10px 24px", borderRadius: "10px", border: "none",
                background: canCreate ? "#77e544" : "rgba(255,255,255,0.08)",
                color: canCreate ? "#000" : "rgba(255,255,255,0.3)",
                fontSize: "13.5px", fontWeight: 600, fontFamily: "inherit",
                cursor: canCreate ? "pointer" : "not-allowed", transition: "background 150ms, color 150ms",
                alignSelf: "flex-start" as const,
              }}>
              {creating ? "Creating…" : "Create element"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function CustomDropdown({
  value,
  onChange,
  disabled,
  options,
  icon,
  showChevron = true,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  options: DropOption[];
  icon?: React.ReactNode;
  showChevron?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, bottom: 0, minW: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const selectedOpt = options.find(o => o.value === value);
  const label = selectedOpt?.label ?? value;
  const triggerIcon = selectedOpt?.providerIcon ?? icon;

  const openDrop = () => {
    if (disabled || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ left: r.left, bottom: window.innerHeight - r.top + 6, minW: r.width });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !dropRef.current?.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Group options by group field
  const groups = options.reduce<Record<string, DropOption[]>>((acc, o) => {
    const g = o.group ?? "";
    (acc[g] ??= []).push(o);
    return acc;
  }, {});
  const groupKeys = Object.keys(groups);
  const hasGroups = groupKeys.some(k => k !== "");

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => open ? setOpen(false) : openDrop()}
        disabled={disabled}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          height: "36px",
          padding: "0 12px",
          borderRadius: "8px",
          border: open
            ? "1px solid rgba(255,255,255,0.18)"
            : "1px solid rgba(255,255,255,0.1)",
          background: open
            ? "rgba(255,255,255,0.08)"
            : "rgba(255,255,255,0.05)",
          flexShrink: 0,
          cursor: disabled ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          transition: "border-color 140ms, background 140ms",
          userSelect: "none",
        }}
        onMouseEnter={e => {
          if (!disabled && !open) {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)";
            e.currentTarget.style.background = "rgba(255,255,255,0.07)";
          }
        }}
        onMouseLeave={e => {
          if (!open) {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
            e.currentTarget.style.background = "rgba(255,255,255,0.05)";
          }
        }}
      >
        {triggerIcon && (
          <span style={{ display: "flex", alignItems: "center", color: selectedOpt?.providerIcon ? "#2DD4BF" : "white", flexShrink: 0 }}>
            {triggerIcon}
          </span>
        )}
        <span style={{ fontSize: "13px", color: "#ffffff", whiteSpace: "nowrap", letterSpacing: "-0.01em" }}>
          {label}
        </span>
        {showChevron && (
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none"
            stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" strokeLinecap="round"
            style={{ flexShrink: 0, transition: "transform 140ms", transform: open ? "rotate(180deg)" : "none" }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      {open && createPortal(
        <div
          ref={dropRef}
          data-custom-dropdown-portal=""
          style={{
            position: "fixed",
            left: pos.left,
            bottom: pos.bottom,
            minWidth: Math.max(pos.minW, 160),
            background: "#0E1012",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "14px",
            boxShadow: "0 8px 48px rgba(0,0,0,0.75), 0 2px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)",
            overflow: "hidden",
            zIndex: 9999,
            animation: "dropIn 130ms cubic-bezier(0.16,1,0.3,1)",
          }}
        >
          <div style={{ padding: "5px", maxHeight: "300px", overflowY: "auto" }}>
            {hasGroups ? (
              groupKeys.map((gk, gi) => (
                <div key={gk}>
                  {gi > 0 && (
                    <div style={{ height: "1px", background: "rgba(255,255,255,0.06)", margin: "4px 8px" }} />
                  )}
                  {gk && (
                    <div style={{
                      padding: "5px 10px 3px",
                      fontSize: "10px",
                      color: "rgba(255,255,255,0.22)",
                      textTransform: "uppercase",
                      letterSpacing: "0.09em",
                      fontWeight: 500,
                    }}>
                      {gk}
                    </div>
                  )}
                  {groups[gk].map(opt => (
                    <DropItem
                      key={opt.value}
                      label={opt.label}
                      active={opt.value === value}
                      onClick={() => { onChange(opt.value); setOpen(false); }}
                      preview={opt.preview}
                      providerIcon={opt.providerIcon}
                    />
                  ))}
                </div>
              ))
            ) : (
              options.map(opt => (
                <DropItem
                  key={opt.value}
                  label={opt.label}
                  active={opt.value === value}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  preview={opt.preview}
                  providerIcon={opt.providerIcon}
                />
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function DropItem({ label, active, onClick, preview, providerIcon }: { label: string; active: boolean; onClick: () => void; preview?: React.ReactNode; providerIcon?: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        width: "100%",
        padding: "7px 10px",
        borderRadius: "9px",
        border: "none",
        background: active
          ? "rgba(255,255,255,0.09)"
          : hovered ? "rgba(255,255,255,0.06)" : "transparent",
        color: active ? "#ffffff" : hovered ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.55)",
        fontSize: "13px",
        fontWeight: active ? 500 : 400,
        cursor: "pointer",
        textAlign: "left",
        transition: "background 100ms, color 100ms",
        fontFamily: "inherit",
        letterSpacing: "-0.01em",
        whiteSpace: "nowrap",
      }}
    >
      {providerIcon && (
        <span style={{ display: "flex", alignItems: "center", color: "#2DD4BF", flexShrink: 0, opacity: active ? 1 : 0.7 }}>
          {providerIcon}
        </span>
      )}
      {preview}
      {label}
    </button>
  );
}

function RatioPreview({ ratio }: { ratio: string }) {
  const [ws, hs] = ratio.split(":");
  const w = parseFloat(ws), h = parseFloat(hs);
  if (!w || !h) return null;
  const maxW = 36, maxH = 22;
  let rw = maxW, rh = (h / w) * maxW;
  if (rh > maxH) { rh = maxH; rw = (w / h) * maxH; }
  return (
    <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "44px", flexShrink: 0 }}>
      <span style={{
        display: "inline-block",
        width: `${Math.round(rw)}px`,
        height: `${Math.round(rh)}px`,
        border: "1.5px solid rgba(255,255,255,0.75)",
        borderRadius: "5px",
        flexShrink: 0,
      }} />
    </span>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ProviderIcon({ provider }: { provider: string }) {
  switch (provider) {
    case "OpenAI":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path fillRule="evenodd" clipRule="evenodd" d="M22.408 9.80741C22.9487 8.17778 22.7685 6.37037 21.8974 4.88889C20.5758 2.60741 17.9024 1.45185 15.2891 1.98519C14.1477 0.711111 12.4656 0 10.7234 0C8.0501 0 5.70717 1.68889 4.86612 4.17778C3.15398 4.53333 1.68214 5.57037 0.811051 7.08148C-0.510601 9.36296 -0.210226 12.2074 1.56199 14.163C1.02131 15.8222 1.23158 17.6 2.10267 19.0815C3.42432 21.363 6.09766 22.5481 8.71093 21.9852C9.88239 23.2593 11.5345 24 13.2766 24C15.95 24 18.2929 22.3111 19.134 19.8222C20.8461 19.4667 22.3179 18.4296 23.189 16.9185C24.5107 14.637 24.2103 11.763 22.408 9.80741ZM13.2766 22.4296C12.1953 22.4296 11.174 22.0741 10.363 21.3926C10.393 21.363 10.4831 21.3333 10.5132 21.3037L15.3492 18.5481C15.5895 18.4 15.7397 18.163 15.7397 17.8667V11.1407L17.7823 12.2963C17.8123 12.2963 17.8123 12.3259 17.8123 12.3556V17.9259C17.8423 20.4148 15.7998 22.4296 13.2766 22.4296ZM3.48439 18.3111C2.94372 17.3926 2.76349 16.3259 2.94372 15.2889C2.97375 15.3185 3.03383 15.3481 3.0939 15.3778L7.92995 18.1333C8.17025 18.2815 8.47063 18.2815 8.71093 18.1333L14.6283 14.7556V17.0963C14.6283 17.1259 14.6283 17.1556 14.5983 17.1556L9.70216 19.9407C7.53946 21.1852 4.74597 20.4444 3.48439 18.3111ZM2.22282 7.88148C2.76349 6.96296 3.60454 6.28148 4.59578 5.8963V11.5852C4.59578 11.8519 4.74597 12.1185 4.98627 12.2667L10.9037 15.6444L8.86111 16.8C8.83108 16.8 8.80104 16.8296 8.80104 16.8L3.90492 14.0148C1.68214 12.7704 0.961239 10.0148 2.22282 7.88148ZM19.0438 11.7333L13.1264 8.35556L15.169 7.2C15.199 7.2 15.2291 7.17037 15.2291 7.2L20.1252 9.98519C22.3179 11.2296 23.0388 13.9852 21.7773 16.1185C21.2366 17.037 20.3955 17.7185 19.4043 18.0741V12.4148C19.4343 12.1481 19.2841 11.8815 19.0438 11.7333ZM21.0564 8.71111C21.0263 8.68148 20.9662 8.65185 20.9062 8.62222L16.0701 5.86667C15.8298 5.71852 15.5294 5.71852 15.2891 5.86667L9.37175 9.24444V6.9037C9.37175 6.87407 9.37175 6.84444 9.40179 6.84444L14.2979 4.05926C16.4906 2.81481 19.2541 3.55556 20.5157 5.71852C21.0564 6.60741 21.2366 7.67407 21.0564 8.71111ZM8.26036 12.8593L6.21781 11.7037C6.18777 11.7037 6.18777 11.6741 6.18777 11.6444V6.07407C6.18777 3.58519 8.23032 1.57037 10.7535 1.57037C11.8348 1.57037 12.8561 1.92593 13.6671 2.60741C13.6371 2.63704 13.577 2.66667 13.5169 2.6963L8.68089 5.45185C8.44059 5.6 8.2904 5.83704 8.2904 6.13333V12.8593H8.26036ZM9.37175 10.4889L12.0151 8.97778L14.6584 10.4889V13.4815L12.0151 14.9926L9.37175 13.4815V10.4889Z" />
        </svg>
      );
    case "Google":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path d="M2.55464 6.25768C3.24798 4.87705 4.31161 3.71644 5.62666 2.90557C6.94171 2.0947 8.45636 1.66553 10.0013 1.66602C12.2471 1.66602 14.1338 2.49102 15.5763 3.83685L13.1871 6.22685C12.323 5.40102 11.2246 4.98018 10.0013 4.98018C7.83047 4.98018 5.99297 6.44685 5.3388 8.41602C5.17214 8.91602 5.07714 9.44935 5.07714 9.99935C5.07714 10.5493 5.17214 11.0827 5.3388 11.5827C5.9938 13.5527 7.83047 15.0185 10.0013 15.0185C11.1221 15.0185 12.0763 14.7227 12.823 14.2227C13.2558 13.9377 13.6264 13.5679 13.9123 13.1356C14.1982 12.7033 14.3935 12.2176 14.4863 11.7077H10.0013V8.48435H17.8496C17.948 9.02935 18.0013 9.59768 18.0013 10.1885C18.0013 12.7268 17.093 14.8635 15.5163 16.3135C14.138 17.5868 12.2513 18.3327 10.0013 18.3327C8.90683 18.3331 7.823 18.1179 6.81176 17.6992C5.80051 17.2806 4.88168 16.6668 4.10777 15.8929C3.33386 15.119 2.72005 14.2001 2.30141 13.1889C1.88278 12.1777 1.66753 11.0938 1.66797 9.99935C1.66797 8.65435 1.98964 7.38268 2.55464 6.25768Z" />
        </svg>
      );
    case "Seedream":
      return (
        <svg width="16" height="16" viewBox="0 0 14 14" fill="currentColor">
          <path d="M2.7601 10.635L0.466553 11.2084V1.04883L2.7601 1.62222V10.635Z" />
          <path d="M13.8448 11.2295L11.5469 11.8029V0.454102L13.8448 1.02324V11.2295Z" />
          <path d="M6.39853 10.9452L4.10498 11.5186V5.53418L6.39853 6.10752V10.9452Z" />
          <path d="M7.89722 4.64663L10.1952 4.07324V10.0577L7.89722 9.48433V4.64663Z" />
        </svg>
      );
    case "Z-AI":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path d="M19.9361 12.1411L17.6243 8.09523L17.3525 7.61735L18.5771 5.47657C18.6187 5.4023 18.6411 5.32158 18.6411 5.23763C18.6411 5.15367 18.6187 5.07295 18.5771 4.99868L17.215 2.61896C17.1735 2.5447 17.1127 2.48658 17.0424 2.4446C16.972 2.40262 16.8921 2.38002 16.8058 2.38002H11.6323L10.4077 0.236011C10.3245 0.0874804 10.1679 -0.00292969 9.9984 -0.00292969H7.27738C7.19425 -0.00292969 7.11111 0.0196728 7.04077 0.0616489C6.97042 0.103625 6.90967 0.161746 6.86811 0.236011L4.55316 4.28509L4.28138 4.75974H1.83213C1.749 4.75974 1.66587 4.78235 1.59552 4.82432C1.52518 4.8663 1.46443 4.92442 1.42286 4.99868L0.0639488 7.38164C0.0223821 7.4559 0 7.53663 0 7.62058C0 7.70453 0.0223821 7.78525 0.0639488 7.85952L2.65068 12.3833L1.42606 14.5273C1.38449 14.6015 1.36211 14.6823 1.36211 14.7662C1.36211 14.8502 1.38449 14.9309 1.42606 15.0051L2.78817 17.3849C2.82974 17.4591 2.89049 17.5173 2.96083 17.5592C3.03118 17.6012 3.11111 17.6238 3.19744 17.6238H8.36771L9.59233 19.7678C9.67546 19.9163 9.83214 20.0068 10.0016 20.0068H12.7226C12.8058 20.0068 12.8889 19.9842 12.9592 19.9422C13.0296 19.9002 13.0903 19.8421 13.1319 19.7678L15.7186 15.2441H18.1679C18.251 15.2441 18.3341 15.2215 18.4045 15.1795C18.4748 15.1375 18.5356 15.0794 18.5771 15.0051L19.9393 12.6254C19.9808 12.5512 20.0032 12.4704 20.0032 12.3865C20.0032 12.3025 19.9808 12.2218 19.9393 12.1475L19.9361 12.1411ZM7.27738 0.474952L8.63949 2.8579L7.27738 5.23763H18.1679L16.8058 7.61735H6.45883L4.82494 4.75974L7.27738 0.474952ZM8.09273 17.1395H3.19424L4.55636 14.7565H7.27738L1.83213 5.23763H4.55316L5.91527 7.61735L9.72662 14.2851L8.09273 17.1427V17.1395ZM16.8058 12.3768L15.4468 9.99707L10.0016 19.5224L8.63949 17.1427L10.0016 14.763L13.813 8.09523H17.0807L19.53 12.38H16.8058V12.3768Z" />
        </svg>
      );
    case "X":
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9.23842 15.4055L17.3051 9.26292C17.7006 8.9618 18.2658 9.07925 18.4543 9.54702C19.446 12.0138 19.0029 14.9784 17.0297 17.0138C15.0566 19.0492 12.3111 19.4955 9.80163 18.4789L7.06027 19.7882C10.9922 22.5604 15.7667 21.8748 18.7504 18.795C21.117 16.3538 21.8499 13.0262 21.1646 10.0254L21.1708 10.0318C20.1769 5.62354 21.4151 3.86151 23.9515 0.258408C23.9702 0.231693 23.9351 0.202703 23.9123 0.226139L20.7939 3.44289V3.43221L9.23842 15.4055Z" />
          <path d="M7.65167 7.33217C5.24368 9.81392 4.75711 14.1176 7.57924 16.8984L7.57713 16.9005L0.0792788 23.8097C0.0528384 23.834 0.0162235 23.8015 0.0377551 23.7728C0.487937 23.1707 1.01883 22.595 1.54932 22.0198L1.57777 21.9889C3.28214 20.1411 4.97141 18.3097 3.93926 15.7216C2.55615 12.2552 3.36158 8.19287 5.9228 5.55089C8.58547 2.80639 12.507 2.1144 15.7826 3.5048C16.5072 3.78245 17.1388 4.17758 17.6315 4.54493L14.8964 5.84777C12.3497 4.7457 9.43229 5.49537 7.65167 7.33217Z" />
        </svg>
      );
    case "Kling":
      return (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" clipRule="evenodd" d="M16.7522 2.86984L16.818 2.93745L16.8199 2.93552C18.087 4.25441 17.7236 6.90443 15.8863 9.90864L19.5 13.6567L19.3447 13.9703C18.7372 15.1986 17.9147 16.2992 16.9193 17.216C15.608 18.43 14.0251 19.2853 12.3143 19.7044L12.2522 19.7198L12.1634 19.7417L12.0994 19.7565L11.9584 19.7887L11.8416 19.8126L11.754 19.8299C11.6609 19.8493 11.5634 19.8673 11.4683 19.884L11.3888 19.8963L11.3286 19.904C11.2429 19.916 11.1576 19.9272 11.0727 19.9375C9.64831 20.1036 8.20616 19.9376 6.8516 19.4517C5.49703 18.9658 4.2643 18.1723 3.24348 17.1291L3.18385 17.0692C1.91429 15.7503 2.27391 13.0983 4.11366 10.0922L0.5 6.34416L0.65528 6.03054C1.26118 4.80131 2.0846 3.70115 3.08261 2.78741C4.10242 1.8473 5.28649 1.11848 6.57081 0.640344C6.86894 0.528933 7.18075 0.431691 7.48696 0.34926C7.73931 0.279139 7.9944 0.220054 8.25155 0.172163C8.33851 0.154131 8.43665 0.135456 8.53168 0.118712C10.0139 -0.12084 11.5297 0.00325476 12.9574 0.481036C14.385 0.958817 15.6847 1.77698 16.7522 2.86984ZM15.5304 3.03083H15.5267L15.5304 3.03276C14.3025 2.63864 12.354 3.27555 10.2944 4.68267C11.8615 4.22994 13.377 4.46435 14.3565 5.48057C15.2845 6.44462 15.5385 7.90777 15.187 9.44497C15.1704 9.52697 15.1497 9.61005 15.1248 9.69419C16.8062 7.05706 17.3441 4.58993 16.2795 3.48807C16.262 3.4682 16.2433 3.44949 16.2236 3.43204L16.2155 3.42431L16.2037 3.41336L16.1683 3.38503C16.153 3.37215 16.1371 3.3597 16.1205 3.34768L16.0944 3.32836C15.9242 3.19657 15.7334 3.09594 15.5304 3.03083ZM14.6876 8.95876C14.4708 10.2995 13.7559 11.6545 12.672 12.777C11.5913 13.9001 10.282 14.642 8.98696 14.8687C7.77516 15.0812 6.72981 14.8043 6.04472 14.0959C5.36149 13.3868 5.09441 12.3069 5.29938 11.044C5.51615 9.7045 6.22919 8.3489 7.30807 7.22771C7.30807 7.22771 7.30994 7.22771 7.31429 7.22127L7.31801 7.21483C8.40062 6.09944 9.70497 5.3595 10.9969 5.13539C12.2087 4.92287 13.2516 5.1985 13.9391 5.90818C14.6224 6.61657 14.8894 7.69847 14.6845 8.9594H14.6882L14.6876 8.95876ZM3.70621 3.51061C2.88113 4.26712 2.1865 5.16395 1.65217 6.16255L1.64596 6.16449L4.78137 9.40762C5.04127 9.02837 5.31475 8.65932 5.60124 8.30124C5.70311 8.17567 5.80807 8.04558 5.91553 7.91614L5.95652 7.86784L6.10559 7.69525C6.10994 7.69139 6.11429 7.68301 6.11429 7.68301L6.14161 7.65082L6.1559 7.63343L6.23292 7.54456C6.27226 7.49819 6.31284 7.45247 6.35466 7.40739C6.35466 7.40288 6.36087 7.39644 6.36087 7.39644L6.42795 7.32045L6.47578 7.26893C6.47785 7.26592 6.4795 7.26507 6.4795 7.26507C6.48385 7.26249 6.48385 7.25863 6.48385 7.25863C6.48675 7.25562 6.48965 7.25176 6.49255 7.24703L6.50124 7.23609C6.50882 7.23006 6.51569 7.22314 6.52174 7.21548L6.53354 7.2026C6.55901 7.17619 6.58944 7.14528 6.61677 7.11437C6.63126 7.09591 6.64783 7.07745 6.66646 7.05899L6.69193 7.03194C6.69627 7.0255 6.70807 7.01326 6.70807 7.01326L6.7559 6.96432L6.84907 6.86901L6.88012 6.83488L6.91491 6.79688C7.5863 6.09838 8.30377 5.44917 9.06211 4.85397L9.16149 4.77862H9.16211V4.77798L9.16335 4.77733L9.26273 4.70134C9.37371 4.61505 9.48551 4.53068 9.59814 4.44825C9.71822 4.36325 9.8383 4.27953 9.95838 4.1971C11.587 3.0714 13.182 2.39586 14.4839 2.26191C12.7422 1.17239 10.6864 0.752921 8.6764 1.07697C8.58944 1.09114 8.50621 1.10595 8.41677 1.12462C8.36025 1.13493 8.31118 1.14523 8.26149 1.15554L8.23168 1.16198C7.77515 1.25942 7.3258 1.39004 6.88696 1.55288C5.71551 1.9877 4.63519 2.65238 3.70621 3.51061ZM3.87888 16.6531C4.05279 16.7905 4.25093 16.8949 4.47329 16.9661H4.46894C5.70497 17.3577 7.64596 16.7188 9.69814 15.3156C8.13292 15.7664 6.6205 15.532 5.64099 14.5157C4.71739 13.5562 4.46335 12.0885 4.81304 10.5513C4.83043 10.4693 4.85093 10.3863 4.87453 10.3021C3.19379 12.9399 2.65714 15.4064 3.7205 16.5089C3.77062 16.56 3.8235 16.6082 3.87888 16.6531ZM18.346 13.8389V13.8402C17.8108 14.8373 17.1168 15.7333 16.2932 16.4902C15.0606 17.625 13.5707 18.4173 11.9627 18.7931L11.9429 18.7983L11.8894 18.8112C11.8291 18.8281 11.7679 18.8418 11.7062 18.8524C11.666 18.8614 11.6251 18.8693 11.5832 18.8762C11.4967 18.8936 11.4097 18.9087 11.3224 18.9213L11.2497 18.9342L11.1671 18.9451C11.1008 18.9545 11.0329 18.9631 10.9634 18.9709C9.06697 19.1922 7.15308 18.7592 5.51801 17.7389C6.77143 17.6108 8.29752 16.9764 9.86273 15.9274L9.95217 15.8668L10.0416 15.8057L10.1634 15.7206H10.164L10.3994 15.5545C10.5128 15.4721 10.6246 15.3877 10.7348 15.3014C10.8035 15.2503 10.871 15.1994 10.9373 15.1488C11.6946 14.5518 12.4122 13.9025 13.0851 13.2052C13.1012 13.1881 13.1164 13.1713 13.1304 13.155L13.1491 13.1331C13.1822 13.1009 13.2133 13.0693 13.2422 13.0384L13.2894 12.9895C13.2894 12.9895 13.3019 12.9766 13.3037 12.9702L13.3217 12.9521L13.3292 12.9438L13.3832 12.8884L13.4248 12.8433C13.4389 12.8296 13.4528 12.815 13.4665 12.7995L13.4776 12.7866C13.4837 12.7792 13.4906 12.7725 13.4981 12.7667L13.5075 12.7551L13.5161 12.7441C13.5161 12.7441 13.5224 12.7377 13.5261 12.7358L13.5429 12.7171L13.5596 12.6984L13.5758 12.6823C13.5584 12.7012 13.5418 12.7209 13.5261 12.7416L13.5646 12.6997L13.5652 12.6984C13.5921 12.6684 13.6188 12.6396 13.6453 12.6121C13.6453 12.6121 13.6453 12.6057 13.6516 12.6057C13.688 12.5653 13.7234 12.5245 13.7578 12.4833L13.828 12.4022C13.8372 12.396 13.8447 12.3873 13.8497 12.3771L13.8894 12.3275L13.8994 12.3152C13.9478 12.2616 13.9952 12.2073 14.0416 12.1523L14.0901 12.0943C14.1679 12.0003 14.2453 11.9057 14.3224 11.8103L14.4155 11.6951L14.4447 11.6577C14.482 11.6092 14.5188 11.562 14.5553 11.516C14.5863 11.4774 14.6168 11.4379 14.6466 11.3975C14.8451 11.1367 15.0377 10.8711 15.2242 10.6009L18.346 13.8389ZM18.346 13.8389C18.346 13.8368 18.3472 13.835 18.3497 13.8338V13.8441L18.346 13.8402H18.3472L18.346 13.8389Z" />
        </svg>
      );
    case "Bytedance":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <g clipPath="url(#seedance-clip)">
            <path d="M3.1544 12.1539L0.533203 12.8092V1.19824L3.1544 1.85354V12.1539Z" />
            <path d="M15.8225 12.8333L13.1963 13.4886V0.518555L15.8225 1.169V12.8333Z" />
            <path d="M7.31261 12.5083L4.69141 13.1636V6.32422L7.31261 6.97947V12.5083Z" />
            <path d="M9.02539 5.3096L11.6516 4.6543V11.4937L9.02539 10.8384V5.3096Z" />
          </g>
          <defs>
            <clipPath id="seedance-clip">
              <rect width="16" height="14" fill="white" />
            </clipPath>
          </defs>
        </svg>
      );
    case "Alibaba":
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M9.39589 9.99064C10.2791 8.81304 11.9431 7.16184 11.9943 5.99704C12.0967 4.48664 10.5735 3.98744 8.99909 4.00024C7.89829 4.01304 6.77189 4.33304 6.00389 4.60184C3.32869 5.54904 1.66469 7.04664 0.60229 8.72344C-0.51131 10.3746 -0.14011 11.949 2.21509 12.0002C4.01989 11.9234 5.19749 11.4242 6.42629 10.797C6.43909 10.797 3.03429 11.7698 1.79269 11.053C1.66469 10.9762 1.52389 10.8738 1.48549 10.5922C1.47269 10.0034 2.45829 9.38904 3.00869 9.19704V8.17304C3.41829 8.32664 3.85349 8.41624 4.31429 8.41624C5.19749 8.41624 6.00389 8.09624 6.63109 7.57144C6.65669 7.66104 6.66949 7.76344 6.65669 7.86584H6.89989C6.92549 7.59704 6.78469 7.39224 6.78469 7.39224C6.56709 7.03384 6.17029 7.04664 6.17029 7.04664C6.17029 7.04664 6.37509 7.13624 6.52869 7.35384C5.95269 7.84024 5.21029 8.12184 4.40389 8.12184C4.05829 8.12184 3.72549 8.07064 3.41829 7.96824L4.22469 7.16184L4.00709 6.57304C5.63269 6.00984 6.98949 5.57464 9.21669 5.17784L8.70469 4.80664L8.96069 4.65304C10.3047 5.02424 11.1879 5.29304 11.1367 6.00984C11.1111 6.12504 11.0727 6.26584 11.0087 6.41944C10.6247 7.18744 9.45989 8.48024 8.98629 9.01784C8.67909 9.37624 8.37189 9.72184 8.15429 10.0546C7.93669 10.3874 7.79589 10.7074 7.78309 11.0018C7.80869 13.3442 14.6695 9.91384 16.0007 9.00504C14.0423 9.84984 11.9303 10.6562 9.60069 10.8098C8.94789 10.8482 9.02469 10.5026 9.39589 9.99064Z" />
        </svg>
      );
    default:
      return null;
  }
}

function RatioTriggerPreview({ ratio }: { ratio: string }) {
  const [ws, hs] = ratio.split(":");
  const w = parseFloat(ws), h = parseFloat(hs);
  if (!w || !h) return null;
  const maxW = 16, maxH = 12;
  let rw = maxW, rh = (h / w) * maxW;
  if (rh > maxH) { rh = maxH; rw = (w / h) * maxH; }
  return (
    <span style={{
      display: "inline-block",
      width: `${Math.round(rw)}px`,
      height: `${Math.round(rh)}px`,
      border: "1.5px solid currentColor",
      borderRadius: "2px",
      flexShrink: 0,
    }} />
  );
}

function DiamondIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M9.7832 0.499878C10.3232 0.499878 10.6767 0.496482 11.0146 0.578979C11.1617 0.61491 11.3057 0.662985 11.4443 0.722534C11.7645 0.860077 12.0366 1.07387 12.4492 1.39148C13.1566 1.93605 13.7165 2.36662 14.127 2.75183C14.5421 3.14152 14.8482 3.52421 15.0088 3.99109C15.1407 4.37448 15.1904 4.77934 15.1543 5.18152C15.11 5.67308 14.9012 6.11252 14.5889 6.57898C14.2806 7.0392 13.8372 7.57315 13.2793 8.24695L10.6172 11.4628C10.115 12.0692 9.7038 12.5675 9.32715 12.9071C8.93826 13.2577 8.52095 13.4998 7.99902 13.4999C7.47706 13.4998 7.05981 13.2577 6.6709 12.9071C6.29425 12.5675 5.88301 12.0692 5.38086 11.4628L2.71875 8.24695C2.16068 7.573 1.71649 7.03928 1.4082 6.57898C1.09583 6.11253 0.88806 5.67308 0.84375 5.18152C0.807575 4.77927 0.857447 4.37442 0.989258 3.99109C1.14984 3.52425 1.45592 3.14152 1.87109 2.75183C2.28153 2.36662 2.84142 1.93606 3.54883 1.39148C3.96144 1.07384 4.23354 0.860066 4.55371 0.722534C4.69233 0.663015 4.83627 0.614905 4.9834 0.578979C5.32129 0.496532 5.67406 0.499877 6.21387 0.499878H9.7832ZM6.21387 1.49988C5.62618 1.49988 5.41459 1.50338 5.2207 1.55066C5.12692 1.57356 5.03539 1.60407 4.94824 1.64148C4.77007 1.71805 4.60994 1.83744 4.15918 2.18445C3.43571 2.74139 2.92207 3.13743 2.55566 3.48132C2.19409 3.82071 2.01931 4.06993 1.93457 4.31628C1.84817 4.56755 1.81638 4.83083 1.83984 5.09167C1.86269 5.34527 1.97017 5.62051 2.23926 6.02234C2.51258 6.43044 2.91688 6.91921 3.48828 7.60925L6.15039 10.8251C6.67274 11.4559 7.03123 11.8858 7.34082 12.1649C7.63783 12.4326 7.8253 12.4998 7.99902 12.4999C8.17274 12.4998 8.36021 12.4326 8.65723 12.1649C8.96678 11.8858 9.32443 11.4558 9.84668 10.8251L12.5098 7.60925C13.0811 6.91925 13.4855 6.43042 13.7588 6.02234C14.0278 5.62058 14.1353 5.34525 14.1582 5.09167C14.1816 4.83081 14.1498 4.56744 14.0635 4.31628C13.9788 4.06995 13.8039 3.82068 13.4424 3.48132C13.076 3.13744 12.5623 2.74138 11.8389 2.18445C11.3881 1.83744 11.228 1.71805 11.0498 1.64148C10.9627 1.60406 10.8712 1.57359 10.7773 1.55066C10.5834 1.50333 10.3713 1.49988 9.7832 1.49988H6.21387ZM9.33203 4.16687C9.6081 4.16695 9.83203 4.39078 9.83203 4.66687C9.83188 4.94283 9.60801 5.16679 9.33203 5.16687H6.66504C6.38915 5.16669 6.16519 4.94277 6.16504 4.66687C6.16504 4.39084 6.38905 4.16705 6.66504 4.16687H9.33203Z" />
    </svg>
  );
}

function AspectIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
    </svg>
  );
}

// ── Gallery card ──────────────────────────────────────────────────────────────

function GalleryCard({
  item,
  displayWidth,
  onOpen,
  onAddReference,
  onCopyPrompt,
  onDownload,
  onDelete,
  videoMuted,
  onToggleMute,
  onNaturalRatioDiscovered,
  selected,
  anySelected,
  onSelect,
  scrollContainer,
  isTagged,
  isNew,
  onMarkSeen,
}: {
  item: GalleryItem;
  displayWidth?: number;
  onOpen?: () => void;
  onAddReference?: (url: string) => void;
  onCopyPrompt?: (prompt: string, refUrls?: string[], meta?: { model?: string; aspectRatio?: string; quality?: string; azureResolution?: string }) => void;
  onDownload?: (url: string, isVideo: boolean) => Promise<void>;
  onDelete?: (id: string, source: "generation" | "upload") => Promise<void>;
  videoMuted?: boolean;
  onToggleMute?: () => void;
  onNaturalRatioDiscovered?: () => void;
  selected?: boolean;
  anySelected?: boolean;
  onSelect?: () => void;
  scrollContainer?: React.RefObject<HTMLDivElement | null>;
  isTagged?: boolean;
  isNew?: boolean;
  onMarkSeen?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cancelSlotRef = useRef<(() => void) | null>(null);
  const slotReleasedRef = useRef(false);
  const preloaded = loadedImageUrls.has(item.url);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(preloaded);
  const [shouldLoad, setShouldLoad] = useState(preloaded);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cardImgIdx, setCardImgIdx] = useState(0);
  const [naturalRatio, setNaturalRatio] = useState<string | null>(() => naturalRatioCache.get(item.url) ?? null);
  const [isHovered, setIsHovered] = useState(false);
  const isVideo = item.mediaType === "video";
  const allUrls = item.imageUrls ?? [item.url];
  const displayUrl = allUrls[cardImgIdx] ?? item.url;

  // Lazy-load observer: request a concurrency slot when the card nears the viewport.
  useEffect(() => {
    if (preloaded) return;
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (isVideo) {
            setShouldLoad(true);
          } else if (!cancelSlotRef.current) {
            cancelSlotRef.current = requestImageSlot(() => setShouldLoad(true));
          }
        }
      },
      { root: scrollContainer?.current ?? null, rootMargin: "200px", threshold: 0 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelSlotRef.current?.();
      cancelSlotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Play/pause observer: only play videos that are actually visible
  useEffect(() => {
    if (!isVideo) return;
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          videoRef.current?.play().then(() => setPlaying(true)).catch(() => {});
        } else {
          videoRef.current?.pause();
          setPlaying(false);
        }
      },
      { root: scrollContainer?.current ?? null, rootMargin: "0px", threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideo]);

  const storedRatio = (() => {
    const ar = item.aspect_ratio;
    if (!ar || ar === "auto") return null;
    const [w, h] = ar.split(":");
    return w && h ? `${w} / ${h}` : null;
  })();

  // Uploads have no stored aspect_ratio — use natural dims once known, 1/1 only while actively loading
  const cssRatio = storedRatio ?? (() => {
    if (item.source !== "upload") return null;
    if (naturalRatio) return naturalRatio;
    if (shouldLoad && !imgLoaded) return "1 / 1"; // placeholder so shimmer has height
    return null;
  })();

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try { await onDownload?.(item.url, isVideo); } finally { setDownloading(false); }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.prompt) return;
    onCopyPrompt?.(item.prompt, item.referenceImageUrls, { model: item.model, aspectRatio: item.aspect_ratio, quality: item.quality, azureResolution: item.azure_resolution });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleAddRef = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddReference?.(item.url);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleting) return;
    setDeleting(true);
    try { await onDelete?.(item.id, item.source); } finally { setDeleting(false); }
  };

  if (failed) {
    return (
      <div className="gallery-item" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className={`gallery-item${selected ? " gallery-item--selected" : ""}${anySelected ? " gallery-item--anyselected" : ""}${isTagged ? " gallery-item--tagged" : ""}`}
      draggable
      onDragStart={e => {
        e.stopPropagation();
        _galleryDragItem = { url: item.url, mediaType: item.mediaType };
        e.dataTransfer.setData("application/x-gallery-item", "1");
        e.dataTransfer.setData("text/plain", item.url);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onDragEnd={() => { _galleryDragItem = null; }}
      onMouseEnter={() => { setIsHovered(true); onMarkSeen?.(); }}
      onMouseLeave={() => setIsHovered(false)}
      onClick={anySelected ? onSelect : onOpen}
    >
      {/* ── NEW badge (top-right) ── */}
      {isNew && (
        <div style={{
          position: "absolute", top: 7, right: 7, zIndex: 10,
          padding: "2px 6px", borderRadius: 999,
          background: "linear-gradient(135deg, rgba(30,100,200,0.85) 0%, rgba(20,160,140,0.85) 100%)",
          backdropFilter: "blur(6px)",
          border: "1px solid rgba(45,212,191,0.35)",
          fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
          color: "#fff", pointerEvents: "none", lineHeight: 1.4,
          textTransform: "uppercase",
        }}>
          NEW
        </div>
      )}
      {/* ── Checkbox (top-left) ── */}
      <div className="gallery-checkbox" onClick={e => { e.stopPropagation(); onSelect?.(); }}>
        {selected && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0B0E14" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </div>
      {isVideo ? (
        <>
          <video
            ref={videoRef}
            src={shouldLoad ? item.url : undefined}
            muted={videoMuted || !isHovered}
            autoPlay
            loop
            playsInline
            preload="metadata"
            draggable={false}
            onLoadedData={() => {
              setImgLoaded(true);
              loadedImageUrls.add(item.url);
            }}
            onError={() => {
              setFailed(true);
              loadedImageUrls.delete(item.url);
              try { sessionStorage.setItem("hg-loaded", JSON.stringify([...loadedImageUrls])); } catch {}
            }}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: imgLoaded ? 1 : 0, transition: "opacity 400ms ease" }}
          />
          {!playing && (
            <div className="gallery-play-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff" stroke="none"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            </div>
          )}
        </>
      ) : (
        <>
          {(!shouldLoad || !imgLoaded) && <div className="gallery-shimmer" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={displayUrl}
            src={shouldLoad ? thumbSrc(displayUrl, displayWidth ?? 400) : undefined}
            alt={item.prompt ?? ""}
            draggable={false}
            decoding="async"
            onLoad={(e) => {
              if (!slotReleasedRef.current) { slotReleasedRef.current = true; releaseImageSlot(); }
              const img = e.currentTarget;
              if (!storedRatio && item.source === "upload" && img.naturalWidth && img.naturalHeight) {
                const r = `${img.naturalWidth} / ${img.naturalHeight}`;
                if (!naturalRatioCache.has(item.url)) {
                  naturalRatioCache.set(item.url, r);
                  onNaturalRatioDiscovered?.();
                }
                setNaturalRatio(r);
              }
              setImgLoaded(true);
              loadedImageUrls.add(item.url);
            }}
            onError={() => {
              if (!slotReleasedRef.current) { slotReleasedRef.current = true; releaseImageSlot(); }
              setFailed(true);
              loadedImageUrls.delete(item.url);
              try { sessionStorage.setItem("hg-loaded", JSON.stringify([...loadedImageUrls])); } catch {}
            }}
            style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", opacity: imgLoaded ? 1 : 0, transition: "opacity 400ms ease" }}
          />
          {/* Inner carousel nav — only when multiple images */}
          {allUrls.length > 1 && (
            <>
              <button
                onClick={e => { e.stopPropagation(); setImgLoaded(false); setCardImgIdx(i => Math.max(0, i - 1)); }}
                disabled={cardImgIdx === 0}
                style={{
                  position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)",
                  width: 26, height: 26, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", zIndex: 3, opacity: cardImgIdx === 0 ? 0.25 : 1,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
              <button
                onClick={e => { e.stopPropagation(); setImgLoaded(false); setCardImgIdx(i => Math.min(allUrls.length - 1, i + 1)); }}
                disabled={cardImgIdx === allUrls.length - 1}
                style={{
                  position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                  width: 26, height: 26, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", zIndex: 3, opacity: cardImgIdx === allUrls.length - 1 ? 0.25 : 1,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
              <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 4, zIndex: 3 }}>
                {allUrls.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={e => { e.stopPropagation(); setImgLoaded(false); setCardImgIdx(idx); }}
                    style={{
                      width: idx === cardImgIdx ? 12 : 6, height: 6, borderRadius: 3,
                      background: idx === cardImgIdx ? "#fff" : "rgba(255,255,255,0.4)",
                      border: "none", cursor: "pointer", padding: 0, transition: "all 150ms",
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── Gradient overlay + prompt ── */}
      <div className="gallery-overlay">
        {item.prompt && (
          <div style={{ fontSize: "11px", lineHeight: 1.45, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", marginBottom: "4px" }}>
            {renderLightboxPrompt(item.prompt, item.referenceImageUrls)}
          </div>
        )}
        <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.35)" }}>
          {[item.model, item.aspect_ratio].filter(Boolean).join(" · ") || (item.source === "upload" ? "Uploaded" : "")}
        </p>
      </div>

      {/* ── Top-right icon buttons ── */}
      <div className="gallery-actions-top">
        {isVideo && (
          <button
            className="gallery-action-btn"
            onClick={e => { e.stopPropagation(); onToggleMute?.(); }}
            title={videoMuted ? "Unmute" : "Mute"}
          >
            {videoMuted ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              </svg>
            )}
          </button>
        )}
        {item.prompt && onCopyPrompt && (
          <button className="gallery-action-btn" title={copied ? "Copied!" : "Copy prompt"} onClick={handleCopy}>
            {copied ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2DD4BF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        )}
        <button
          className="gallery-action-btn"
          title={downloading ? "Downloading…" : "Download"}
          onClick={handleDownload}
          disabled={downloading}
          style={{ opacity: downloading ? 0.65 : undefined }}
        >
          {downloading ? (
            <div style={{ width: "11px", height: "11px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "#fff", animation: "spin 0.75s linear infinite", flexShrink: 0 }} />
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          )}
        </button>
        {onDelete && (
          <button
            className="gallery-action-btn gallery-delete-btn"
            title="Delete"
            onClick={handleDelete}
            disabled={deleting}
            style={{ opacity: deleting ? 0.65 : undefined }}
          >
            {deleting ? (
              <div style={{ width: "11px", height: "11px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.2)", borderTopColor: "#fff", animation: "spin 0.75s linear infinite", flexShrink: 0 }} />
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* ── Bottom-left Reference button (images only) ── */}
      {!isVideo && onAddReference && (
        <div className="gallery-actions-bottom">
          <button className="gallery-ref-btn" onClick={handleAddRef}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
            </svg>
            Reference
          </button>
        </div>
      )}
    </div>
  );
}

// ── DownloadToast ─────────────────────────────────────────────────────────────

function DownloadToast({ downloads, onClear }: { downloads: DownloadTask[]; onClear: () => void }) {
  const [collapsed, setCollapsed] = useState(false);

  if (downloads.length === 0) return null;

  const allDone = downloads.every(d => d.status !== "preparing");
  const title = allDone ? "Download complete" : "Preparing download";

  return (
    <div style={{
      position: "fixed",
      top: "64px",
      right: "16px",
      width: "300px",
      background: "rgba(16,18,20,0.97)",
      backdropFilter: "blur(24px)",
      WebkitBackdropFilter: "blur(24px)",
      borderRadius: "18px",
      border: "1px solid rgba(255,255,255,0.07)",
      boxShadow: "0 12px 48px rgba(0,0,0,0.7), 0 2px 12px rgba(0,0,0,0.4)",
      zIndex: 9500,
      overflow: "hidden",
      fontFamily: "inherit",
    }}>
      {/* Header */}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 14px 14px 14px", cursor: "pointer", userSelect: "none" }}
      >
        {/* Animated icon */}
        <div style={{ position: "relative", width: "28px", height: "28px", flexShrink: 0 }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ position: "absolute", inset: 0 }}>
            <circle cx="14" cy="14" r="12" stroke="rgba(119,229,68,0.2)" strokeWidth="2" />
            <circle
              cx="14" cy="14" r="12"
              stroke="#2DD4BF" strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 12}`}
              strokeDashoffset={allDone ? 0 : `${2 * Math.PI * 12 * 0.25}`}
              style={{ transformOrigin: "center", transform: "rotate(-90deg)", transition: "stroke-dashoffset 0.4s ease" }}
              className={allDone ? undefined : "dl-ring-spin"}
            />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2DD4BF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
        </div>
        <span style={{ flex: 1, fontSize: "14px", fontWeight: 600, color: "#ffffff", letterSpacing: "-0.01em" }}>{title}</span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.5" strokeLinecap="round"
          style={{ flexShrink: 0, transition: "transform 200ms", transform: collapsed ? "rotate(180deg)" : "none" }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>

      {/* Items */}
      {!collapsed && (
        <div style={{ padding: "0 8px 8px" }}>
          {downloads.map(task => (
            <div key={task.id} style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "9px 10px",
              background: "rgba(255,255,255,0.035)",
              borderRadius: "10px",
              marginBottom: "4px",
            }}>
              {/* File icon */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={task.status === "preparing" ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.45)"} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M3 6h18M3 12h18M3 18h18" />
                <rect x="2" y="4" width="20" height="16" rx="2" />
              </svg>
              {/* Label */}
              <span style={{ flex: 1, fontSize: "13px", color: task.status === "preparing" ? "rgba(255,255,255,0.35)" : "#ffffff", letterSpacing: "-0.01em" }}>
                {task.status === "preparing" ? "Preparing…" : task.status === "error" ? "Failed" : "Ready"}
              </span>
              {/* Status indicator */}
              {task.status === "preparing" ? (
                <div style={{ width: "16px", height: "16px", borderRadius: "50%", border: "2px solid rgba(255,255,255,0.12)", borderTopColor: "rgba(255,255,255,0.45)", animation: "spin 0.9s linear infinite", flexShrink: 0 }} />
              ) : task.status === "error" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
                </svg>
              ) : (
                <div style={{ width: "20px", height: "20px", borderRadius: "50%", background: "#2DD4BF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#060A06" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Lightbox helpers ──────────────────────────────────────────────────────────

function syntaxHighlightJson(
  json: string,
  tagged?: TaggedImage[],
  onEnter?: (tag: TaggedImage, rect: DOMRect) => void,
  onLeave?: () => void,
  onMD?: (tag: TaggedImage) => void,
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let k = 0;
  const push = (from: number, to: number, color?: string) => {
    if (from >= to) return;
    const text = json.slice(from, to);
    if (tagged?.length && onEnter && onLeave && onMD) {
      const { nodes, nextKey } = splitByMentions(text, color, tagged, k, onEnter, onLeave, onMD);
      parts.push(...nodes);
      k = nextKey;
    } else {
      parts.push(<span key={k++} style={color ? { color } : undefined}>{text}</span>);
    }
  };
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}\[\],])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(json)) !== null) {
    push(last, m.index);
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        push(m.index, m.index + m[1].length, "#06b6d4");
        push(m.index + m[1].length, m.index + m[0].length, "#6b7280");
      } else {
        push(m.index, m.index + m[1].length, "#86efac");
      }
    } else if (m[3] !== undefined) {
      push(m.index, m.index + m[3].length, "#fb923c");
    } else if (m[4] !== undefined) {
      push(m.index, m.index + m[4].length, "#a78bfa");
    } else if (m[5] !== undefined) {
      push(m.index, m.index + m[5].length, "#6b7280");
    }
    last = re.lastIndex;
  }
  push(last, json.length);
  return <>{parts}</>;
}

function syntaxHighlightYaml(
  yaml: string,
  tagged?: TaggedImage[],
  onEnter?: (tag: TaggedImage, rect: DOMRect) => void,
  onLeave?: () => void,
  onMD?: (tag: TaggedImage) => void,
): React.ReactNode {
  const lines = yaml.split("\n");
  const parts: React.ReactNode[] = [];
  let k = 0;
  lines.forEach((line, i) => {
    // Directive / document markers
    if (/^---/.test(line) || /^\.\.\.$/.test(line)) {
      parts.push(<span key={k++} style={{ color: "#6b7280" }}>{line}</span>);
    } else {
      // Key: value  (handles indent + optional list marker)
      const keyMatch = line.match(/^(\s*(?:-\s+)?)([\w\-./]+)(\s*:)(.*)/);
      if (keyMatch) {
        const [, indent, key, colon, rest] = keyMatch;
        parts.push(<span key={k++}>{indent}</span>);
        parts.push(<span key={k++} style={{ color: "#06b6d4" }}>{key}</span>);
        parts.push(<span key={k++} style={{ color: "#6b7280" }}>{colon}</span>);
        parts.push(<span key={k++}>{colorYamlValue(rest, k, tagged, onEnter, onLeave, onMD)}</span>);
        k++;
      } else {
        // List item or plain value
        const listMatch = line.match(/^(\s*-\s+)(.*)/);
        if (listMatch) {
          parts.push(<span key={k++} style={{ color: "#6b7280" }}>{listMatch[1]}</span>);
          parts.push(<span key={k++}>{colorYamlValue(listMatch[2], k, tagged, onEnter, onLeave, onMD)}</span>);
          k++;
        } else {
          parts.push(<span key={k++}>{line}</span>);
        }
      }
    }
    if (i < lines.length - 1) parts.push(<span key={k++}>{"\n"}</span>);
  });
  return <>{parts}</>;
}

function colorYamlValue(
  value: string,
  baseKey: number,
  tagged?: TaggedImage[],
  onEnter?: (tag: TaggedImage, rect: DOMRect) => void,
  onLeave?: () => void,
  onMD?: (tag: TaggedImage) => void,
): React.ReactNode {
  // Inline comment
  const commentIdx = value.search(/#/);
  const main = commentIdx >= 0 ? value.slice(0, commentIdx) : value;
  const comment = commentIdx >= 0 ? value.slice(commentIdx) : "";
  let k = baseKey * 100;
  const out: React.ReactNode[] = [];
  const trimmed = main.trim();

  const pushValue = (text: string, color?: string) => {
    if (tagged?.length && onEnter && onLeave && onMD) {
      const { nodes, nextKey } = splitByMentions(text, color, tagged, k, onEnter, onLeave, onMD);
      out.push(...nodes);
      k = nextKey;
    } else {
      out.push(<span key={k++} style={color ? { color } : undefined}>{text}</span>);
    }
  };

  if (/^(true|false|yes|no|on|off)$/i.test(trimmed)) {
    pushValue(main, "#a78bfa");
  } else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed) || /^0x[\da-fA-F]+$/.test(trimmed)) {
    pushValue(main, "#fb923c");
  } else if (/^(null|~)$/.test(trimmed)) {
    pushValue(main, "#a78bfa");
  } else if (/^['"]/.test(trimmed)) {
    pushValue(main, "#86efac");
  } else if (trimmed !== "") {
    pushValue(main, "rgba(255,255,255,0.82)");
  } else {
    pushValue(main);
  }
  if (comment) out.push(<span key={k++} style={{ color: "#4b5563" }}>{comment}</span>);
  return <>{out}</>;
}

function renderLightboxPrompt(
  text: string,
  refUrls: string[] | undefined,
): React.ReactNode {
  if (!refUrls?.length) {
    return <span style={{ color: "rgba(255,255,255,0.72)" }}>{text}</span>;
  }
  const parts: React.ReactNode[] = [];
  let lastEnd = 0;
  let key = 0;
  const re = /<<<image (\d+)>>>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastEnd) {
      parts.push(<span key={key++} style={{ color: "rgba(255,255,255,0.72)" }}>{text.slice(lastEnd, m.index)}</span>);
    }
    const n = parseInt(m[1]);
    const imgUrl = refUrls[n - 1];
    parts.push(
      <span key={key++} style={{
        display: "inline-flex", alignItems: "center", gap: "4px",
        background: "rgba(255,255,255,0.1)", borderRadius: "6px",
        padding: "1px 7px 1px 2px", verticalAlign: "middle",
        margin: "0 1px", fontSize: "12px", fontWeight: 600,
        color: "#ffffff", lineHeight: "20px",
      }}>
        {imgUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbSrc(imgUrl)} alt="" style={{ width: 20, height: 20, borderRadius: 4, objectFit: "cover", flexShrink: 0 }} />
        )}
        Image {n}
      </span>
    );
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd < text.length) {
    parts.push(<span key={key++} style={{ color: "rgba(255,255,255,0.72)" }}>{text.slice(lastEnd)}</span>);
  }
  return <>{parts}</>;
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({ item, onClose, onCopyPrompt, onPrev, onNext }: { item: GalleryItem; onClose: () => void; onCopyPrompt?: (prompt: string, refUrls?: string[], meta?: { model?: string; aspectRatio?: string; quality?: string; azureResolution?: string }) => void; onPrev?: () => void; onNext?: () => void }) {
  const [visible, setVisible] = useState(false);
  const [fullLoaded, setFullLoaded] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [resolution, setResolution] = useState<string | null>(null);
  const allUrls = item.imageUrls ?? [item.url];
  const lightboxUrl = allUrls[imgIdx] ?? item.url;

  useEffect(() => { setImgIdx(0); setFullLoaded(false); setResolution(null); }, [item.id]);
  useEffect(() => { const id = requestAnimationFrame(() => setVisible(true)); return () => cancelAnimationFrame(id); }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { if (zoomed) { setZoomed(false); return; } handleClose(); return; }
      if (e.key === "ArrowLeft") {
        if (imgIdx > 0) { setFullLoaded(false); setResolution(null); setImgIdx(i => i - 1); }
        else onPrev?.();
      }
      if (e.key === "ArrowRight") {
        if (imgIdx < allUrls.length - 1) { setFullLoaded(false); setResolution(null); setImgIdx(i => i + 1); }
        else onNext?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUrls.length, imgIdx, zoomed, onPrev, onNext]);

  const handleClose = () => { setVisible(false); setTimeout(onClose, 200); };

  const isVideo = item.mediaType === "video";

  const copyPrompt = () => {
    if (!item.prompt) return;
    navigator.clipboard.writeText(item.prompt).catch(() => { });
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const urlExt = lightboxUrl.split("?")[0].split(".").pop()?.toLowerCase();
      const ext = isVideo ? "mp4" : (urlExt && ["png","jpg","jpeg","webp","gif"].includes(urlExt) ? urlExt : "png");
      const filename = `${isVideo ? "video" : "image"}-${item.id.slice(0, 8)}.${ext}`;
      const res = await fetch(`/api/download?url=${encodeURIComponent(lightboxUrl)}&filename=${filename}`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setDownloading(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const infoRows = [
    item.model && { label: "Model", value: item.model },
    item.quality && { label: "Quality", value: item.quality.charAt(0).toUpperCase() + item.quality.slice(1) },
    item.aspect_ratio && { label: "Aspect ratio", value: item.aspect_ratio },
    resolution && { label: "Resolution", value: resolution },
    item.source && { label: "Source", value: item.source === "generation" ? "Generated" : "Uploaded" },
    { label: "Created", value: formatDate(item.created_at) },
  ].filter(Boolean) as { label: string; value: string }[];

  const panelStyle: React.CSSProperties = {
    background: "#0B0E14",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: "16px",
    overflow: "hidden",
  };

  const sectionHeaderStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: "8px",
    padding: "14px 16px 12px",
  };

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em",
    color: "rgba(255,255,255,0.4)", textTransform: "uppercase",
  };

  // When zoomed: media fills the full viewport. When not zoomed: media + right panel side by side.
  const panelWidth = 300;

  return createPortal(
    <div onClick={zoomed ? () => setZoomed(false) : handleClose} style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", alignItems: zoomed ? "center" : "flex-start", justifyContent: "center",
      background: `rgba(0,0,0,${visible ? 0.55 : 0})`,
      backdropFilter: visible ? "blur(16px)" : "none",
      WebkitBackdropFilter: visible ? "blur(16px)" : "none",
      transition: "background 200ms ease, backdrop-filter 200ms ease",
      padding: zoomed ? "0" : "24px", gap: zoomed ? "0" : "20px",
      overflowY: zoomed ? "hidden" : "auto",
    }}>

      {/* ── Media column ── */}
      <div style={{
        // When zoomed: break out of flex flow and fill the entire overlay
        position: zoomed ? "absolute" : "relative",
        inset: zoomed ? 0 : undefined,
        flex: zoomed ? undefined : 1,
        minHeight: zoomed ? undefined : "calc(100vh - 48px)",
        zIndex: zoomed ? 1 : undefined,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>

        {/* Prev button — images only */}
        {!isVideo && allUrls.length > 1 && (
          <button
            onClick={e => { e.stopPropagation(); setFullLoaded(false); setImgIdx(i => Math.max(0, i - 1)); }}
            disabled={imgIdx === 0}
            style={{
              position: "absolute", left: 16, zIndex: 10,
              width: 40, height: 40, borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", opacity: imgIdx === 0 ? 0.2 : 1, transition: "opacity 150ms",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        )}

        {/* Media wrapper — click to toggle zoom */}
        <div
          onClick={e => { e.stopPropagation(); if (!isVideo) setZoomed(z => !z); }}
          style={{
            position: "relative", flexShrink: 0,
            // Zoomed: fill the column (which is already inset:0) and center content
            width: zoomed ? "100%" : undefined,
            height: zoomed ? "100%" : undefined,
            maxWidth: zoomed ? "none" : "100%",
            maxHeight: zoomed ? "none" : "calc(100vh - 48px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            transform: visible ? "scale(1)" : "scale(0.96)",
            transition: "transform 200ms ease, border-radius 280ms ease",
            borderRadius: isVideo ? "0" : (zoomed ? "0" : "12px"),
            overflow: isVideo ? "visible" : "hidden",
            boxShadow: zoomed ? "none" : "0 32px 80px rgba(0,0,0,0.6)",
            cursor: isVideo ? "default" : (zoomed ? "zoom-out" : "zoom-in"),
          }}
        >
          {isVideo ? (
            <video
              key={lightboxUrl}
              src={lightboxUrl}
              autoPlay
              loop
              playsInline
              controls
              onClick={e => e.stopPropagation()}
              onLoadedData={e => { setFullLoaded(true); const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setResolution(`${v.videoWidth} × ${v.videoHeight}`); }}
              style={{
                display: "block",
                maxHeight: "100vh",
                maxWidth: "100vw",
                width: "auto",
                height: "auto",
                objectFit: "contain",
                borderRadius: zoomed ? "0" : "12px",
                cursor: "default",
              }}
            />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={`blur-${lightboxUrl}`} src={lightboxUrl} alt="" aria-hidden style={{
                display: "block",
                maxHeight: zoomed ? "100vh" : "calc(100vh - 48px)",
                maxWidth: zoomed ? "100vw" : "100%",
                width: "auto", height: "auto",
                filter: fullLoaded ? "none" : "blur(12px)",
                transform: fullLoaded ? "scale(1)" : "scale(1.04)",
                transition: "filter 400ms ease, transform 400ms ease",
              }} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={`full-${lightboxUrl}`} src={lightboxUrl} alt={item.prompt ?? ""} onLoad={e => { setFullLoaded(true); const img = e.currentTarget; if (img.naturalWidth && img.naturalHeight) setResolution(`${img.naturalWidth} × ${img.naturalHeight}`); }} style={{
                position: "absolute", inset: 0, display: "block", width: "100%", height: "100%", objectFit: "contain",
                opacity: fullLoaded ? 1 : 0, transition: "opacity 400ms ease",
              }} />
              {/* Dot indicators */}
              {allUrls.length > 1 && (
                <div style={{ position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 5, zIndex: 5 }}>
                  {allUrls.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={e => { e.stopPropagation(); setFullLoaded(false); setResolution(null); setImgIdx(idx); }}
                      style={{
                        width: idx === imgIdx ? 16 : 8, height: 8, borderRadius: 4,
                        background: idx === imgIdx ? "#fff" : "rgba(255,255,255,0.4)",
                        border: "none", cursor: "pointer", padding: 0, transition: "all 150ms",
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Next button — images only */}
        {!isVideo && allUrls.length > 1 && (
          <button
            onClick={e => { e.stopPropagation(); setFullLoaded(false); setImgIdx(i => Math.min(allUrls.length - 1, i + 1)); }}
            disabled={imgIdx === allUrls.length - 1}
            style={{
              position: "absolute", right: zoomed ? "16px" : 0, zIndex: 10,
              width: 40, height: 40, borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", opacity: imgIdx === allUrls.length - 1 ? 0.2 : 1, transition: "opacity 150ms, right 280ms ease",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        )}
      </div>

      {/* ── Right panel ── */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: `${panelWidth}px`, flexShrink: 0,
          display: "flex", flexDirection: "column", gap: "12px",
          opacity: zoomed ? 0 : visible ? 1 : 0,
          transform: zoomed ? `translateX(${panelWidth + 20}px)` : visible ? "translateX(0)" : "translateX(14px)",
          pointerEvents: zoomed ? "none" : "auto",
          transition: "opacity 260ms ease, transform 280ms ease",
          background: "rgba(10,12,14,0.85)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          borderRadius: "20px",
          border: "1px solid rgba(255,255,255,0.07)",
          padding: "12px",
        }}
      >
        {/* Prompt section */}
        {item.prompt && (
          <div style={panelStyle}>
            {item.referenceImageUrls && item.referenceImageUrls.length > 0 && (
              <div style={{ padding: "14px 16px 0", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {item.referenceImageUrls.map((url, i) => (
                  <div key={i} style={{ position: "relative", width: 76, height: 68, borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumbSrc(url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    <div style={{
                      position: "absolute", bottom: 4, right: 4,
                      background: "rgba(0,0,0,0.65)", borderRadius: 4,
                      padding: "2px 5px", fontSize: 9, fontWeight: 700,
                      color: "rgba(255,255,255,0.8)", lineHeight: 1,
                    }}>
                      {i + 1}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ ...sectionHeaderStyle, justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3h6l-1 5H3z" /><path d="M3 8h6M7 3v5" /><path d="M14 3h7" /><path d="M14 8h7" /><path d="M14 13h4" /><path d="M3 13h8" /><path d="M3 18h18" />
                </svg>
                <span style={sectionLabelStyle}>Prompt</span>
              </div>
              <button
                onClick={copyPrompt}
                style={{
                  padding: "4px 12px", borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "rgba(255,255,255,0.05)",
                  color: copied ? "#2DD4BF" : "rgba(255,255,255,0.65)",
                  fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  transition: "background 140ms, color 140ms",
                  borderColor: copied ? "rgba(119,229,68,0.3)" : "rgba(255,255,255,0.1)",
                }}
                onMouseEnter={e => { if (!copied) { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#fff"; } }}
                onMouseLeave={e => { if (!copied) { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "rgba(255,255,255,0.65)"; } }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <div style={{ padding: "0 16px 16px", fontSize: "13px", lineHeight: 1.65, maxHeight: "40vh", overflowY: "auto" }}>
              {renderLightboxPrompt(item.prompt, item.referenceImageUrls)}
            </div>
          </div>
        )}

        {/* Information section */}
        <div style={panelStyle}>
          <div style={sectionHeaderStyle}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
            </svg>
            <span style={sectionLabelStyle}>Information</span>
          </div>
          {infoRows.map((row) => (
            <div key={row.label} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "13px 16px",
              borderTop: "1px solid rgba(255,255,255,0.05)",
            }}>
              <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.35)" }}>{row.label}</span>
              <span style={{ fontSize: "13px", color: "#ffffff", fontWeight: 600 }}>{row.value}</span>
            </div>
          ))}
        </div>

        {/* Download button */}
        <button
          onClick={download}
          disabled={downloading}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            width: "100%", padding: "13px 16px",
            borderRadius: "14px", border: "1px solid rgba(255,255,255,0.07)",
            background: "#0B0E14",
            color: downloading ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.75)",
            fontSize: "13px", fontWeight: 600, cursor: downloading ? "default" : "pointer",
            fontFamily: "inherit", transition: "background 140ms, color 140ms",
          }}
          onMouseEnter={e => { if (!downloading) { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#fff"; } }}
          onMouseLeave={e => { if (!downloading) { e.currentTarget.style.background = "#0B0E14"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; } }}
        >
          {downloading ? (
            <span style={{ width: 13, height: 13, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.5)", display: "inline-block", animation: "spin 0.75s linear infinite" }} />
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v13M7 13l5 5 5-5" /><path d="M5 21h14" />
            </svg>
          )}
          {downloading ? "Downloading…" : "Download"}
        </button>
      </div>

      {/* ── Close button ── */}
      <button onClick={handleClose} style={{
        position: "fixed", top: "16px", right: "16px",
        width: "34px", height: "34px", borderRadius: "50%",
        border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.5)",
        color: "rgba(255,255,255,0.6)", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        opacity: visible ? 1 : 0, transition: "opacity 200ms ease, background 150ms",
      }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(0,0,0,0.5)"; }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>,
    document.body,
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

const EMPTY_VIDEOS = [
  "https://pub-2aecfc42d3474240b32b9438bf2e3905.r2.dev/videos/1768127686656-deb8718b-abdc-4482-8439-a86e3dbb9d48.mp4",
  "https://pub-2aecfc42d3474240b32b9438bf2e3905.r2.dev/videos/1768127930665-06888ffc-490f-4896-ba17-80e0de76c091.mp4",
  "https://pub-2aecfc42d3474240b32b9438bf2e3905.r2.dev/videos/1765097494972-45b681a4-b32a-4c7d-ab7a-267f40d5ccb8.mp4",
  "https://pub-2aecfc42d3474240b32b9438bf2e3905.r2.dev/videos/1768078715583-0108%20(1)(9).mp4",
];

const VIDEO_FAN_CONFIGS = [
  { rot: "-10deg", rounded: false, mr: "clamp(-36px,-1.5vw,-16px)", z: 4 },
  { rot: "4deg",   rounded: false, mr: "clamp(-36px,-1.5vw,-16px)", z: 3 },
  { rot: "180deg", rounded: true,  mr: "clamp(-36px,-1.5vw,-16px)", z: 2 },
  { rot: "-4deg",  rounded: false, mr: "0",                         z: 1 },
];

function LoopingVideo({ src }: { src: string }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = React.useState(false);

  React.useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const captureFrame = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx || !video.videoWidth) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    };

    const onPlaying = () => setPlaying(true);

    video.addEventListener("loadeddata", captureFrame);
    video.addEventListener("playing", onPlaying);
    return () => {
      video.removeEventListener("loadeddata", captureFrame);
      video.removeEventListener("playing", onPlaying);
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: playing ? 0 : 1, transition: "opacity 0.4s ease" }} />
      <video ref={videoRef} src={src} autoPlay loop muted playsInline preload="auto" style={{ objectFit: "cover", width: "100%", height: "100%", display: "block", pointerEvents: "none" }} />
    </div>
  );
}

function VideoFan({ blur }: { blur?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", position: blur ? "absolute" : undefined, left: blur ? "50%" : undefined, top: blur ? 0 : undefined, transform: blur ? "translateX(-50%)" : undefined, filter: blur ? "blur(32px)" : undefined, opacity: blur ? 0.4 : 1 }}>
      {VIDEO_FAN_CONFIGS.map((c, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginRight: c.mr, zIndex: c.z }}>
          <div style={{ transform: `rotate(${c.rot})${c.rounded ? " scaleY(-1)" : ""}` }}>
            <div style={{ position: "relative", overflow: "hidden", width: "clamp(64px,min(12vw,16vh),172px)", height: "clamp(64px,min(12vw,16vh),172px)", borderRadius: c.rounded ? "50%" : "12px", border: "3px solid rgba(45,212,191,0.75)", boxShadow: "0 0 14px rgba(45,212,191,0.35), 0 0 4px rgba(45,212,191,0.2)" }}>
              <LoopingVideo src={EMPTY_VIDEOS[i]} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  if (tab === "videos") {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "320px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "clamp(12px,2.5vh,32px)", alignItems: "center", width: "100%", position: "relative" }}>
          <VideoFan blur />
          <VideoFan />
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "320px", gap: "10px" }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#252523" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>
      </svg>
      <p style={{ color: "#3A3A38", fontSize: "13px" }}>No images yet</p>
      <p style={{ color: "#252523", fontSize: "11px" }}>Use the prompt below to generate your first image</p>
    </div>
  );
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const GALLERY_CSS = `
  [data-prompt-input]::placeholder { color: rgba(255,255,255,0.3); }
  .picker-scroll { scrollbar-width: none; }
  .picker-scroll::-webkit-scrollbar { display: none; }
  .seed-input::-webkit-inner-spin-button, .seed-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pendingGlow {
    0%, 100% { opacity: 0.55; }
    50% { opacity: 1; }
  }
  @keyframes dlRingSpin {
    from { stroke-dashoffset: 75.4; transform: rotate(-90deg); }
    to   { stroke-dashoffset: 0;    transform: rotate(270deg); }
  }
  .dl-ring-spin { animation: dlRingSpin 1.4s linear infinite; transform-origin: center; }
  @keyframes dropIn {
    from { opacity: 0; transform: translateY(6px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0)   scale(1);    }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes shimmer {
    0%   { background-position: -800px 0; }
    100% { background-position:  800px 0; }
  }
  .gallery-skeleton {
    width: 100%;
    background: linear-gradient(
      90deg,
      #222226 0px,
      #2e2e33 200px,
      #3a3a40 350px,
      #2e2e33 500px,
      #222226 700px
    );
    background-size: 800px 100%;
    animation: shimmer 1.6s ease-in-out infinite;
    border-radius: 2px;
  }
  @keyframes refImgIn {
    from { opacity: 0; transform: translateY(14px) scale(0.91); }
    to   { opacity: 1; transform: translateY(0)    scale(1);    }
  }
  .gallery-zoom-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 90px;
    height: 3px;
    border-radius: 2px;
    background: rgba(255,255,255,0.14);
    outline: none;
    cursor: pointer;
  }
  .gallery-zoom-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: #ffffff;
    cursor: pointer;
    transition: transform 120ms;
  }
  .gallery-zoom-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
  .gallery-zoom-slider::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: #ffffff;
    cursor: pointer;
    border: none;
  }
  @keyframes durPickerIn {
    from { opacity: 0; transform: translateY(6px) scale(0.95); }
    to   { opacity: 1; transform: translateY(0)   scale(1);    }
  }
  @keyframes durPickerOut {
    from { opacity: 1; transform: translateY(0)   scale(1);    }
    to   { opacity: 0; transform: translateY(6px) scale(0.95); }
  }
  .dur-picker-in  { animation: durPickerIn  170ms cubic-bezier(0.16,1,0.3,1) both; }
  .dur-picker-out { animation: durPickerOut 160ms cubic-bezier(0.4,0,1,1)    both; }
  .dur-slider {
    -webkit-appearance: none;
    appearance: none;
    height: 3px;
    border-radius: 2px;
    background: rgba(255,255,255,0.18);
    outline: none;
    cursor: pointer;
  }
  .dur-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #ffffff;
    cursor: pointer;
    transition: transform 100ms;
  }
  .dur-slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
  .dur-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #ffffff;
    cursor: pointer;
    border: none;
  }
  @keyframes galleryItemIn {
    from { opacity: 0; transform: translateY(12px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0)    scale(1);    }
  }
  .gallery-item {
    position: relative;
    overflow: hidden;
    cursor: pointer;
    background: #222226;
    width: 100%;
    height: 100%;
    animation: galleryItemIn 450ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .gallery-actions-top {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    opacity: 0;
    transition: opacity 180ms ease;
    z-index: 5;
    pointer-events: none;
  }
  .gallery-item:hover .gallery-actions-top {
    opacity: 1;
    pointer-events: auto;
  }
  .error-pending-tile .error-tile-actions {
    opacity: 0;
    pointer-events: none;
    transition: opacity 160ms ease;
  }
  .error-pending-tile:hover .error-tile-actions {
    opacity: 1;
    pointer-events: auto;
  }
  .gallery-action-btn {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(0,0,0,0.62);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    color: rgba(255,255,255,0.8);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 120ms, color 120ms;
    flex-shrink: 0;
    padding: 0;
  }
  .gallery-action-btn:hover {
    background: rgba(255,255,255,0.16);
    color: #ffffff;
  }
  .gallery-delete-btn:hover {
    background: rgba(255,255,255,0.16);
    color: #ef4444 !important;
  }
  .gallery-actions-bottom {
    position: absolute;
    bottom: 10px;
    right: 10px;
    opacity: 0;
    transition: opacity 180ms ease;
    z-index: 5;
    pointer-events: none;
  }
  .gallery-item:hover .gallery-actions-bottom {
    opacity: 1;
    pointer-events: auto;
  }
  .gallery-ref-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 11px 5px 9px;
    border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(0,0,0,0.62);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    color: #ffffff;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 120ms;
    font-family: inherit;
    letter-spacing: -0.01em;
    white-space: nowrap;
    padding: 5px 11px 5px 9px;
  }
  .gallery-ref-btn:hover {
    background: rgba(255,255,255,0.16);
  }
  .gallery-shimmer {
    position: absolute; inset: 0;
    background: linear-gradient(90deg, #222226 25%, #2a2a2e 50%, #222226 75%);
    background-size: 800px 100%;
    animation: shimmer 1.6s infinite linear;
  }
  .gallery-item img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .gallery-item video { display: block; width: 100%; height: 100%; object-fit: cover; }
  [data-at-menu] { font-family: inherit; }
  .gallery-overlay {
    position: absolute; inset: 0;
    background: linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 55%);
    opacity: 0; transition: opacity 180ms ease;
    display: flex; flex-direction: column; justify-content: flex-end; padding: 10px;
  }
  .gallery-item:hover .gallery-overlay { opacity: 1; }
  .gallery-play-icon {
    position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    width: 36px; height: 36px; border-radius: 50%;
    background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: opacity 180ms ease; pointer-events: none;
  }
  .gallery-item:hover .gallery-play-icon { opacity: 1; }
  .gallery-checkbox {
    position: absolute;
    top: 8px;
    left: 8px;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 2px solid rgba(255,255,255,0.55);
    background: transparent;
    z-index: 6;
    opacity: 0;
    transition: opacity 150ms ease, border-color 120ms ease;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    cursor: pointer;
    flex-shrink: 0;
  }
  .gallery-item:hover .gallery-checkbox { opacity: 1; }
  .gallery-item--selected .gallery-checkbox {
    opacity: 1;
    border-color: #ffffff;
    background: #ffffff;
  }
  .gallery-item--anyselected .gallery-actions-top { display: none; }
  .gallery-item--anyselected .gallery-actions-bottom { display: none; }
  .gallery-item--anyselected .gallery-mute-btn { opacity: 0 !important; pointer-events: none !important; }
  .gallery-item--anyselected .gallery-overlay { opacity: 0 !important; }
  .gallery-item--anyselected { cursor: pointer; }
  .gallery-item--tagged { box-shadow: inset 0 0 0 2.5px #10b981; }
`;
