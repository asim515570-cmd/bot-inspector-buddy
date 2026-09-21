import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// Baseline browser hardening: clickjacking, MIME sniffing, referrer leakage,
// forced HTTPS and a device-permission lockdown. The CSP intentionally allows
// the inline/eval forms the framework needs while blocking framing and object
// embedding, which are the payloads that actually matter here.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self' https://*.lovable.app https://*.lovable.dev",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.lovable.dev https://*.lovable.app",
  "connect-src 'self' https: wss:",
  // No functional effect over HTTPS deployments; only matters if a stray
  // http:// subresource URL ever sneaks in, in which case it's upgraded
  // instead of silently blocked or (worse) loaded insecurely.
  "upgrade-insecure-requests",
].join("; ");

// Every one of these device/sensor APIs is unused by this app (storefront
// admin dashboard + Telegram webhook) — locking them out removes an attack
// surface for any future XSS or a compromised third-party script to abuse,
// without touching any capability the app actually relies on.
const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "magnetometer=()",
  "gyroscope=()",
  "accelerometer=()",
  "midi=()",
].join(", ");

const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  const response = (result as { response?: Response }).response;
  if (response?.headers) {
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("X-Frame-Options", "SAMEORIGIN");
    response.headers.set("Permissions-Policy", PERMISSIONS_POLICY);
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    // Turns off the browser's speculative DNS lookups for links on the page —
    // a minor privacy hardening (stops leaking "the visitor hovered/saw a
    // link to X" to X's DNS resolver) with no effect on navigation working.
    response.headers.set("X-DNS-Prefetch-Control", "off");
    if (!response.headers.has("Content-Security-Policy")) {
      response.headers.set("Content-Security-Policy", CSP);
    }
  }
  return result;
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware, securityHeadersMiddleware],
}));
