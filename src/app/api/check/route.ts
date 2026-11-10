import { fail } from '@/lib/api';

// Phase P2: Word Check runs in the student's browser (src/lib/browserCheck.ts). The server no longer accepts thesis
// files for checking, so no document, image or text is ever uploaded for it. A page still open from an earlier version
// that posts here is told to reload. The body is never read.
export async function POST() {
  return fail('Word Check now runs in your browser, and your file is no longer uploaded. Reload this page, then check your thesis again.', 410);
}
