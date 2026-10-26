import { NextResponse } from "next/server";
import catalogue from "@/lib/label-icons.json";
import { iconSvgDocument, isIconId, type LabelIcon } from "@/lib/label-icons";

export const runtime = "nodejs";

const byId = new Map((catalogue as LabelIcon[]).map((icon) => [icon.id, icon]));

// Serves a label-icon catalogue entry as an SVG image — a part's thumbnail
// when it has no photo (parts.icon). No session check: these are the app's
// built-in icons, nothing user-specific. The markup was sanitised when the
// catalogue was generated, and an <img> runs no script either way.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string[] }> }) {
  const id = (await params).id.join("/");
  const icon = isIconId(id) ? byId.get(id) : undefined;
  if (!icon) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(iconSvgDocument(icon), {
    headers: {
      "Content-Type": "image/svg+xml",
      // Ids are stable but the catalogue can be regenerated with new artwork.
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
