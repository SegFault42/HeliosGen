import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import next from "next";

const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const username = process.env.HELIOS_WEB_USER || "";
const password = process.env.HELIOS_WEB_PASSWORD || "";

function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(leftValue, "utf8");
  const right = Buffer.from(rightValue, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function sendUnauthorized(res) {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="HeliosGen Web Trial", charset="UTF-8"',
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end("Authentication required");
}

if (!username || !password) {
  console.error(
    "Refusing to start: set both HELIOS_WEB_USER and HELIOS_WEB_PASSWORD. " +
      "The web trial must not run without access protection.",
  );
  process.exit(1);
}

const app = next({ dev: false, hostname, port });
await app.prepare();
const handle = app.getRequestHandler();

const server = createServer(async (req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url || "/", `http://${hostname}`).pathname;
  } catch {
    res.writeHead(400, { "Cache-Control": "no-store" });
    res.end("Bad request");
    return;
  }

  // A minimal unauthenticated endpoint for hosting-platform health checks.
  if (
    pathname === "/healthz" &&
    (req.method === "GET" || req.method === "HEAD")
  ) {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : "ok");
    return;
  }

  let suppliedUser = "";
  let suppliedPassword = "";
  const authorization = req.headers.authorization || "";

  if (authorization.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator >= 0) {
        suppliedUser = decoded.slice(0, separator);
        suppliedPassword = decoded.slice(separator + 1);
      }
    } catch {
      // Invalid credentials are rejected below.
    }
  }

  if (
    !safeEqual(suppliedUser, username) ||
    !safeEqual(suppliedPassword, password)
  ) {
    sendUnauthorized(res);
    return;
  }

  try {
    await handle(req, res);
  } catch (error) {
    console.error("HeliosGen request failed:", error);
    if (!res.headersSent) res.writeHead(500);
    res.end("Internal server error");
  }
});

server.listen(port, hostname, () => {
  console.log(`HeliosGen web trial listening on http://${hostname}:${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; shutting down HeliosGen`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
