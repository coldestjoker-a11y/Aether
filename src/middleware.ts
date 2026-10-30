import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "aethervault_admin_session";

async function verifyEdgeHmac(token: string, secret: string): Promise<boolean> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const [, expStr] = payload.split(":");
  if (!expStr || Number(expStr) < Date.now()) return false;

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
    const expectedSig = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (signature.length !== expectedSig.length) return false;
    let mismatch = 0;
    for (let i = 0; i < signature.length; i++) {
      mismatch |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i);
    }
    return mismatch === 0;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Enforce strict security headers on all routes including /admin
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  if (request.nextUrl.pathname.startsWith("/admin")) {
    response.headers.set("Cache-Control", "no-store, max-age=0");

    const cookie = request.cookies.get(COOKIE_NAME)?.value;
    const secret = process.env.ADMIN_SESSION_SECRET;

    if (cookie) {
      if (!secret || secret.length < 16) {
        const res = NextResponse.redirect(new URL("/admin", request.url));
        res.cookies.delete(COOKIE_NAME);
        return res;
      }
      const isValid = await verifyEdgeHmac(cookie, secret);
      if (!isValid) {
        const res = NextResponse.redirect(new URL("/admin", request.url));
        res.cookies.delete(COOKIE_NAME);
        return res;
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
