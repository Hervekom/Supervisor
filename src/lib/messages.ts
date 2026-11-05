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
  aiDailyLimit: 'You have reached today\'s free AI limit. It resets tomorrow. Your work is safe, and you can keep working in Do and Write, or add your own AI key in Account.',
  guideNotSaved: "University guides can't be saved on this server yet. Your university's rules were not added.",
} as const;

export const aiUnavailable = (status: number) => `The AI service is unavailable right now (error ${status}). Your work is safe. Try again in a few minutes.`;
