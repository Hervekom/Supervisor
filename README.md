# Supervisor

Guides a student step by step from choosing a topic to submitting the final thesis. The student writes; Supervisor explains each step, reviews the work, checks it against university rules and keeps a record of AI use.

## Run it

Requires Node.js 22.

    npm install
    copy .env.example .env
    npm run dev

Open http://localhost:3000.

My path and Check work without any AI model. Supervisor reviews, Feedback and guide import need these settings in `.env`:

- `LLM_BASE_URL`: an OpenAI-compatible endpoint
- `LLM_API_KEY`
- `LLM_MODEL`

## Layout

- `data/schema`: universal profile schema
- `data/profiles`: one JSON profile per university
- `src/lib/docx.ts`: Word file reader
- `src/lib/check.ts`: rule checks, bound to profile keys
- `src/lib/path.ts`: the guided steps, from topic to final submission
- `src/lib/coach.ts`: step coaching, which never writes for the student
- `src/lib/feedback.ts`: supervisor feedback, which never writes for the student
- `src/lib/references.ts`: Crossref lookup
- `src/lib/profiles.ts`: profile storage and guide import

To add a check, add a function under its key in `CHECKS`. Rules without a check appear in the manual list.

## Before going public

- Limit who can change shared profiles. Any signed-in user can do this today.
- Thesis files are read in memory and are not stored. Student progress is stored in Supabase with row level security. University profiles are files in `data/profiles`, so guide import needs database storage on a read-only host.
- Test the AI prompts with the chosen model.
- Have the NUIST profile reviewed. Its status is `extracted`.

## Database

The schema is in `supabase/migrations`. The publishable key in `.env.production` is meant to be public. Never add a secret key to this repository.

## Test

    npm test

Tests that need official university files skip when `tests/fixtures` is empty. Those files are not published in this repository.
