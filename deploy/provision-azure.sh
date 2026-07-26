#!/usr/bin/env bash
# Provisions the Azure resources this app needs: App Service, Azure SQL,
# Storage Account. Run once, from a machine with `az` installed and
# `az login` already done. Not idempotent — re-running against the same
# names will fail on the resources that already exist, which is fine for a
# first-time setup.
#
# What this script does NOT do (see DEPLOYMENT.md for these):
#   - Create the two Entra ID app registrations (Graph mail-send + dashboard
#     SSO) — those involve admin consent and are done in the Portal.
#   - Set the ENTRA_*/AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET
#     app settings — you'll add those after creating the registrations.
#   - Wire up GitHub Actions secrets — printed at the end of this script.

set -euo pipefail

# --- Edit these before running ---
RESOURCE_GROUP="hrapp-rg"
LOCATION="eastus2"
APP_NAME="hr-physical-tracker"          # must be globally unique (becomes <APP_NAME>.azurewebsites.net)
APP_SERVICE_PLAN="hrapp-plan"
APP_SERVICE_SKU="B1"                    # cost-conscious default; upgrade later if needed

SQL_SERVER_NAME="hrapp-sql-$(date +%s)" # must be globally unique; timestamp suffix avoids collisions
SQL_ADMIN_USER="hrappadmin"
SQL_DATABASE_NAME="hrapp"
SQL_SKU="Basic"                         # cost-conscious default; upgrade later if needed

STORAGE_ACCOUNT_NAME="hrapp$(date +%s | tail -c 8)" # must be globally unique, lowercase alphanumeric, <=24 chars
UPLOADS_CONTAINER_NAME="uploaded-forms"

MAIL_SENDER_ADDRESS="hr@standardnutrition.com"
# --- End of editable variables ---

echo "Generating a SQL admin password and a session secret locally (not stored in this script)..."
SQL_ADMIN_PASSWORD="$(openssl rand -base64 24)Aa1!"
SESSION_SECRET="$(openssl rand -base64 32)"

echo "==> Resource group: $RESOURCE_GROUP"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

echo "==> App Service plan (Linux, $APP_SERVICE_SKU): $APP_SERVICE_PLAN"
az appservice plan create \
  --name "$APP_SERVICE_PLAN" \
  --resource-group "$RESOURCE_GROUP" \
  --sku "$APP_SERVICE_SKU" \
  --is-linux \
  --output none

echo "==> Web app (Node 20 LTS): $APP_NAME"
az webapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --plan "$APP_SERVICE_PLAN" \
  --runtime "NODE:20-lts" \
  --output none

echo "==> Azure SQL logical server: $SQL_SERVER_NAME"
az sql server create \
  --name "$SQL_SERVER_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --admin-user "$SQL_ADMIN_USER" \
  --admin-password "$SQL_ADMIN_PASSWORD" \
  --output none

echo "==> SQL firewall: allow Azure services (needed so App Service can reach it)"
az sql server firewall-rule create \
  --resource-group "$RESOURCE_GROUP" \
  --server "$SQL_SERVER_NAME" \
  --name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0 \
  --output none

echo "==> Azure SQL database ($SQL_SKU): $SQL_DATABASE_NAME"
az sql db create \
  --resource-group "$RESOURCE_GROUP" \
  --server "$SQL_SERVER_NAME" \
  --name "$SQL_DATABASE_NAME" \
  --service-objective "$SQL_SKU" \
  --output none

echo "==> Storage account: $STORAGE_ACCOUNT_NAME"
az storage account create \
  --name "$STORAGE_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --output none

STORAGE_CONNECTION_STRING="$(az storage account show-connection-string \
  --name "$STORAGE_ACCOUNT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query connectionString -o tsv)"

echo "==> Blob container: $UPLOADS_CONTAINER_NAME"
az storage container create \
  --name "$UPLOADS_CONTAINER_NAME" \
  --connection-string "$STORAGE_CONNECTION_STRING" \
  --public-access off \
  --output none

DATABASE_URL="sqlserver://${SQL_SERVER_NAME}.database.windows.net:1433;database=${SQL_DATABASE_NAME};user=${SQL_ADMIN_USER};password=${SQL_ADMIN_PASSWORD};encrypt=true;trustServerCertificate=false;"
APP_BASE_URL="https://${APP_NAME}.azurewebsites.net"

echo "==> Setting App Service application settings"
az webapp config appsettings set \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    NODE_ENV=production \
    AUTH_MODE=entra \
    EMAIL_MODE=graph \
    MAIL_SENDER_ADDRESS="$MAIL_SENDER_ADDRESS" \
    APP_BASE_URL="$APP_BASE_URL" \
    TOKEN_EXPIRY_DAYS=30 \
    MAX_UPLOAD_MB=20 \
    UPLOADS_CONTAINER_NAME="$UPLOADS_CONTAINER_NAME" \
    DATABASE_URL="$DATABASE_URL" \
    AZURE_STORAGE_CONNECTION_STRING="$STORAGE_CONNECTION_STRING" \
    SESSION_SECRET="$SESSION_SECRET" \
    SCM_DO_BUILD_DURING_DEPLOYMENT=true \
  --output none

echo ""
echo "=================================================================="
echo "Provisioning done. Still needed before this actually works:"
echo ""
echo "1. Create the two Entra ID app registrations (see DEPLOYMENT.md),"
echo "   then set these App Service settings (Portal, or az webapp config"
echo "   appsettings set):"
echo "     AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET   (Graph mail-send app)"
echo "     ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET   (dashboard SSO app)"
echo "     ENTRA_REDIRECT_URI = ${APP_BASE_URL}/auth/callback"
echo ""
echo "2. For GitHub Actions deployment, get the publish profile:"
echo "     az webapp deployment list-publishing-profiles --name $APP_NAME \\"
echo "       --resource-group $RESOURCE_GROUP --xml"
echo "   Paste its output into a GitHub secret named AZURE_WEBAPP_PUBLISH_PROFILE,"
echo "   and add a GitHub Actions variable AZURE_WEBAPP_NAME=$APP_NAME."
echo ""
echo "3. Run 'npx prisma migrate deploy' against \$DATABASE_URL at least once"
echo "   (the app's start script also does this automatically on every boot)."
echo ""
echo "App URL: $APP_BASE_URL"
echo "=================================================================="
