import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** null means not configured, never a runtime/model/quota failure. */
export async function enhanceWithCodex(instruction: string, signal: AbortSignal): Promise<string | null> {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.OPENAI_BASE_URL;
  const run = (args: string[], cwd: string, timeout: number, input?: string) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = execFile("codex", args, { cwd, env, signal, timeout, killSignal: "SIGKILL",
        encoding: "utf8", maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stderr }));
        else resolve({ stdout, stderr });
      });
      child.stdin?.on("error", () => {}); // Exit callback reports the failure.
      child.stdin?.end(input);
    });

  let login;
  try { login = await run(["login", "status"], tmpdir(), 5000); }
  catch (error) {
    signal.throwIfAborted();
    const failure = error as { code?: string | number; stderr?: string };
    if (failure.code === "ENOENT" || (typeof failure.code === "number" && /not logged in/i.test(failure.stderr ?? ""))) return null;
    throw new Error("Could not check Codex login. Fix the local CLI and retry; Kie was not called.");
  }
  const loginText = login.stdout + login.stderr;
  if (/logged in using an? api key|not logged in/i.test(loginText)) return null;
  if (!/logged in using chatgpt/i.test(loginText)) {
    throw new Error("Could not confirm a Codex ChatGPT login; Kie was not called.");
  }

  const directory = await mkdtemp(join(tmpdir(), "helios-enhance-"));
  try {
    const output = join(directory, "prompt.txt");
    await run(["exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check",
      "--sandbox", "read-only", "--model", "gpt-5.6-luna",
      "-c", 'model_reasoning_effort="low"', "-c", "features.shell_tool=false",
      "-c", 'web_search="disabled"', "-c", "project_doc_max_bytes=0",
      "--output-last-message", output, "-"], directory, 90000, instruction);
    const prompt = (await readFile(output, "utf8")).trim();
    if (!prompt || prompt.length > 12000) throw new Error("Invalid prompt");
    return prompt;
  } catch {
    signal.throwIfAborted();
    // Never return raw CLI diagnostics: they may contain prompts or auth details.
    throw new Error("Codex enhancement failed or timed out. Check your login, model access and usage limits, then retry. Kie was not called.");
  } finally { await rm(directory, { recursive: true, force: true }); }
}
