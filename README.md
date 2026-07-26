# HR Annual Physical Form Tracker

Build order from the spec:
- **Step 1:** data model, CSV import, token generation, email send (status → `sent`)
- **Step 2:** the employee-facing `/physical/{token}` page — pick a language,
  download the blank form, enter your name/email and upload the completed
  one, status → `received`. Once uploaded, the document previews inline next
  to the form.
- **Step 4 (partial):** a secured `/dashboard` — status table only so far, no
  per-record file view or resolve/resend actions yet. Auth defaults to a
  local dev bypass (`AUTH_MODE=mock`); swap to `AUTH_MODE=entra` once a real
  Entra ID app registration exists.

Verification (step 3) and resend/re-upload-reset flows (step 5) are not built
yet.

See [DEPLOYMENT.md](DEPLOYMENT.md) for getting this running on Azure App
Service.

## Prerequisites

- Node.js 20+ and npm
- Docker (for local SQL Server + Azurite, matching Azure SQL and Blob Storage)

## Setup

```bash
npm install
cp .env.example .env    # then fill in as needed, see below
docker compose up -d    # starts local SQL Server (1433) + Azurite blob emulator (10000)
npx prisma migrate dev  # creates the schema
```

By default `EMAIL_MODE=mock`, so no Entra/Graph credentials are required to
try this locally — sends are logged to the console instead. Set
`EMAIL_MODE=graph` and fill in `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` /
`AZURE_CLIENT_SECRET` once an Entra app registration with an application-level
`Mail.Send` permission (admin-consented) exists.

`AZURE_STORAGE_CONNECTION_STRING` defaults to Azurite's well-known, publicly
documented dev account key — safe to leave as-is for local dev, replace with a
real Azure Storage connection string in prod.

`AUTH_MODE` defaults to `mock` (a "Dev Sign-In" button, no real credential
check — the app refuses to start this way if `NODE_ENV=production`). Set
`AUTH_MODE=entra` and fill in the four `ENTRA_*` vars once a real Entra ID app
registration exists; `HR_GROUP_OBJECT_ID` optionally restricts dashboard
access to one security group.

## Running an import (step 1)

```bash
npm run import-cycle -- --file ./employees.csv --year 2026 --uploaded-by "your.name@standardnutrition.com"
```

CSV columns: `full_name` (or `name`), `email`, and optionally
`employee_id_external` (or `employee_id`). Re-running the same file/year is
safe — employees who already have a record for that `cycleYear` are left
untouched, so it won't reset in-progress statuses or resend emails. In
`EMAIL_MODE=mock`, the console log for each send includes the link with the
raw token — use one of those to try the step 2 page below.

## Running the employee-facing server (step 2)

```bash
npm run dev
```

Serves `http://localhost:3000/physical/{token}`. The page:
- always offers both form languages for download
  (`GET /physical/{token}/download?lang=en|es`, streamed from
  `assets/forms/wellness-exam-{en,es}.pdf`)
- collects the employee's First Name, Last Name, and Email (all required)
  alongside the file on upload (`POST /physical/{token}/upload`, field name
  `form`; PDF/JPG/PNG, capped at `MAX_UPLOAD_MB`) — stored on the record
  separately from the CSV-sourced employee identity, since the person
  uploading might not be the only one with access to the link
- once uploaded, previews the document inline next to the form
  (`GET /physical/{token}/uploaded-file` — `<img>` for JPG/PNG, the browser's
  native PDF viewer via `<iframe>` for PDFs)
- shows a blocked page (no download/upload) once `status = 'completed'`, or
  once the token is past `tokenExpiresAt`
- is rate-limited (60 requests / 15 min per IP) per the spec's
  token-enumeration note

## HR dashboard (step 4, partial)

