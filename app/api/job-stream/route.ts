import { NextRequest } from "next/server";
import { reconcileJob } from "@/lib/reconcileJob";

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) return new Response("taskId required", { status: 400 });
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        req.signal.removeEventListener("abort", close);
        controller.close();
      };
      const send = () => {
        if (closed) return;
        const result = reconcileJob(taskId) ?? { status: "error", phase: "interrupted", error: "Job tracking is unavailable; the provider may still be running." };
        controller.enqueue(encoder.encode(result.status === "pending" ? ": pending\n\n" : `data: ${JSON.stringify(result)}\n\n`));
        if (result.status !== "pending") close();
      };
      const timer = setInterval(send, 3_000);
      cleanup = close;
      req.signal.addEventListener("abort", close);
      send();
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}
