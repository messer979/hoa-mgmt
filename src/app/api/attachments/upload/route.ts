import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;

// POST /api/attachments/upload
// Multipart form: file, topic_id
export async function POST(req: NextRequest) {
  await requireUser();

  const form = await req.formData();
  const file = form.get("file");
  const topic_id = String(form.get("topic_id") ?? "");
  if (!topic_id) {
    return NextResponse.json({ error: "topic_id is required" }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File is over the 25 MB limit" }, { status: 413 });
  }

  const supabase = createAdminClient();
  const { data: topic } = await supabase
    .from("topics")
    .select("id")
    .eq("id", topic_id)
    .maybeSingle();
  if (!topic) return NextResponse.json({ error: "Topic not found" }, { status: 404 });

  const safeName = (file.name || "upload.bin").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = `manual/${topic_id}/${Date.now()}-${safeName}`;
  const contentType = file.type || "application/octet-stream";

  const { error: upErr } = await supabase.storage
    .from("email-attachments")
    .upload(path, file, { contentType, upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: row, error: insErr } = await supabase
    .from("attachments")
    .insert({
      email_id: null,
      topic_id,
      storage_path: path,
      filename: file.name,
      content_type: contentType,
      size_bytes: file.size,
    })
    .select("id")
    .single();
  if (insErr) {
    await supabase.storage.from("email-attachments").remove([path]);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  revalidatePath(`/topics/${topic_id}`);
  revalidatePath("/attachments");

  return NextResponse.json({ id: row.id });
}