Same `npm run dev` server. Visit `http://localhost:3000/dashboard` —
unauthenticated requests redirect to `/auth/login`. In the default
`AUTH_MODE=mock`, click "Sign in as Dev HR User" (no real credential check);
in `AUTH_MODE=entra`, this redirects to a real Microsoft sign-in. Once in,
`/dashboard?year=2026&status=received` shows every employee's status for that
cycle with sent/received/completed timestamps, filterable by status. Nothing
else yet — no per-record file view, no resend/resolve actions.

## Tests

```bash
npm test
```

37 tests across token generation/hashing, CSV parsing, the import service's
orchestration + idempotency, token validation, the `/physical/*` routes, and
the `/dashboard` + `/auth` routes (via `supertest` against the Express app
with a fake Prisma client and a fake blob storage backend) — none require a
live database, SQL Server, or Azurite.

## What's verified

Confirmed against a live local environment (Docker SQL Server + Azurite), not
just fakes/mocks:
- `docker compose up -d` + `npx prisma migrate dev` against a real SQL Server,
  including the round-3 migration adding the identity/preview columns
- A full `import-cycle` run producing a real token, then hitting the running
  server for real: unknown token → 404, valid token page → 200, both English
  and Spanish downloads byte-for-byte match the source PDFs, a real upload
  with identity fields → 303 redirect with all fields persisted, and the
  preview route serving byte-identical content back (`curl` diff against the
  source file) — image preview confirmed rendering correctly in a real
  browser; PDF preview confirmed correct at the HTTP/byte level, though this
  sandbox's own headless test browser doesn't render inline PDFs (no working
  PDF viewer plugin) — a real browser (Chrome/Safari/Edge/Firefox) does
- The real logo (`assets/branding/logo-horizontal.png`) rendering correctly
  in both light and dark mode
- The full dashboard auth flow: unauthenticated redirect → dev sign-in →
  authenticated status table with real seeded data → status filter working
- `npm install` / `npm audit`: 0 vulnerabilities; `tsc --noEmit` / `npm run
  build` clean; all 37 tests pass

Still not verified (no Entra app registration / real Azure Storage account
available yet):
- A real Microsoft Graph send (`EMAIL_MODE=graph`)
- Swapping `AZURE_STORAGE_CONNECTION_STRING` to a real Azure Storage account
- Real Entra ID SSO (`AUTH_MODE=entra`) — the code path exists
  (`src/routes/auth.ts`, `@azure/msal-node`) but has only been exercised via
  the mock-mode dev bypass

One real bug this caught: `@azure/storage-blob` sends a newer API version
than the Azurite emulator image supports, and the original code called
`createIfNotExists()` in the constructor without anything awaiting it —
Node treated the rejection as an unhandled promise rejection and killed the
whole server on startup. Fixed by (1) adding `--skipApiVersionCheck` to the
`azurite` service in `docker-compose.yml`, and (2) deferring container
creation to first upload inside `uploadForm()`, so a real failure surfaces as
an ordinary rejected request instead of crashing the process.

## Branding

The employee-facing page, dashboard, and outgoing email use the **Standard
Nutrition Company** brand (the parent-company palette/type/logo from `SNC
Brand Guidelines_Approved.pdf` and the uploaded
`®Standard_Nutrition_Company_Logo_3C_CMYK.ai` — not one of the six sub-brand
variants also covered in the guidelines document):
- Colors: Red `#DA291C` (PMS 485C), Dark Red `#9A3324` (PMS 484C), Black
  `#2C2A29` (PMS BlackC), plus light tints of each for backgrounds/callouts
- Fonts: Ubuntu (Google Font) for the web pages — Bold for headlines, Regular
  for body, per the guide's usage rules; Arial for the email, since email
  clients strip web fonts and Arial is the guide's own sanctioned fallback
  for exactly that situation
- Logo: the real barn-and-silo mark, at `assets/branding/logo-horizontal.png`
  (`logo-icon.png` and `favicon.png` also generated). The source `.ai` file
  turned out to be PDF-compatible; this sandbox has no system PDF renderer,
  so `PyMuPDF` (installed via `pip`, an official self-contained Python
  package — not a third-party binary) rasterized it at high resolution.
  Because the logo has fixed black/gray text baked into the raster, it's
  wrapped in a small white background chip (`.brand-logo-wrap` in
  `src/views/layout.ts`) so it stays legible in dark mode, where the text
  itself can't invert.
