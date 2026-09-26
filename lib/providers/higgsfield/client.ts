import "server-only";
import { createHiggsfieldClient } from "@higgsfield/client/v2";
import { getHiggsfieldCredentials } from "@/lib/guest/db";

export function getHiggsfieldClient() {
  const credentials = getHiggsfieldCredentials();
  if (!credentials) return null;
  return createHiggsfieldClient({
    credentials: `${credentials.keyId}:${credentials.keySecret}`,
    ...(process.env.HF_API_BASE_URL ? { baseURL: process.env.HF_API_BASE_URL } : {}),
    maxRetries: 0, // A repeated submit could charge twice after an ambiguous timeout.
    pollInterval: 3_000,
    maxPollTime: 11 * 60 * 1000,
  });
}
