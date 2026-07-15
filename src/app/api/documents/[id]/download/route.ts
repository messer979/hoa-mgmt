import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireUser();
  const { id } = await params;

  const supabase = createAdminClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id,storage_path,filename")
    .eq("id", id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: signed, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(doc.storage_path, 60, { download: doc.filename });
  if (error || !signed?.signedUrl) {
    console.error("document download: createSignedUrl failed", error);
    return NextResponse.json({ error: "signing failed" }, { status: 500 });
  }
  return NextResponse.redirect(signed.signedUrl, { status: 302 });
}