- Shared shell: `src/views/layout.ts` holds the brand header/footer/styles
  once; both `physicalPage.ts` and `dashboardPage.ts` consume it, so there's
  one place brand changes happen instead of two copies drifting apart (this
  is also what fixed an earlier bug where the hand-built text wordmark had
  an inconsistent typeface between words).

## Notable design choices

- **Token storage:** only a SHA-256 hash of each token is persisted
  (`tokenHash`); the raw token exists only in the outgoing email link/URL. A
  database read alone can't be used to forge a valid employee link.
- **No Prisma enum for `status`:** Prisma's `sqlserver` connector doesn't
  support native enums, so `physical_records.status` is a plain string
  constrained by `src/lib/status.ts` at the application layer instead.
- **Synchronous email send, no queue yet:** sends happen in a loop during the
  CLI run rather than through a background queue/worker — matches step 1's
  scope; a proper queue is a natural addition once step 3's verification job
  exists.
- **Static forms aren't in Blob Storage:** the two downloadable templates
  (`assets/forms/wellness-exam-{en,es}.pdf`) are bundled app assets, not blob
  data — they're fixed and non-sensitive, unlike each employee's uploaded
  form, which does go to Blob Storage.
- **Uploaded blob paths use a random UUID, not the original filename:**
  `uploads/{cycleYear}/{physicalRecordId}/{timestamp}-{uuid}.{ext}` avoids any
  path-traversal/injection surface from a user-supplied filename, and keeps
  the employee's local filename out of storage paths.
- **`router.param("token", ...)` centralizes token validation** for all
  `/physical/:token*` routes in one place (`src/routes/physical.ts`), and runs
  before `multer` parses an upload body — so an invalid/expired/completed
  token is rejected without buffering a file into memory first.
- **Upload allowed pre-`completed`:** an employee can re-upload while status
  is `sent`, `received`, or `needs_review` (to fix a mistake before HR
  finishes reviewing); only `completed` blocks both download and upload
  entirely, per the spec.
- **Uploader identity is captured separately from the CSV-sourced employee
  record:** `uploaderFirstName`/`uploaderLastName`/`uploaderEmail` on
  `PhysicalRecord` reflect what was typed in at upload time, not necessarily
  matching `Employee.fullName`/`email` — useful if a link gets forwarded or
  someone fills it out on a colleague's behalf.
- **`uploadedBlobPath`/`uploadedContentType` are stored alongside
  `uploadedFileUrl`** so the preview/download route can re-fetch the blob
  directly, rather than parsing a blob URL back into a path.
- **Auth follows the same mock/real swap pattern as email and blob
  storage:** `AUTH_MODE=mock` (dev bypass, refuses to boot if
  `NODE_ENV=production`) vs. `AUTH_MODE=entra` (`@azure/msal-node`,
  authorization code flow, optional HR-group check via the ID token's
  `groups` claim) — same file/shape as `EMAIL_MODE` in `src/config/env.ts`.
- **Dashboard sessions use `express-session`'s default in-memory store,**
  fine for a single dev instance but not for a multi-instance Azure App
  Service deployment — swapping to a shared store (Redis, or Azure Table
  Storage) is a prerequisite for scaling the dashboard past one instance.

## Not yet built (later steps per the spec)

- Verification job (LLM-vision or Document Intelligence) → `completed` /
  `needs_review` (step 3) — the upload route has a single comment marking
  where this hooks in
- Rest of the HR dashboard (step 4): per-record file view, mark
  `needs_review` completed/rejected, resend link, CSV export
- Resend-link / re-upload-reset flows (step 5)
- Audit logging of *HR* access to uploaded files — meaningful once the
  dashboard has a per-record file view to log access to
