# Deploying to Azure

This has been run end-to-end against a real Azure subscription
(`hr-physical-tracker.azurewebsites.net`, `centralus`) and is live. A few
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
Storage account + private blob container, and sets most of the App Service
Application Settings automatically (`DATABASE_URL`,
`AZURE_STORAGE_CONNECTION_STRING`, `SESSION_SECRET`, etc. — all generated
locally, never written to disk or committed).

It intentionally does **not** create the Entra ID app registrations (step 2)
or set the settings that depend on them — those are Portal-driven steps that
don't script cleanly (admin consent has to be clicked).

## 2. Create the two Entra ID app registrations

These can be the same app registration configured with both permission types
below, or two separate ones — separate is cleaner if different people manage
"can send mail as HR" vs. "can sign in to the dashboard."

**A. Graph mail-send app** (Entra ID → App registrations → New registration):
1. Register the app (any name, e.g. "HR Physical Tracker — Mail").
2. API permissions → Add → Microsoft Graph → **Application permissions** →
   `Mail.Send` → Add, then **Grant admin consent** (needs a tenant admin).
3. Certificates & secrets → New client secret → copy the value immediately.
4. Set on App Service: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
   `AZURE_CLIENT_SECRET` from this registration.

**B. Dashboard SSO app:**
1. Register the app (e.g. "HR Physical Tracker — Dashboard").
2. Authentication → Add a platform → Web → redirect URI:
   `https://<APP_NAME>.azurewebsites.net/auth/callback` (the exact value the
   provisioning script printed as `ENTRA_REDIRECT_URI`).
3. API permissions → Microsoft Graph → **Delegated permissions** →
   `User.Read` (usually already present by default).
4. Certificates & secrets → New client secret → copy the value.
5. Set on App Service: `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`,
   `ENTRA_CLIENT_SECRET`, `ENTRA_REDIRECT_URI`.
6. Optional: to restrict the dashboard to an HR security group, find that
   group's Object ID (Entra ID → Groups) and set `HR_GROUP_OBJECT_ID` on App
   Service. This only works if the app registration is configured to emit a
   `groups` claim (Token configuration → Add groups claim).

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
at `hr-physical-tracker.azurewebsites.net`, both Entra app registrations
(mail-send and dashboard SSO) exist and work, `prisma migrate deploy` has
applied real migrations against production Azure SQL, and the dashboard/auth
flow has been exercised end-to-end there — including a real Graph email
delivered to a real inbox.
