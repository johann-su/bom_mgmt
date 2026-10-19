import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Liveness probe for the Docker HEALTHCHECK. Intentionally unauthenticated and
// DB-free: a dependency check would make the container flap on a DB blip.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
