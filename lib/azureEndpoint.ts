// Azure Foundry base URL comes straight from the request body (client localStorage),
// and the server attaches the stored Azure key to whatever host it points at. Restrict
// it to real Azure hosts so a caller can't steal the key or get SSRF via a fake endpoint.
const ALLOWED_SUFFIXES = [
  ".openai.azure.com",
  ".cognitiveservices.azure.com",
  ".services.ai.azure.com",
];

/**
 * Validates a user-supplied Azure base URL. Accepts only https URLs on a real
 * Azure host (no userinfo), and returns the normalized origin — e.g.
 * "https://my-resource.openai.azure.com" — with any trailing slash or /openai
 * suffix stripped, or null if invalid.
 */
export function validateAzureEndpoint(raw: string | undefined | null): string | null {
  const trimmed = (raw ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/openai$/i, "");
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;

  const host = url.hostname.toLowerCase();
  const isAllowed = ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix));
  if (!isAllowed) return null;

  return `https://${url.host}`;
}
