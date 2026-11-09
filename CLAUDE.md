# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Pdf2Learn** (formerly StudyAI): a local-only web app that turns PDF textbooks into chapter summaries, quizzes, flashcards, an AI tutor, and Vietnamese text-to-speech. The original design doc is [AI-Study-PDF-Plan.md](AI-Study-PDF-Plan.md) (Vietnamese). The code has deliberately diverged from it in a few places, listed under "Deviations from the plan". User-facing text (UI, prompts, AI output, error messages) is Vietnamese.

## Stack and constraints

- `client/`: React 19 + TS + Vite, Tailwind v4 (`@tailwindcss/vite`, theme tokens in `src/index.css`, no tailwind.config), TanStack Query, Zustand, react-pdf, mermaid, recharts. Vite proxies `/api` → `localhost:5000`. No shadcn: shared primitives live in `src/components/ui.tsx`.
- `server/`: Express 5 + TS run with `tsx`/`nodemon`. It is ESM with NodeNext resolution, so relative imports must end in `.js`. Uses Sequelize + sequelize-cli, Zod and JWT. API prefix is `/api/v1`. Express 5 forwards async errors, so handlers just `throw new HttpError(status, msg)`.
- DB: works on **both MySQL 8 and MariaDB** (the dev machine now runs Laragon MySQL 8.4; it previously ran XAMPP MariaDB 10.4). Two consequences:
  - MariaDB returns JSON columns as strings, so the `json(field)` helper in `models/index.ts` parses them in a getter.
  - MariaDB rejects arithmetic on aggregate aliases in `ORDER BY`. Repeat the aggregate expression instead.
