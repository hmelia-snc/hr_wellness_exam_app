# Deploying to Azure

This has been run end-to-end against a real Azure subscription
(`snc-wellness-exam-verification.azurewebsites.net`, `centralus`) and is
live. (Originally provisioned as `hr-physical-tracker.azurewebsites.net`;
migrated to a new App Service on the same plan/database/storage so no
employee-facing wording says "physical tracker" — see "URL/hostname
migration" below. The old hostname is being kept running, frozen at its
last deployed build, purely so any already-issued-but-unused links from
before the migration keep working until they expire.) A few
real issues turned up along the way that aren't obvious from the docs —
see "Known limitations" at the bottom, and the provisioning script/workflow
already reflect the fixes (Node runtime version, Basic Auth publishing
credentials, `NPM_CONFIG_PRODUCTION=false`).

## 0. Prerequisites

- An Azure subscription, `az` CLI installed and `az login` done
- This repo pushed to a GitHub repository (see "Git" section below if it
  isn't yet)

## 1. Provision Azure resources

```bash
./deploy/provision-azure.sh
```

Edit the variables at the top of the script first (resource group name,
region, app name — several must be **globally unique** across all of Azure,
the script has comments marking which). Creates: an App Service plan + Linux
Node 20 web app, an Azure SQL logical server + database + firewall rule, a
Storage account + private blob container, a Document Intelligence resource
(OCR verification of uploaded forms, free F0 tier), and sets most of the App
Service Application Settings automatically (`DATABASE_URL`,
`AZURE_STORAGE_CONNECTION_STRING`, `SESSION_SECRET`,
`DOCUMENT_INTELLIGENCE_ENDPOINT`/`KEY`, etc. — all generated or fetched
locally, never written to disk or committed).

It intentionally does **not** create the Entra ID app registrations (step 2)
or set the settings that depend on them — those are Portal-driven steps that
don't script cleanly (admin consent has to be clicked).

## 2. Create the two Entra ID app registrations

These can be the same app registration configured with both permission types
below, or two separate ones — separate is cleaner if different people manage
"can send mail as HR" vs. "can sign in to the dashboard."

**A. Graph mail-send app** (Entra ID → App registrations → New registration):
1. Register the app (any name, e.g. "HR Wellness Exam Verification — Mail").
2. API permissions → Add → Microsoft Graph → **Application permissions** →
   `Mail.Send` → Add, then **Grant admin consent** (needs a tenant admin).
3. Certificates & secrets → New client secret → copy the value immediately.
4. Set on App Service: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
   `AZURE_CLIENT_SECRET` from this registration.

**B. Dashboard SSO app:**
1. Register the app (e.g. "HR Wellness Exam Verification — Dashboard").
2. Authentication → Add a platform → Web → redirect URI:
   `https://<APP_NAME>.azurewebsites.net/auth/callback` (the exact value the
   provisioning script printed as `ENTRA_REDIRECT_URI`).
3. API permissions → Microsoft Graph → **Delegated permissions** →
   `User.Read` (usually already present by default).
4. Certificates & secrets → New client secret → copy the value.
5. Set on App Service: `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`,
   `ENTRA_CLIENT_SECRET`, `ENTRA_REDIRECT_URI`.
6. Optional: to restrict the dashboard to an HR security group:
   ```bash
   # Find the group's Object ID
   az ad group list --display-name "<Group Display Name>" --query "[].{displayName:displayName, id:id}" -o table

   # The app registration must emit a groups claim in the ID token
   az ad app update --id <ENTRA_CLIENT_ID> --set groupMembershipClaims=SecurityGroup

   # Then set the group's Object ID on App Service and restart
   az webapp config appsettings set --name <APP_NAME> --resource-group <RESOURCE_GROUP> \
     --settings HR_GROUP_OBJECT_ID=<group-object-id>
   az webapp restart --name <APP_NAME> --resource-group <RESOURCE_GROUP>
   ```
   Without `HR_GROUP_OBJECT_ID` set, any authenticated tenant user can sign
   in. Note: Azure AD only includes direct group membership in the token up
   to 200 groups per user — an unlikely edge case for a small tenant, but
   worth knowing if a user is in an unusually large number of groups.

Set all of these via the Portal (App Service → Configuration) or:
```bash
az webapp config appsettings set --name <APP_NAME> --resource-group <RESOURCE_GROUP> \
  --settings AZURE_TENANT_ID=... AZURE_CLIENT_ID=... AZURE_CLIENT_SECRET=... \
             ENTRA_TENANT_ID=... ENTRA_CLIENT_ID=... ENTRA_CLIENT_SECRET=... \
             ENTRA_REDIRECT_URI=...
```

## 3. Git (if not already pushed)

No git repo existed in this project as of this writing. If that's still true:

```bash
cd "HR App"
git init
git add .
git commit -m "Initial commit"
```

Then create an empty repository on GitHub (github.com → New repository —
don't initialize it with a README/license, to avoid a merge conflict with
this history), and:

```bash
git remote add origin git@github.com:<your-org>/<your-repo>.git
git branch -M main
git push -u origin main
```

## 4. Wire up GitHub Actions

The workflow at `.github/workflows/deploy.yml` builds, tests, and deploys on
every push to `main`. It needs:
- A repo **secret** named `AZURE_WEBAPP_PUBLISH_PROFILE` — get its value
  with `az webapp deployment list-publishing-profiles --name <APP_NAME>
  --resource-group <RESOURCE_GROUP> --xml` (the provisioning script prints
  this exact command), paste the full XML output as the secret value.
- A repo **variable** named `AZURE_WEBAPP_NAME` set to your app name.

(GitHub repo Settings → Secrets and variables → Actions → both "Secrets" and
"Variables" tabs.)

Azure App Service's Oryx build system does the real `npm install` / `npm run
build` on the server side after the deploy lands (that's what
`SCM_DO_BUILD_DURING_DEPLOYMENT=true`, set by the provisioning script,
enables) — the `npm run build`/`npm test` steps in the GitHub Actions
workflow are a CI gate that fails fast on broken code before it ever reaches
Azure, not literally what gets deployed.

`npm start` (`package.json`) runs `prisma migrate deploy` before starting the
server, so schema migrations apply automatically on every deploy/restart —
no separate migration step needed in CI, and the GitHub Actions runner never
needs network access to the database.

## 5. First push

```bash
git push origin main
```

Watch the Actions tab on GitHub for the run, then check
`https://<APP_NAME>.azurewebsites.net/healthz` (should return `ok`) and
`https://<APP_NAME>.azurewebsites.net/` (should show the home page with the
HR Dashboard link).

## OCR verification of uploaded forms

Uploaded forms are automatically checked via Azure AI Document Intelligence
(`VERIFICATION_MODE=azure`, set by the provisioning script): the employee's
upload gets OCR'd with the prebuilt "read" model right after it lands, and
the record auto-transitions to `completed` or `needs_review` based on three
presence checks (`src/lib/verification/azureVerifier.ts`):

1. **Correct form** — the OCR'd text contains a recognizable heading from
   the actual Wellness Exam Verification Form (English or Spanish).
2. **Date populated** — a filled-in date pattern is present, ignoring the
   form's own printed instructional date range ("*must be between
   1/1/26-12/31/26"), which would otherwise make even a blank upload look
   like it had a date.
3. **Signature present** — a contiguous handwritten-style span of at least
   3 characters was detected (a proxy for "was this actually signed," not
   real signature verification). Single-character noise — e.g. a stray
   character from the unfilled date field's underscore/slash placeholder
   getting misread as handwritten — is filtered out; a genuine signature is
   virtually always more than a couple characters.

All three are heuristics confirmed against a real Document Intelligence call
on the actual blank template (not just unit tests) — that live smoke test is
in fact what caught both the instructional-date-range and single-character
noise false positives above before they shipped. False positives/negatives
are still expected in general use, though: a `needs_review` record shows the
specific failing reason(s) as a tooltip on its status badge on the
dashboard, and HR can resolve it with the **Approve** button (stamps
`reviewedBy`/`reviewedAt` with the signed-in HR user) without needing to
make the employee re-upload — or open the uploaded file directly from the
dashboard's **View file** link to judge it themselves first.

This runs fire-and-forget after the employee's upload request already got
its response, so OCR latency (a few seconds) never makes them wait. It's
still v1 scope deliberately: presence checks, not per-field extraction (no
validation that the *name* on the form matches the employee, or that the
*date* falls within the right cycle year).

Local dev defaults to `VERIFICATION_MODE=mock` (`src/lib/verification/mockVerifier.ts`):
every upload auto-passes with no real OCR call, so the full dashboard flow
still works without needing Document Intelligence credentials. Real Azure
verification needs `DOCUMENT_INTELLIGENCE_ENDPOINT`/`DOCUMENT_INTELLIGENCE_KEY`,
which the provisioning script generates automatically (F0 free tier: 500
pages/month, well above what one company's annual physical cycle needs).

## File access audit log and CSV export

Every time an uploaded form is viewed — HR opening it from the dashboard's
**View file**/**View spouse file** links, or the employee viewing their own
upload on their `/wellness-exam/:token` page — a row is written to the
`file_access_logs` table (`src/services/fileAccessLog.ts`): who viewed it
and when. There's no UI to browse this yet; query the table directly if an
audit trail is ever needed. It's deliberately not foreign-keyed to
`physical_records`, so the trail survives even a full employee purge
(`deleteEmployee`) rather than being deleted along with it.

The dashboard's **Export CSV** link (`GET /dashboard/export`) downloads the
currently-filtered status table (respecting the `year`/`status` query
params) as a CSV, including the verification result column.

## Layout fix: `wide` pages were silently capped at 640px

Found while working on the roster table: `body` had `max-width: 640px` and
`main.wide` had `max-width: 960px`, but since `main` is a block child of
`body`, its own larger max-width could never actually take effect — a
child's max-width can only shrink it below its containing block's width,
never grow past it. Every "wide" page (the HR dashboard, Manage Employees)
had been silently rendering at 640px this whole time. Fixed by moving the
width/centering styles from `body` onto `main` directly
(`src/views/layout.ts`).

## URL/hostname migration: hr-physical-tracker → snc-wellness-exam-verification

All employee-facing wording ("Physical"/"Physical Tracker") was renamed to
"Wellness Exam Verification" — matching the actual printed heading on
`assets/forms/wellness-exam-{en,es}.pdf` — in emails, the employee upload
page, and the home page. Since that text also showed up in the App
Service's own hostname, the app was migrated to a new App Service:

- **New**: `snc-wellness-exam-verification.azurewebsites.net`
- **Old**: `hr-physical-tracker.azurewebsites.net` (kept running, frozen at
  its last deployed build — not decommissioned)

Azure App Service names are permanent once created and globally unique
across all of Azure, so this wasn't an in-place rename — it was: provision
a new App Service on the **same** App Service Plan (`hrapp-plan`), copy
every app setting across (`APP_BASE_URL`/`ENTRA_REDIRECT_URI` updated to
the new hostname, everything else — `DATABASE_URL`,
`AZURE_STORAGE_CONNECTION_STRING`, Document Intelligence/Graph
credentials — copied as-is so both apps share the same data), add the new
hostname's `/auth/callback` and `/auth/login` as additional redirect URIs
on the Entra dashboard SSO app registration (alongside the old ones, not
replacing them), and repoint the GitHub Actions `AZURE_WEBAPP_NAME`
variable and `AZURE_WEBAPP_PUBLISH_PROFILE` secret at the new app.

The employee-facing route path also changed, from `/physical/:token` to
`/wellness-exam/:token`, so no part of an emailed link says "physical"
either.

**The old App Service was deliberately left running, not stopped or
deleted.** Any physical-form link already emailed before this migration
still points at the old hostname and the old `/physical/:token` path —
since both apps share the same database, those old links keep working
against the old app's still-deployed (pre-rename) build until they
naturally expire (`TOKEN_EXPIRY_DAYS`, 30 days by default). Once you're
confident no old links are still outstanding, the old App Service
(`hr-physical-tracker`) can be stopped or deleted — that's a deliberate
manual step, not automated here, since deleting a resource other software
depends on is exactly the kind of action that shouldn't happen without an
explicit go-ahead.

## Known limitations to revisit before real production traffic

- **Session store is in-memory** (`express-session`'s default). Fine for one
  App Service instance; breaks (users get logged out) if the app scales to
  multiple instances or restarts. Move to a shared store (Azure Cache for
  Redis + `connect-redis` is the natural choice) before scaling past one
  instance — deliberately not done in this round.
- **Rate limiting is also in-memory** (`express-rate-limit`'s default
  store) — same multi-instance caveat, lower stakes than sessions.
- **`AUTH_MODE=mock` refuses to boot when `NODE_ENV=production`** — this is
  intentional (`src/config/env.ts`), not a bug. If the app won't start in
  Azure, check that `AUTH_MODE=entra` and all four `ENTRA_*` settings are
  actually set.
- **A deploy doesn't always restart the running container.** Observed once:
  a push succeeded (build/test/deploy all green), but the site kept serving
  the previous build (new routes 404'd) until an explicit `az webapp restart
  --name <APP_NAME> --resource-group <RESOURCE_GROUP>`. Not fully understood
  why the deploy's own restart didn't take effect that time — if a route you
  just deployed 404s, try a manual restart before assuming the code is
  wrong.
- **`az ad app permission admin-consent` can report success without actually
  creating the app role assignment.** Happened on the mail-send app
  registration: the command returned cleanly, but
  `GET /servicePrincipals/{id}/appRoleAssignments` came back empty, and
  Graph sendMail failed with `ErrorAccessDenied`. Fixed by creating the
  assignment directly:
  ```bash
  GRAPH_SP_ID=$(az ad sp show --id 00000003-0000-0000-c000-000000000000 --query id -o tsv)
  az rest --method post \
    --url "https://graph.microsoft.com/v1.0/servicePrincipals/<CLIENT_SP_ID>/appRoleAssignedTo" \
    --headers "Content-Type=application/json" \
    --body "{\"principalId\":\"<CLIENT_SP_ID>\",\"resourceId\":\"$GRAPH_SP_ID\",\"appRoleId\":\"<APP_ROLE_ID>\"}"
  ```
  After creating an app registration's Mail.Send permission, verify the
  assignment actually exists (`GET
  /servicePrincipals/{clientSpId}/appRoleAssignments` should be non-empty)
  rather than trusting `admin-consent`'s exit code alone.
- **`Always On` is off by default, even on B1+ tiers that support it.**
  Without it, the app idles after ~20 min of no traffic; the next request
  cold-starts the container (slow, since `npm start` runs `prisma migrate
  deploy` before the server even boots) and can look like the site is down.
  The provisioning script now sets `--always-on true`; if you provisioned
  before this was added, run `az webapp config set --name <APP_NAME>
  --resource-group <RESOURCE_GROUP> --always-on true` once.

This has been deployed and verified against real Azure: App Service is live
at `snc-wellness-exam-verification.azurewebsites.net`, both Entra app registrations
(mail-send and dashboard SSO) exist and work, `prisma migrate deploy` has
applied real migrations against production Azure SQL, and the dashboard/auth
flow has been exercised end-to-end there — including a real Graph email
delivered to a real inbox.
