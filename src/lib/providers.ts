export type Provider = { id: string; name: string; baseUrl: string; keysUrl: string };

export const PROVIDERS: Provider[] = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', keysUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'kimi', name: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.cn/v1', keysUrl: 'https://platform.moonshot.cn/console/api-keys' },
  { id: 'qwen', name: 'Qwen (Alibaba)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keysUrl: 'https://bailian.console.aliyun.com/' },
  { id: 'glm', name: 'GLM (Z.AI)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', keysUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keysUrl: 'https://platform.openai.com/api-keys' },
];

export type AiChoice = { provider: string; baseUrl?: string; apiKey: string; model: string };

export function safeCustomUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const literalIp = /^\d+(\.\d+){3}$/.test(host) || host.includes(':') || host.startsWith('[');
  const internal = host === 'localhost' || !host.includes('.') || /\.(local|internal|localhost|intranet|lan)$/.test(host);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || literalIp || internal) return null;
  return u.toString().replace(/\/$/, '');
}
