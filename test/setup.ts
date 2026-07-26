// Tests set env vars directly instead of relying on a .env file existing.
process.env.DATABASE_URL ??= "sqlserver://localhost:1433;database=test;user=sa;password=test;trustServerCertificate=true";
process.env.EMAIL_MODE ??= "mock";
process.env.APP_BASE_URL ??= "http://localhost:3000";
process.env.TOKEN_EXPIRY_DAYS ??= "30";
process.env.MAIL_SENDER_ADDRESS ??= "hr@standardnutrition.com";
process.env.PORT ??= "3000";
process.env.AZURE_STORAGE_CONNECTION_STRING ??=
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;";
process.env.UPLOADS_CONTAINER_NAME ??= "uploaded-forms";
process.env.MAX_UPLOAD_MB ??= "20";
process.env.NODE_ENV ??= "test";
process.env.AUTH_MODE ??= "mock";
process.env.SESSION_SECRET ??= "test-session-secret";
