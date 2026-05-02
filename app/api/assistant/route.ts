import { NextRequest } from "next/server";
import { getKieToken } from "@/lib/getKieToken";

export async function POST(req: NextRequest) {
  const { prompt, systemPrompt, model } = (await req.json()) as {
    prompt?: string;
    systemPrompt?: string;
    model?: string;
  };

  if (!prompt?.trim()) {
    return new Response(JSON.stringify({ error: "prompt is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = await getKieToken(req);
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "No Kie.ai API key configured. Add one in Settings." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const messages: { role: string; content: string }[] = [];
  if (systemPrompt?.trim()) {
    messages.push({ role: "user", content: systemPrompt.trim() });
    messages.push({ role: "assistant", content: "Understood." });
  }
  messages.push({ role: "user", content: prompt.trim() });

  const upstream = await fetch("https://api.kie.ai/claude/v1/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model:       model ?? "claude-sonnet-4-6",
      messages,
      thinkingFlag: true,
      stream:       true,
      max_tokens:   4096,
    }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(JSON.stringify({ error: errText }), {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    },
  });
}
