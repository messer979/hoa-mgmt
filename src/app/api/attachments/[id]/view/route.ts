import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Same as ../download but omits the `download` option on the signed URL so
// the browser renders the file inline (PDFs, HTML/text emails) instead of
// forcing a Save-As dialog.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireUser();
  const { id } = await params;

  const supabase = createAdminClient();
  const { data: att } = await supabase
    .from("attachments")
    .select("id,storage_path,filename")
    .eq("id", id)
    .maybeSingle();
  if (!att) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: signed, error } = await supabase.storage
    .from("email-attachments")
    .createSignedUrl(att.storage_path, 60);
  if (error || !signed?.signedUrl) {
    console.error("view: createSignedUrl failed", error);
    return NextResponse.json({ error: "signing failed" }, { status: 500 });
  }
  return NextResponse.redirect(signed.signedUrl, { status: 302 });
}
