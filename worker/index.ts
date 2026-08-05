/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleAccountApi } from "./auth-api";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function cookieValue(request: Request, name: string): string | null {
  const match = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isProtectedBrowserPage(request: Request, pathname: string): boolean {
  if (pathname === "/" || pathname.startsWith("/_") || pathname.startsWith("/api/") || pathname.includes(".")) return false;
  const accept = request.headers.get("accept") ?? "";
  return request.method === "GET" && (accept.includes("text/html") || accept.includes("text/x-component"));
}

async function hasValidSession(request: Request, database: D1Database | undefined): Promise<boolean> {
  const token = cookieValue(request, "quiz_session");
  if (!token) return false;
  if (!database) return true;
  const row = await database.prepare(
    "SELECT 1 AS ok FROM auth_sessions WHERE token_hash = ? AND expires_at > ?",
  ).bind(await sha256(token), Math.floor(Date.now() / 1000)).first<{ ok: number }>();
  return row?.ok === 1;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/auth/") || url.pathname === "/api/user-data" || url.pathname === "/api/history") {
      return await handleAccountApi(request, env.DB) ?? new Response("Not found", { status: 404 });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    if (isProtectedBrowserPage(request, url.pathname) && !await hasValidSession(request, env.DB)) {
      const loginUrl = new URL("/", request.url);
      loginUrl.searchParams.set("returnTo", `${url.pathname}${url.search}`);
      return Response.redirect(loginUrl, 302);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
