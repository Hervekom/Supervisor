import { PROVIDERS, safeCustomUrl, type AiChoice } from './providers';
import type { LlmConfig } from './llm';

/** Turns a student's choice into a server config. Returns undefined when they use the site's AI. */
export function resolveChoice(raw: unknown): { config?: LlmConfig; error?: string } {
  if (raw === undefined || raw === null) return {};
  const c = raw as Partial<AiChoice>;
  const apiKey = typeof c.apiKey === 'string' ? c.apiKey.trim() : '';
  const model = typeof c.model === 'string' ? c.model.trim() : '';
  if (apiKey.length < 8 || apiKey.length > 400 || /\s/.test(apiKey)) return { error: 'Check your API key.' };
  if (!/^[\w.:/@-]{1,120}$/.test(model)) return { error: 'Check your model name.' };
  const preset = PROVIDERS.find((p) => p.id === c.provider);
  const baseUrl = preset ? preset.baseUrl : c.provider === 'custom' && typeof c.baseUrl === 'string' ? safeCustomUrl(c.baseUrl) : null;
  if (!baseUrl) return { error: 'Use a public https address for your AI service.' };
  return { config: { baseUrl, apiKey, model } };
}
