import { MAX_UPLOAD_LABEL } from './limits';

// Shown to students. Keep these free of technical terms.
export const MESSAGES = {
  documentUnreadable: "We couldn't open this document. Please save it again as DOCX and try again.",
  pdfUnreadable: "We couldn't open this PDF. If it has a password, remove it. Otherwise save it again, or upload a DOCX file.",
  pdfUnavailable: "We can't read PDF files right now. Please upload a DOCX file, or paste your text instead.",
  fileTooLarge: `This file is larger than ${MAX_UPLOAD_LABEL}, the current upload limit. In Word, use Compress Pictures and save again, or paste your text instead.`,
  network: "We couldn't reach Supervisor. Check your connection and try again. Your work in this browser is safe.",
  server: 'Something went wrong on our side. Your work was not changed. Please try again in a moment.',
  aiNotConfigured: "AI feedback isn't set up yet. Add your AI key in Account to get a critique. You can keep working in Do and Write.",
  aiUnreachable: "We couldn't reach your AI service. Your work is safe. Try again in a few minutes, or check your details in Account.",
  aiUnreadable: 'The AI sent a reply we could not read. Your work is safe. Please try again.',
  aiMinuteLimit: 'You are sending requests quickly. Please wait a minute, then try again. Your work is safe.',
  aiDailyLimit: 'You have reached today\'s free AI limit. It resets at midnight UTC (08:00 in China). Your work is safe, and you can keep working in Do and Write, or add your own AI key in Account.',
  guideNotSaved: "University guides can't be saved on this server yet. Your university's rules were not added.",
} as const;

export const aiUnavailable = (status: number) => `The AI service is unavailable right now (error ${status}). Your work is safe. Try again in a few minutes.`;

// Phase P4: one plain message for each kind of AI failure. They never contain a key, a model reply or thesis text.
export type AiCode =
  | 'timeout'
  | 'unreachable'
  | 'provider_down'
  | 'provider_rate_limited'
  | 'invalid_key'
  | 'no_credit'
  | 'model_not_found'
  | 'provider_rejected'
  | 'malformed'
  | 'site_minute_limit'
  | 'site_daily_limit';

const SAFE = 'Your text is still here, nothing was lost.';

export function aiFailure(code: AiCode, ownKey: boolean, retryAfter?: number): string {
  const wait = retryAfter && retryAfter > 0 ? (retryAfter <= 90 ? `about ${retryAfter} seconds` : `about ${Math.ceil(retryAfter / 60)} minutes`) : 'a minute';
  switch (code) {
    case 'timeout':
      return `The AI took too long to answer. ${SAFE} Try again; a shorter text is answered faster.`;
    case 'unreachable':
      return ownKey ? `${MESSAGES.aiUnreachable}` : `We couldn't reach the AI service. ${SAFE} Try again in a few minutes.`;
    case 'provider_down':
      return `The AI service is having problems right now. ${SAFE} Try again in a few minutes.`;
    case 'provider_rate_limited':
      return ownKey
        ? `Your AI provider says you have sent too many requests, or reached your plan's limit. ${SAFE} Wait ${wait}, then try again, or check your provider account.`
        : `The free AI is busy with many students right now. ${SAFE} Wait ${wait}, then try again. You can also add your own AI key in Account.`;
    case 'invalid_key':
      return ownKey
        ? `Your AI provider rejected this key. Check it in Account. ${SAFE}`
        : `The site's AI is not available because of a problem on our side. ${SAFE} You can add your own AI key in Account, or try again later.`;
    case 'no_credit':
      return ownKey
        ? `Your AI account has no credit left. Add credit with your provider, then try again. ${SAFE}`
        : `The site's free AI has no credit left right now. ${SAFE} You can add your own AI key in Account, or try again later.`;
    case 'model_not_found':
      return ownKey ? `Your AI provider did not find this model. Check its name in Account. ${SAFE}` : `The site's AI model is not available right now. ${SAFE} Try again later, or add your own AI key in Account.`;
    case 'provider_rejected':
      return `The AI service refused this request. ${SAFE} Try again; if it happens again, shorten the text.`;
    case 'malformed':
      return MESSAGES.aiUnreadable;
    case 'site_minute_limit':
      return `${MESSAGES.aiMinuteLimit.replace('Please wait a minute', `Please wait ${wait}`)}`;
    case 'site_daily_limit':
      return MESSAGES.aiDailyLimit;
  }
}
