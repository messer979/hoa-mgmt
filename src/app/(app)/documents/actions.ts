"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

const MAX_BYTES = 25 * 1024 * 1024;

export async function uploadDocument(formData: FormData) {
  const me = await requireUser();

  const file = formData.get("file") as File | null;
  const title = String(formData.get("title") ?? "").trim() || null;
  const description = String(formData.get("description") ?? "").trim() || null;

  if (!file || typeof file === "string" || file.size === 0) {
    throw new Error("Pick a file to upload");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("File is over the 25 MB limit");
  }

  const safeName = (file.name || "upload.bin").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = `${me.id}/${Date.now()}-${safeName}`;
  const contentType = file.type || "application/octet-stream";

  const supabase = createAdminClient();
  const { error: upErr } = await supabase.storage
    .from("documents")
    .upload(path, file, { contentType, upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { error: insErr } = await supabase.from("documents").insert({
    title,
    description,
    storage_path: path,
    filename: file.name,
    content_type: contentType,
    size_bytes: file.size,
    uploaded_by: me.id,
  });
  if (insErr) {
    await supabase.storage.from("documents").remove([path]);
    throw new Error(insErr.message);
  }

  revalidatePath("/documents");
}

export async function deleteDocument(formData: FormData) {
  const me = await requireUser();
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing document id");

  const supabase = createAdminClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path,uploaded_by")
    .eq("id", id)
    .maybeSingle();
  if (!doc) return;

  // Uploader or admin can delete.
  if (doc.uploaded_by !== me.id && me.role !== "admin") {
    throw new Error("You can only delete documents you uploaded");
  }

  const { error: rmErr } = await supabase.storage
    .from("documents")
    .remove([doc.storage_path]);
  if (rmErr) {
    console.error("deleteDocument: storage remove failed", rmErr);
    throw new Error("Could not remove file from storage");
  }
  const { error: delErr } = await supabase
    .from("documents")
    .delete()
    .eq("id", id);
  if (delErr) throw new Error(delErr.message);

  revalidatePath("/documents");
}
