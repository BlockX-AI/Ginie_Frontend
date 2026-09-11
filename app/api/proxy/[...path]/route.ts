import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const DEFAULT_API_BASE = "https://usermanagementapis-production.up.railway.app";
const API_BASE = String(process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, "");

function buildUpstreamUrl(path: string, search: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(`${normalizedPath}${search}`, `${API_BASE}/`).toString();
}

async function handler(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segs } = await ctx.params;
  const path = "/" + segs.join("/");
  const url = buildUpstreamUrl(path, request.nextUrl.search);

  const headers: Record<string, string> = {
    "Content-Type": request.headers.get("content-type") || "application/json",
    Accept: request.headers.get("accept") || "application/json",
  };

  // Forward cookies from browser to backend
  const cookieHeaderFromReq = request.headers.get("cookie") || "";
  const cookieHeaderFromParsed = request.cookies
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const cookieHeader = cookieHeaderFromReq || cookieHeaderFromParsed;
  if (cookieHeader) headers["Cookie"] = cookieHeader;

  // Debug only: for SSE stream requests, log whether auth cookies are present (never log values)
  const accept = request.headers.get("accept") || "";
  const isStreamReq = path.endsWith("/logs/stream") || accept.toLowerCase().includes("text/event-stream");
  if (isStreamReq) {
    const hasAccess = !!cookieHeader && cookieHeader.includes("evium_access=");
    const hasRefresh = !!cookieHeader && cookieHeader.includes("evium_refresh=");
    try {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ level: "debug", msg: "proxy.stream.request", path, hasAccess, hasRefresh, accept: accept.slice(0, 60) }));
    } catch {}
  }

  // Forward CSRF token if present
  const csrf = request.headers.get("x-csrf-token");
  if (csrf) headers["x-csrf-token"] = csrf;

  // Forward origin and proxy hints to help backend choose cookie attributes and log true client IP
  const origin = request.headers.get("origin") || `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  if (origin) headers["origin"] = origin;
  const xfProto = request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(":", "");
  const xfHost = request.headers.get("x-forwarded-host") || request.nextUrl.host;
  const xfFor = request.headers.get("x-forwarded-for") || "";
  if (xfProto) headers["x-forwarded-proto"] = xfProto;
  if (xfHost) headers["x-forwarded-host"] = xfHost;
  if (xfFor) headers["x-forwarded-for"] = xfFor;

  let body: BodyInit | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const ab = await request.arrayBuffer();
    body = ab.byteLength ? new Uint8Array(ab) : undefined;
  }

  let res: Response | undefined;
  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(url, {
        method: request.method,
        headers,
        body,
        credentials: "include",
        cache: "no-store",
      });
      lastErr = undefined;
      break;
    } catch (e: any) {
      lastErr = e;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  if (!res) {
    try {
      const cause: any = lastErr?.cause;
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          level: "error",
          msg: "proxy.fetch_failed",
          url,
          method: request.method,
          error: lastErr?.message,
          name: lastErr?.name,
          code: lastErr?.code,
          errno: lastErr?.errno,
          syscall: lastErr?.syscall,
          cause_message: cause?.message,
          cause_name: cause?.name,
          cause_code: cause?.code,
          cause_errno: cause?.errno,
          cause_syscall: cause?.syscall,
        }),
      );
    } catch {}
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "upstream_unreachable",
          message: String(lastErr?.cause?.code || lastErr?.code || lastErr?.message || "fetch failed").slice(0, 120),
        },
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();

  // Forward upstream headers (except those we rewrite or that break streaming)
  res.headers.forEach((v, k) => {
    const key = k.toLowerCase();
    if (key === "set-cookie") return;
    if (key === "content-length") return;
    responseHeaders.set(k, v);
  });

  try {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ level: "debug", msg: "proxy.response", path, status: res.status, setCookieCount: res.headers.getSetCookie?.().length || (res.headers.get("set-cookie") ? 1 : 0) }));
  } catch {}

  // Forward Set-Cookie headers from backend to browser, but rewrite for current origin
  const isHttps = request.nextUrl.protocol === "https:";
  const setCookies = res.headers.getSetCookie?.() || [];
  if (setCookies.length) {
    for (let sc of setCookies) {
      try {
        // Remove Domain attribute so cookie is scoped to current host
        sc = sc.replace(/;\s*Domain=[^;]+/gi, "");
        // In dev (http), drop Secure and avoid SameSite=None (which requires Secure)
        if (!isHttps) {
          sc = sc.replace(/;\s*Secure/gi, "");
          sc = sc.replace(/;\s*SameSite=None/gi, "; SameSite=Lax");
        }
        responseHeaders.append("Set-Cookie", sc);
      } catch {
        responseHeaders.append("Set-Cookie", sc);
      }
    }
  } else {
    // Fallback for environments without getSetCookie()
    const raw = res.headers.get("set-cookie");
    if (raw) {
      const parts = raw.split(/,(?=[^;]+?=)/g);
      for (let sc of parts) {
        try {
          sc = sc.replace(/;\s*Domain=[^;]+/gi, "");
          if (!isHttps) {
            sc = sc.replace(/;\s*Secure/gi, "");
            sc = sc.replace(/;\s*SameSite=None/gi, "; SameSite=Lax");
          }
          responseHeaders.append("Set-Cookie", sc);
        } catch {
          responseHeaders.append("Set-Cookie", sc);
        }
      }
    }
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType) responseHeaders.set("Content-Type", contentType);

  // Stream SSE responses without buffering
  if (contentType.toLowerCase().includes("text/event-stream") && res.body) {
    responseHeaders.set("Cache-Control", responseHeaders.get("cache-control") || "no-cache, no-transform");
    responseHeaders.delete("Content-Length");
    return new NextResponse(res.body, {
      status: res.status,
      headers: responseHeaders,
    });
  }

  const data = await res.arrayBuffer();
  return new NextResponse(data, {
    status: res.status,
    headers: responseHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
