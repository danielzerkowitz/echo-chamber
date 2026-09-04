import type { ModelInfo, Provider } from "./types";

export const MODELS: ModelInfo[] = [
  { id: "claude-opus-5", label: "Claude Opus 5", provider: "anthropic", supportsTemperature: false },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: "anthropic", supportsTemperature: false },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic", supportsTemperature: true },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", supportsTemperature: true },
  { id: "gpt-4o-mini", label: "GPT-4o mini", provider: "openai", supportsTemperature: true },
  { id: "gpt-4.1", label: "GPT-4.1", provider: "openai", supportsTemperature: true },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: "openai", supportsTemperature: true },
];

export function modelInfo(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function modelsForProvider(provider: Provider): ModelInfo[] {
  return MODELS.filter((m) => m.provider === provider);
}

// Cheap models used for utility work (call summaries).
export const UTILITY_MODEL: Record<Provider, string> = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
};
