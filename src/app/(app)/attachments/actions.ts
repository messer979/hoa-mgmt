"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

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
