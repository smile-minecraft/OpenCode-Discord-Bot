// instrument.mjs — Sentry SDK initialization
// Must be loaded before any other module using --import flag
import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? "https://e98fe891622956ac569c2820096045bd@o4511056626450432.ingest.us.sentry.io/4511056634445824",

  sendDefaultPii: true,

  // 100% in dev, 10% in production
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Capture local variable values in stack frames
  includeLocalVariables: true,

  // Enable Sentry Logs integration
  enableLogs: true,

  // Environment
  environment: process.env.NODE_ENV ?? "development",
});
