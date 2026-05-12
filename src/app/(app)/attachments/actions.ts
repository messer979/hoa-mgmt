"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

// Max 25 MB (matches the bucket cap).
const MAX_BYTES = 25 * 1024 * 1024;

export async function uploadAttachment(formData: FormData) {
  await requireUser();
  const topic_id = String(formData.get("topic_id"));
  const file = formData.get("file") as File | null;

  if (!topic_id) throw new Error("Missing topic id");
  if (!file || typeof file === "string" || file.size === 0) {
    throw new Error("Pick a file to upload");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("File is over the 25 MB limit");
  }

  const supabase = createAdminClient();
  const { data: topic } = await supabase
    .from("topics")
    .select("id")
    .eq("id", topic_id)
    .maybeSingle();
  if (!topic) throw new Error("Topic not found");

  const safeName = (file.name || "upload.bin").replace(/[^a-zA-Z0-9._-]+/g, "_");
  const path = `manual/${topic_id}/${Date.now()}-${safeName}`;
  const contentType = file.type || "application/octet-stream";

  const { error: upErr } = await supabase.storage
    .from("email-attachments")
    .upload(path, file, { contentType, upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { error: insErr } = await supabase.from("attachments").insert({
    email_id: null,
    topic_id,
    storage_path: path,
    filename: file.name,
    content_type: contentType,
    size_bytes: file.size,
  });
  if (insErr) {
    // Roll back the storage upload if the row insert failed.
    await supabase.storage.from("email-attachments").remove([path]);
    throw new Error(insErr.message);
  }

  revalidatePath(`/topics/${topic_id}`);
  revalidatePath("/attachments");
}

export async function assignAttachmentToTopic(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  const topic_id = String(formData.get("topic_id") ?? "") || null;

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("attachments")
    .update({ topic_id })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/attachments");
  if (topic_id) revalidatePath(`/topics/${topic_id}`);
}

export async function deleteAttachment(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));

  const supabase = createAdminClient();
  const { data: att } = await supabase
    .from("attachments")
    .select("storage_path,topic_id")
    .eq("id", id)
    .maybeSingle();
  if (!att) return;

  // Delete the storage object first; if it fails, leave the row so the
  // admin can retry rather than orphaning the file.
  const { error: rmErr } = await supabase.storage
    .from("email-attachments")
    .remove([att.storage_path]);
  if (rmErr) {
    console.error("deleteAttachment: storage remove failed", rmErr);
    throw new Error("Could not remove file from storage");
  }
  const { error: delErr } = await supabase
    .from("attachments")
    .delete()
    .eq("id", id);
  if (delErr) throw new Error(delErr.message);

  revalidatePath("/attachments");
  if (att.topic_id) revalidatePath(`/topics/${att.topic_id}`);
}
