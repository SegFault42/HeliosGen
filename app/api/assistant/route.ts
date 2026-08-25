export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { getKieToken } from "@/lib/getKieToken";
import { getAzureToken } from "@/lib/getAzureKey";
import { isLocalCliInstalled, isLocalCliModel, localCliBinary, runLocalCli } from "@/lib/localCli";
import { DEFAULT_MODEL } from "@/lib/models";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

// Models that use OpenAI-compatible chat/completions endpoint
const OPENAI_COMPAT_ENDPOINTS: Record<string, string> = {
  "gemini-3-flash":  "https://api.kie.ai/gemini-3-flash/v1/chat/completions",
  "gemini-3.1-pro":  "https://api.kie.ai/gemini-3.1-pro/v1/chat/completions",
  "gpt-5-2":         "https://api.kie.ai/gpt-5-2/v1/chat/completions",
};

const AZURE_API_VERSION = "2024-04-01-preview";

const SSE_HEADERS = {
  "Content-Type":      "text/event-stream",
  "Cache-Control":     "no-cache, no-transform",
  "Connection":        "keep-alive",
  "X-Accel-Buffering": "no",
};

/**
 * The local CLIs take a single prompt string, so a multi-turn chat is flattened
 * into a labelled transcript.
 */
function renderTurns(turns: Message[]): string {
  if (turns.length === 1) return turns[0].content.trim();
  return turns
    .map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content.trim()}`)
    .join("\n\n");
}

/**
 * Re-emits the CLI's text as the same Anthropic-shaped SSE the clients already
 * parse. A failure part-way through can't change the status code any more, so it
 * is sent as a final text delta rather than swallowed.
 */
function localCliStream(model: string, systemPrompt: string, prompt: string): ReadableStream {
  const encoder = new TextEncoder();
  const send = (text: string) =>
    encoder.encode(`data: ${JSON.stringify({ type: "content_block_delta", delta: { text } })}\n\n`);

  const chunks = runLocalCli({ model: "claude-cli", systemPrompt, prompt });

  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next();
        if (done) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        controller.enqueue(send(value));
      } catch (e) {
        controller.enqueue(send(`\n\n[${model}] ${(e as Error).message}`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
    cancel() {
      chunks.return(undefined);
    },
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    messages?: Message[];
    prompt?: string;
    systemPrompt?: string;
    model?: string;
    azureEndpoint?: string;
    azureDeployment?: string;
    azureModelName?: string;
  };

  const model = body.model ?? DEFAULT_MODEL;

  // ── Local CLI (the `claude` binary on this machine) ───────────────────────
  // No API key: it runs on the CLI's own login. See lib/localCli.ts.
  if (isLocalCliModel(model)) {
    const systemPrompt =
      body.systemPrompt?.trim() ||
      body.messages?.find((m) => m.role === "system")?.content.trim() ||
      "";
    const turns = (body.messages ?? []).filter((m) => m.role !== "system");
    const prompt = turns.length > 0 ? renderTurns(turns) : (body.prompt?.trim() ?? "");
    if (!prompt) {
      return new Response(JSON.stringify({ error: "messages or prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!(await isLocalCliInstalled(model))) {
      return new Response(
        JSON.stringify({
          error: `\`${localCliBinary(model)}\` was not found on this machine. Install it, or point CLAUDE_CLI_PATH at it.`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(localCliStream(model, systemPrompt, prompt), { headers: SSE_HEADERS });
  }

  let messages: Message[];

  if (body.messages && body.messages.length > 0) {
    messages = body.messages;
  } else if (body.prompt?.trim()) {
    messages = [];
    if (body.systemPrompt?.trim()) {
      messages.push({ role: "user", content: body.systemPrompt.trim() });
      messages.push({ role: "assistant", content: "Understood." });
    }
    messages.push({ role: "user", content: body.prompt.trim() });
  } else {
    return new Response(JSON.stringify({ error: "messages or prompt is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Azure Auto (model-router) ──────────────────────────────────────────────
  if (model === "azure-auto") {
    const azureKey = await getAzureToken(req);
    if (!azureKey) {
      return new Response(
        JSON.stringify({ error: "No Azure API key configured. Add one in Settings." }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    // Normalise: strip trailing slashes and any /openai suffix users may have pasted
    const endpoint = (body.azureEndpoint ?? "")
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/openai$/i, "");
    const deployment  = (body.azureDeployment || "auto-model").trim();
    const modelName   = (body.azureModelName  || "model-router").trim();
    if (!endpoint) {
      return new Response(
        JSON.stringify({ error: "Azure base URL not configured. Add it in Settings → API Keys." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${AZURE_API_VERSION}`;
    console.log("[azure-auto] POST", url.replace(/api-version=.*/, "api-version=…"));
    const upstream = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: { "api-key": azureKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        messages,
        stream: true,
        max_tokens: 8192,
        temperature: 0.7,
        top_p: 0.95,
        frequency_penalty: 0,
        presence_penalty: 0,
      }),
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      // Extract human-readable message from Azure error envelope
      let errorMsg = errText;
      try {
        const parsed = JSON.parse(errText);
        errorMsg = parsed?.error?.message ?? parsed?.message ?? errText;
      } catch { /* use raw text */ }
      console.error("[azure-auto] upstream error", upstream.status, errorMsg);
      return new Response(
        JSON.stringify({ error: `Azure ${upstream.status}: ${errorMsg}` }),
        { status: upstream.status, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(upstream.body, { headers: SSE_HEADERS });
  }

  // ── Kie.ai models ─────────────────────────────────────────────────────────
  const apiKey = await getKieToken(req);
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "No Kie.ai API key configured. Add one in Settings." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const openaiEndpoint = OPENAI_COMPAT_ENDPOINTS[model];

  const upstream = openaiEndpoint
    ? await fetch(openaiEndpoint, {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: messages.map(m => ({
            role: m.role,
            content: [{ type: "text", text: m.content }],
          })),
          stream: true,
        }),
      })
    : await fetch("https://api.kie.ai/claude/v1/messages", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          thinkingFlag: true,
          max_tokens: 4096,
        }),
      });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(JSON.stringify({ error: errText }), {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(upstream.body, { headers: SSE_HEADERS });
}
