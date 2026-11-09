# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Pdf2Learn** (formerly StudyAI): a local-only web app that turns PDF textbooks into chapter summaries, quizzes, flashcards, an AI tutor, and layout-preserving Vietnamese translation of the PDF. (Vietnamese text-to-speech was removed on 2026-11-09 to keep the app light; migration `20261109000007-drop-tts` drops its tables.) The original design doc is [AI-Study-PDF-Plan.md](AI-Study-PDF-Plan.md) (Vietnamese). The code has deliberately diverged from it in a few places, listed under "Deviations from the plan". User-facing text (UI, prompts, AI output, error messages) is Vietnamese.

## Stack and constraints

- `client/`: React 19 + TS + Vite, Tailwind v4 (`@tailwindcss/vite`, theme tokens in `src/index.css`, no tailwind.config), TanStack Query, Zustand, react-pdf, mermaid, recharts. Vite proxies `/api` → `localhost:5000`. No shadcn: shared primitives live in `src/components/ui.tsx`.
- `server/`: Express 5 + TS run with `tsx`/`nodemon`. It is ESM with NodeNext resolution, so relative imports must end in `.js`. Uses Sequelize + sequelize-cli, Zod and JWT. API prefix is `/api/v1`. Express 5 forwards async errors, so handlers just `throw new HttpError(status, msg)`.
- DB: works on **both MySQL 8 and MariaDB** (the dev machine now runs Laragon MySQL 8.4; it previously ran XAMPP MariaDB 10.4). Two consequences:
  - MariaDB returns JSON columns as strings, so the `json(field)` helper in `models/index.ts` parses them in a getter.
  - MariaDB rejects arithmetic on aggregate aliases in `ORDER BY`. Repeat the aggregate expression instead.
- `vi-translate/`: a gitignored clone of [VI-Translate](https://github.com/breslee1707/VI-Translate) (layout-preserving PDF translator, AGPL) with a Python 3.12 `.venv`. Setup: `git clone https://github.com/breslee1707/VI-Translate vi-translate`, then `uv venv --python 3.12 .venv` and `uv pip install --python .venv/Scripts/python.exe -r requirements.txt websocket-client==1.9.0` with `UV_CACHE_DIR`/`UV_PYTHON_INSTALL_DIR` under `.cache/` so drive C stays clean.
- AI: Gemini via `@google/genai`. Read `GEMINI_MODEL` and `GEMINI_API_KEY` from `env` in `server/src/config/env.ts` (validated; placeholder values like `your_key_here` count as unset). Never read `process.env` directly and never hardcode a model.
- **No Docker, no Redis/BullMQ.** Keep the backend to one Express process.

## Commands

```bash
npm run install:all          # root: install root + server + client deps
npm run dev                  # server (:5000) + client (:5173)
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

**PDF translation** (`services/translate/`): the PdfViewer "Bản dịch" tab renders a Vietnamese PDF with the original layout. `pdfTranslate.service` works in 10-page chunks, on demand, one chunk at a time, and prefetches the next chunk in the background (a chunk the user opens jumps ahead of prefetches). Each chunk is cut with `scripts/pdf_chunk.py` (PyMuPDF), then:
1. **Primary:** VI-Translate's Google engine with `--google-browser`, like its desktop app. It drives the installed Edge/Chrome, so Google sees a real browser; on CAPTCHA a browser window opens for the user to solve. No Gemini quota is used. Progress comes from tqdm on stderr (pages). Needs `websocket-client` in the venv (from `requirements-app.txt`).
2. **Fallback** (not used for prefetch, to save quota): **handoff** mode. The engine emits segments, `segmentTranslator` translates them (Google `translate.googleapis.com` gtx in batches; on 429/redirect it pauses Google for 10 min and uses Gemini in ~20k-char groups), then the engine rebuilds the PDF. `<bN>`/`<sN>` tags are kept by translating only the text between them. Any failed group fails the chunk instead of caching a half-English PDF.

Output goes to `uploads/translated/<file_hash>/c<k>.pdf`, shared across twin documents. The engine's cache, layout model and browser profile live in `vi-translate/.home` (USERPROFILE override, keeps drive C clean). TOC/index/scan pages stay in English by design. Without `vi-translate/.venv` the tab falls back to Gemini text translation (`translate.service.ts`, `page_translations`).

**Roadmap UI.** `DocumentPage` shows `RoadmapView` (vertical spine, sections as stations, lessons on both sides) when there is no `?chapter=` param, and the lesson view (tabs Bài giảng / Tóm tắt / Sơ đồ / Câu hỏi + `QuickCheck`) when there is one. `QuickCheck` grades on the client: ≥ 70% calls `POST /chapters/:id/complete`. `LessonBody` turns `(tr. N)` into buttons that open the PDF.

**Design language.** Minimal, Apple-like layout with a calm reading palette (`client/src/index.css` `@theme`). The `slate` scale is overridden with warm “paper” grays; `white` is `#fffdf9` and `black` is `#161615`, so nothing is pure white or pure black. `brand` is a muted sage-teal accent (#2f7563, 5.5:1 contrast). emerald, rose and amber are softened and used only for status. Icons come from `lucide-react`, never emoji. Buttons are pill-shaped, and only `primary` carries color. Cards have a hairline `black/[0.06]` border. Don’t add gradients or saturated colors. The landing animation is `features/landing/PdfToRoadmap.tsx` (CSS keyframes in `index.css`, respects reduced motion). The sidebar can be collapsed (stored in localStorage), and the logo links home.

**Auth and ownership.** Use `findOwnedDocument` / `findOwnedChapter` in `services/access.ts` for every `:id` route. A user who doesn't own the resource gets 404. SSE auth uses `?token=` (supported by the `auth` middleware); tutor streaming POSTs via `@microsoft/fetch-event-source`.

## Deviations from the plan

- Flashcards are derived from summary `key_terms`, not a separate AI call.
- Chapter boundary edits (`PATCH /documents/:id/chapters`) keep chapters whose page range is unchanged and re-process the rest.
- Text-to-speech (VieNeu) was built, then removed.

## Target machine

Ryzen 7 5700U, no discrete GPU, Windows. Python tools run on CPU; keep heavy caches on drive D (drive C is tight).
