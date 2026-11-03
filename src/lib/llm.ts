export class LlmNotConfigured extends Error {
  constructor() {
    super('The AI model is not set up. Add LLM_BASE_URL, LLM_API_KEY and LLM_MODEL to the server settings.');
  }
}

export type Message = { role: 'system' | 'user'; content: string };

export type LlmConfig = { baseUrl?: string; apiKey?: string; model?: string; fetchImpl?: typeof fetch };

function config(c?: LlmConfig) {
  const baseUrl = c?.baseUrl ?? process.env.LLM_BASE_URL;
  const apiKey = c?.apiKey ?? process.env.LLM_API_KEY;
  const model = c?.model ?? process.env.LLM_MODEL;
  if (!baseUrl || !apiKey || !model) throw new LlmNotConfigured();
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model, fetchImpl: c?.fetchImpl ?? fetch };
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
  const raw = fenced ?? text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The AI reply had no JSON object.');
  return JSON.parse(raw.slice(start, end + 1));
}

export async function chatJson(messages: Message[], c?: LlmConfig): Promise<unknown> {
  const { baseUrl, apiKey, model, fetchImpl } = config(c);
  const res = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature: 0.2 }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`The AI service returned ${res.status}.`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('The AI service returned an empty reply.');
  return extractJson(content);
}
