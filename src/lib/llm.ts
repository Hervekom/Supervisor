export class LlmNotConfigured extends Error {
  constructor() {
    super('Add your AI key in Account to use this feature.');
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
    redirect: 'error',
    signal: AbortSignal.timeout(180_000),
  });
  if (res.status === 401 || res.status === 403) throw new Error('Your AI provider rejected this key. Check it in Account.');
  if (res.status === 402 || res.status === 429) throw new Error('Your AI account has reached its limit or has no credit.');
  if (res.status === 404) throw new Error('Your AI provider did not find this model. Check its name in Account.');
  if (!res.ok) throw new Error(`The AI service returned ${res.status}.`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('The AI service returned an empty reply.');
  return extractJson(content);
}
