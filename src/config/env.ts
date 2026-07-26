import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    EMAIL_MODE: z.enum(["mock", "graph"]).default("mock"),
    MAIL_SENDER_ADDRESS: z.string().email().default("hr@standardnutrition.com"),
    AZURE_TENANT_ID: z.string().optional(),
    AZURE_CLIENT_ID: z.string().optional(),
    AZURE_CLIENT_SECRET: z.string().optional(),
    APP_BASE_URL: z.string().url().default("http://localhost:3000"),
    TOKEN_EXPIRY_DAYS: z.coerce.number().int().positive().default(30),
    PORT: z.coerce.number().int().positive().default(3000),
    AZURE_STORAGE_CONNECTION_STRING: z.string().min(1, "AZURE_STORAGE_CONNECTION_STRING is required"),
    UPLOADS_CONTAINER_NAME: z.string().min(1).default("uploaded-forms"),
    MAX_UPLOAD_MB: z.coerce.number().int().positive().default(20),
    NODE_ENV: z.string().default("development"),
    AUTH_MODE: z.enum(["mock", "entra"]).default("mock"),
    SESSION_SECRET: z.string().min(1, "SESSION_SECRET is required"),
    ENTRA_TENANT_ID: z.string().optional(),
    ENTRA_CLIENT_ID: z.string().optional(),
    ENTRA_CLIENT_SECRET: z.string().optional(),
    ENTRA_REDIRECT_URI: z.string().optional(),
    HR_GROUP_OBJECT_ID: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_MODE === "graph") {
      for (const key of ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} is required when EMAIL_MODE=graph`,
            path: [key],
          });
        }
      }
    }
    if (env.AUTH_MODE === "entra") {
      for (const key of ["ENTRA_TENANT_ID", "ENTRA_CLIENT_ID", "ENTRA_CLIENT_SECRET", "ENTRA_REDIRECT_URI"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} is required when AUTH_MODE=entra`,
            path: [key],
          });
        }
      }
    }
    if (env.AUTH_MODE === "mock" && env.NODE_ENV === "production") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "AUTH_MODE=mock (dev-only HR sign-in bypass) must not be used when NODE_ENV=production",
        path: ["AUTH_MODE"],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = envSchema.parse(process.env);
  }
  return cachedEnv;
}
