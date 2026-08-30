# Project Notes — Aviation Safety Watch

## Session: Aug 21, 2026

### Done
- Fixed JSX corruption in `app/about/how-to-use/page.tsx` (unclosed style block,
  orphaned `</h1>`). Had been failing EVERY production build since Apr 16. About
  page now live.
- Committed `lib/ntsb-import.js` and `test-fileexport.js` — previously existed
  only on the laptop, never backed up.
- Rotated Neon DB password (leaked into chat). Neon–Vercel integration
  auto-synced the new value; only a redeploy was needed.
- Created Neon `dev` branch off `main`. Full data copy, auto-delete: never.
- Working on git branch `multi-source`.

### Still to rotate (were exposed)
- `BLOB_READ_WRITE_TOKEN`
- `RESEND_API_KEY`  ← highest priority, can send as verified domain
- Upstash KV token
- `CRON_SECRET`

### Next task
Create `lib/db-url.js`:

    module.exports.getConnectionString = function () {
      return process.env.DEV_DATABASE_URL
        || process.env.DATABASE_URL
        || process.env.POSTGRES_URL;
    };

Then update 4 call sites to use it:
- `app/api/accidents/route.ts:13`
- `app/api/accidents/data/route.ts:9`
- `app/api/sync-ntsb/route.ts:52`
- `lib/ntsb-import.js:108`

Then add `DEV_DATABASE_URL` in Vercel, scoped to **Preview only**, pointing at
the Neon `dev` branch connection string.

### Two findings not to lose
1. `NTSB_CASES_BY_DATE_BASE` in `.env.local` points at
   `GetAviationDataDictionary` — returns field metadata, NOT cases. Likely why
   the nightly cron has silently failed. Should be `GetCasesByDateRangeV2`.
2. NTSB `FileExport` returns a ZIP. `test-fileexport.js` extracts it with the
   macOS `unzip` shell command — that does not exist in Vercel serverless. The
   cron version needs JavaScript-based unzipping.

### Roadmap
1. `lib/db-url.js` + 4 call sites  ← next
2. Schema migration: `source`, `source_id`, `raw_data JSONB`, `geocode_status`
   (run on `dev` first)
3. Parser rewrite for new NTSB format (PascalCase, bare array, omitted-not-null
   fields, ISO-2 country codes)
4. Switch dedup to UPSERT on `(source, source_id)` — 496/990 records are
   "Ongoing" and will gain ProbableCause later; current insert-only logic
   freezes them permanently
5. Cron via `GetCasesByDateRangeV2`. Ingest and geocode must be SEPARATE passes
   — Nominatim is 1 req/sec, ~250 geocodes won't fit in one Hobby invocation
6. Canadian data via TSB ASIS (monthly CSVs). NOT CADORS — too low a severity
   threshold, would swamp the map

### Key lessons
- Copy-paste into VS Code corrupts `.tsx` files. Use Claude Code instead.
- `npm run build` catches errors locally in ~1 min. Run it before every commit.
- Silent failures are the pattern here: the cron, the endpoint, the build all
  failed with no visible error. Verify end-to-end, not just that it ran.
- SQL runs in the Neon SQL Editor (browser), NOT the terminal.

### Environment
- Vercel: Hobby. Neon: Launch, 0.33 GB used, 3.22 GB free.
- Neon project `aviation-accidents`, branches `main` (prod) + `dev`
- All DB env vars in Vercel are Neon-integration-managed (green badge) and set
  to All Environments — do not hand-edit them, they get overwritten on sync.