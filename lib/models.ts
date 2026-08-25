export interface Model {
  id: string;
  label: string;
  desc: string;
}

export interface ModelGroup {
  label: string;
  models: Model[];
}

export const MODEL_GROUPS: ModelGroup[] = [
  {
    label: "Anthropic",
    models: [
      { id: "claude-opus-4-7",   label: "Opus 4.7",       desc: "Best"     },
      { id: "claude-sonnet-4-6", label: "Sonnet 4.6",     desc: "Powerful" },
      { id: "claude-haiku-4-5",  label: "Haiku 4.5",      desc: "Fast"     },
    ],
  },
  {
    label: "Google",
    models: [
      { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro", desc: "Pro"  },
      { id: "gemini-3-flash", label: "Gemini Flash",   desc: "Fast" },
    ],
  },
  {
    label: "OpenAI",
    models: [
      { id: "gpt-5-2", label: "GPT 5.2", desc: "Latest" },
    ],
  },
  {
    label: "Azure",
    models: [
      { id: "azure-auto", label: "Azure Auto", desc: "Router" },
    ],
  },
  // Runs on the `claude` CLI installed on this machine, using its own login
  // instead of API credits — see lib/localCli.ts.
  {
    label: "Local CLI",
    models: [
      { id: "claude-cli", label: "Claude CLI", desc: "Terminal" },
    ],
  },
];

export const MODELS: Model[] = MODEL_GROUPS.flatMap(g => g.models);

/**
 * What the Assistant answers with until the user picks something else. The local
 * `claude` CLI runs on its own login, so it costs no Kie.ai credit — but it only
 * works where that binary exists (see lib/localCli.ts), which is not the case on
 * a deployed instance.
 */
export const DEFAULT_MODEL = "claude-cli";
export type ModelId = string;
