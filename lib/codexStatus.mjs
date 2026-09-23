import { execFile } from "node:child_process";
import { tmpdir } from "node:os";

/** @typedef {"chatgpt" | "signed_out" | "api_key" | "missing" | "unknown" | "error"} CodexLoginState */
/** @typedef {{ imageCli: "installed" | "missing" | "error", chatgptLogin: CodexLoginState, imageGeneration: "not_verified", lastSuccessAt: string | null }} CodexConnection */

/** Read-only local command; never expose raw output or invoke login/refresh. */
function probe(binary, args, signal) {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.OPENAI_BASE_URL;
  return new Promise(resolve => {
    execFile(binary, args, { cwd: tmpdir(), env, signal, timeout: 5000,
      killSignal: "SIGKILL", maxBuffer: 128 * 1024, encoding: "utf8" }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, text: `${stdout}\n${stderr}` });
    });
  });
}

/** @param {AbortSignal} [signal] @returns {Promise<CodexLoginState>} */
export async function checkCodexLogin(signal) {
  const result = await probe("codex", ["login", "status"], signal);
  if (result.code === "ENOENT") return "missing";
  if ((result.code === 0 || result.code === 1) && /^\s*not logged in\s*$/im.test(result.text)) return "signed_out";
  if (result.code !== 0) return "error";
  if (/^\s*logged in using chatgpt\b/im.test(result.text)) return "chatgpt";
  if (/^\s*logged in using an? api key\b/im.test(result.text)) return "api_key";
  return "unknown";
}

/** @param {AbortSignal} [signal] @returns {Promise<"installed" | "missing" | "error">} */
export async function checkImageCli(signal) {
  const result = await probe("codex-imagegen", ["--version"], signal);
  return result.code === 0 ? "installed" : result.code === "ENOENT" ? "missing" : "error";
}