- `tts-service/`: a gitignored clone of VieNeu-TTS (Python, `uv`) with an OpenAI-compatible API at `localhost:8000/v1`.
- `vi-translate/`: a gitignored clone of [VI-Translate](https://github.com/breslee1707/VI-Translate) (layout-preserving PDF translator, AGPL) with a Python 3.12 `.venv`. Setup: `git clone https://github.com/breslee1707/VI-Translate vi-translate`, then `uv venv --python 3.12 .venv` and `uv pip install --python .venv/Scripts/python.exe -r requirements.txt` with `UV_CACHE_DIR`/`UV_PYTHON_INSTALL_DIR` under `.cache/` so drive C stays clean.
- AI: Gemini via `@google/genai`. Read `GEMINI_MODEL` and `GEMINI_API_KEY` from `env` in `server/src/config/env.ts` (validated; placeholder values like `your_key_here` count as unset). Never read `process.env` directly and never hardcode a model.
- **No Docker, no Redis/BullMQ.** Keep the backend to one Express process.

## Commands

```bash
npm run install:all          # root: install root + server + client deps
npm run dev:no-tts           # server (:5000) + client (:5173)
npm run dev                  # same + VieNeu TTS (needs tts-service/ cloned + uv sync)
cd server && npm run typecheck
cd server && npm test        # vitest (tests/unit.test.ts); single: npx vitest run -t "sm2"
cd server && npm run db:create && npm run db:migrate   # config in server/db.config.cjs
cd server && npm run seed:demo        # demo@studyai.local / demo123, fully processed sample doc (no Gemini needed)
cd server && npm run test:gemini -- file.pdf
cd client && npm run build   # tsc -b + vite build
```

Use `NODE_ENV=test` when importing `src/app.ts` in tests so it doesn't start listening.

## Architecture

**Workflow vs agent.** Document processing is a fixed, code-driven pipeline in `server/src/jobs/processDocument.ts`:
1. Read metadata and the bookmark tree with `pdfjs-dist`, then extract every page’s text once into `document_pages` (pdfjs reads PDFs with broken xref that pdf-lib cannot).
2. Split: bookmarks → `flattenOutline` (a top-level item longer than `MAX_CHAPTER_PAGES` with children is replaced by its children, e.g. Part → Chapter) → `pickStudyChapters` (drops cover/contents/index/appendix/review and sections < 3 pages). Fallbacks: Gemini reads the TOC from the first pages’ text (`page_offset` maps printed → PDF pages), then fixed 20-page chunks.
2b. **Roadmap** (`services/roadmap.service.ts`, step `roadmap`): chapters from step 2 become roadmap *sections* (`roadmap_sections`); each section is split into *lessons*, which are rows in `chapters` with `section_id`, `description`, `importance` (core/optional), `est_minutes`, `completed_at`. Lesson boundaries come from child bookmarks (`childBookmarks`), or from `headingCandidates` detected in page text when there are none. One Gemini call (`planRoadmap`) names, groups and annotates them in Vietnamese and is `sanitize`d into contiguous 3–15 page lessons; if that call fails, `deterministicPlan` is used instead. `POST /documents/:id/roadmap/rebuild` rebuilds the roadmap, which also wipes lessons and progress.
3. Upload does **no** summarization: the document is `done` once pages + chapters exist (seconds). Summaries are **lazy** (`services/chapterAnalysis.service.ts`): opening a chapter calls `POST /chapters/:id/analyze` → `analyzeFrom()` which (a) copies results from a twin document with the same `file_hash` (sha256) and same page range, 0 AI calls; (b) otherwise batches the opened chapter + following pending ones (`BATCH_MAX_CHAPTERS`, `BATCH_MAX_CHARS`) into **one** Gemini call (`analyzeChapterBatch`: markdown lesson `summaries.lesson_md` + summary + 5 questions per lesson); chapters the model omits fall back to single `analyzeChapter`. In-flight chapters share one promise; errors are kept in memory and returned as `analyze_error`. Flashcards come from `key_terms`. After upload the first batch is analyzed automatically. Content comes from `chapterSource()`/`chapterText()` (`services/ai/source.ts`): text with `[Trang N]` markers, or for scanned PDFs the old cut-with-pdf-lib + File API path (repairing via `scripts/repair_pdf.py`, uv + pikepdf, if needed). Re-uploading a known file also copies its pages and chapter ranges.

Only the tutor (`services/ai/tutor.agent.ts`) is an agent. It uses function calling with `generateContentStream` and is capped at 5 rounds. Tool `chapterId`s are checked against the session's document. `create_quiz` emits a `quiz` event that the client renders inline.

**Jobs without Redis.** `jobRunner` is an in-process FIFO with concurrency 1, deduplicated by key. `progressBus` is an EventEmitter, and the SSE endpoint `GET /documents/:id/progress` sends a DB snapshot as soon as a client connects. All state lives in the DB:
- `chapters.status` per chapter. A chapter that fails doesn't fail the document, and `POST /retry` re-queues only the failed chapters.
- `resumePendingDocuments()` runs on startup.
- Every pipeline step must stay idempotent: skip a step if its rows already exist.

**AI conventions.** All structured calls go through `generateJson()` in `gemini.client.ts`: `responseSchema` + Zod re-parse, one retry on bad JSON, usage logged to `ai_usage_logs`, `thinkingLevel` from `GEMINI_THINKING`, and a global semaphore (`aiSlot`, `GEMINI_CONCURRENCY`). `withRetry` retries 429/5xx but **not** daily-quota 429s (`isDailyQuotaError`); those go to `withModelFallback`, which marks the model exhausted until the next quota reset and moves to the next of `GEMINI_FALLBACK_MODELS`. When every model is exhausted it throws `QuotaExhaustedError`: the pipeline stops, leaves remaining chapters `pending`, and the API returns 429. The free tier is about 20 requests/day per model. JSON and Zod schemas live side by side in `services/ai/schemas.ts`; `QuizZod` drops invalid questions instead of failing the batch.

**Page numbers.** Always map AI page numbers through `src.toPage()` from `chapterSource`. In text mode, pages are absolute (`[Trang N]` markers, clamped to the chapter); in file mode, `toDocumentPage` converts chapter-relative pages. The UI’s "click page → open original PDF" depends on this.

**TTS path** (`services/tts/`):
- `normalizeForSpeech` → `splitSentences` → each sentence is keyed by `sha256(model+voice+text)` in `tts_audios`, with the file at `uploads/audio/<hash>.wav`.
- `ttsQueue` runs a single worker with priority (listening > prefetch) and deduplicates by hash. VieNeu on CPU returns 429 for parallel requests.
- `GET /tts/audio/:hash` is unauthenticated, because `<audio>` can't send headers and the hash isn't guessable. It **long-polls**: if the audio isn't ready, it bumps that sentence to high priority, waits, then serves the file with Range support. The client just sets `audio.src`.
- Cache eviction is LRU by `last_used_at`. An evicted row goes back to `pending` and is regenerated on demand.

**PDF translation** (`services/translate/`): the PdfViewer "Bản dịch" tab renders a Vietnamese PDF with the original layout. `pdfTranslate.service` works in 10-page chunks, on demand, one chunk at a time: cut the pages (`scripts/pdf_chunk.py`, PyMuPDF), run VI-Translate in **handoff** mode to emit segments, translate them in `segmentTranslator` (Google `translate.googleapis.com` gtx, many segments per request; on 429/redirect it pauses Google for 10 min and falls back to Gemini), then rebuild the PDF. Its own `translate.google.com/m` engine is not used because that endpoint is CAPTCHA-blocked on this network. `<bN>`/`<sN>` tags are kept by translating only the text between them. Output goes to `uploads/translated/<file_hash>/c<k>.pdf` and is shared across twin documents. The engine's cache/model live in `vi-translate/.home` (USERPROFILE override). TOC/index/scan pages are left in English by design. Without `vi-translate/.venv` the tab falls back to Gemini text translation (`translate.service.ts`, `page_translations`).

**Client audio.** `features/audio/playerStore.ts` holds one module-level `HTMLAudioElement`. The segment index drives the transcript highlight. `playAndWait()` powers the hands-free mode, and `append()` powers tutor auto-read, which splits streamed text into sentences and sends each to `/tts/speak`. `MiniPlayer` is mounted in `AppLayout`, so it survives route changes and owns the Space/←/→ shortcuts. Pages with their own Space handling (flashcards, hands-free) call `preventDefault`. `useTtsStatus()` hides every TTS control when the server is offline.

**Roadmap UI.** `DocumentPage` shows `RoadmapView` (vertical spine, sections as stations, lessons on both sides) when there is no `?chapter=` param, and the lesson view (tabs Bài giảng / Tóm tắt / Sơ đồ / Câu hỏi + `QuickCheck`) when there is one. `QuickCheck` grades on the client: ≥ 70% calls `POST /chapters/:id/complete`. `LessonBody` turns `(tr. N)` into buttons that open the PDF.

**Design language.** Minimal, Apple-like layout with a calm reading palette (`client/src/index.css` `@theme`). The `slate` scale is overridden with warm “paper” grays; `white` is `#fffdf9` and `black` is `#161615`, so nothing is pure white or pure black. `brand` is a muted sage-teal accent (#2f7563, 5.5:1 contrast). emerald, rose and amber are softened and used only for status. Icons come from `lucide-react`, never emoji. Buttons are pill-shaped, and only `primary` carries color. Cards have a hairline `black/[0.06]` border. Don’t add gradients or saturated colors. The landing animation is `features/landing/PdfToRoadmap.tsx` (CSS keyframes in `index.css`, respects reduced motion). The sidebar can be collapsed (stored in localStorage), and the logo links home.

**Auth and ownership.** Use `findOwnedDocument` / `findOwnedChapter` in `services/access.ts` for every `:id` route. A user who doesn't own the resource gets 404. SSE auth uses `?token=` (supported by the `auth` middleware); tutor streaming POSTs via `@microsoft/fetch-event-source`.

## Deviations from the plan

- Flashcards are derived from summary `key_terms`, not a separate AI call.
- Chapter boundary edits (`PATCH /documents/:id/chapters`) keep chapters whose page range is unchanged and re-process the rest.
- Voice cloning (`POST /tts/voices/clone`) is not implemented.
- The VieNeu API contract (`/health`, `/v1/voices`, `/v1/audio/speech`) is assumed from the plan, and `listVoices` accepts several response shapes. Verify against a real VieNeu server.

## Target machine

Ryzen 7 5700U, no discrete GPU. VieNeu runs v3 Turbo **fp32** on CPU. Never int8, because Zen 2 has no VNNI and int8 audio comes out distorted. The fallback is v3 Nano behind a FastAPI wrapper that keeps `/v1/audio/speech`.
