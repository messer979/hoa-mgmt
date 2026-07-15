import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;

// POST /api/documents/upload
// Multipart form: file, title?, description?
// Used by the client-side dropzone which uploads files one at a time so it
// can track per-file status. Single-file semantics keep error handling
// straightforward and let one bad file not sink the batch.
export async function POST(req: NextRequest) {
  const me = await requireUser();

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is over the 25 MB limit" }, { status: 413 });
  }

  const title = String(form.get("title") ?? "").trim() || null;
  const description = String(form.get("description") ?? "").trim() || null;
  const safeName = (file.name || "upload.bin").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = `${me.id}/${Date.now()}-${safeName}`;
  const contentType = file.type || "application/octet-stream";

  const supabase = createAdminClient();
  const { error: upErr } = await supabase.storage
    .from("documents")
    .upload(path, file, { contentType, upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: row, error: insErr } = await supabase
    .from("documents")
    .insert({
      title,
      description,
      storage_path: path,
      filename: file.name,
      content_type: contentType,
      size_bytes: file.size,
      uploaded_by: me.id,
    })
    .select("id")
    .single();
  if (insErr) {
    await supabase.storage.from("documents").remove([path]);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ id: row.id });
}
