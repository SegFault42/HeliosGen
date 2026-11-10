import { NextResponse } from "next/server";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/modelConfig";
export const runtime = "nodejs";
export async function GET() { return NextResponse.json({ protocolVersion:1, capabilities:{ nodeTypes:["promptNode","imageInputNode","generateNode","videoGeneratorNode","groupNode","commentNode"], targetHandles:["prompt","image","startFrame","endFrame","resource","referenceVideo","audioRef"] }, imageModels:IMAGE_MODELS.map(m=>({id:m.id,name:m.name,provider:m.provider,ratios:m.ratios})), videoModels:VIDEO_MODELS.map(m=>({id:m.id,name:m.name,provider:m.provider,ratios:m.ratios,durations:m.durations})) }); }
