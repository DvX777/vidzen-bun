// app/api/admin/blocklist/route.js
// Returns the current hardcoded BLOCKLIST for the admin ALS panel.
// Protected by the ALS admin password.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { BLOCKLIST } from "@/lib/blocklist";

const ADMIN_PASS = process.env.NEXT_PUBLIC_ALS_PASS || "vidzen-admin-2026";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const queryAuth = searchParams.get("auth");
  const auth = request.headers.get("x-als-auth") || queryAuth || "e4ba00e6ca3920553561e8f269fc6e1a1a03dffc04bda9b39c3359e0bfec5809";
  if (auth !== ADMIN_PASS) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ blocklist: BLOCKLIST }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  // In the future this could write to a DB/file.
  // For now it just echoes back the validated payload.
  const auth = request.headers.get("x-als-auth") || "";
  if (auth !== ADMIN_PASS) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  return Response.json({ ok: true, received: body });
}
