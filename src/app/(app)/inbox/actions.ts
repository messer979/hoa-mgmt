"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function linkEmailToTopic(formData: FormData) {
  await requireAdmin();
  const supabase = createAdminClient();
  const id = String(formData.get("id"));
  const topic_id = String(formData.get("topic_id") ?? "") || null;
  const { error } = await supabase.from("emails").update({ topic_id }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/inbox/${id}`);
  revalidatePath("/inbox");
}

export async function linkEmailToProfile(formData: FormData) {
  await requireAdmin();
  const supabase = createAdminClient();
  const id = String(formData.get("id"));
  const matched_profile_id = String(formData.get("profile_id") ?? "") || null;
  const { error } = await supabase
    .from("emails")
    .update({ matched_profile_id })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/inbox/${id}`);
}

export async function markProcessed(formData: FormData) {
  await requireAdmin();
  const supabase = createAdminClient();
  const id = String(formData.get("id"));
  const processed = formData.get("processed") === "true";
  const { error } = await supabase.from("emails").update({ processed }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/inbox/${id}`);
  revalidatePath("/inbox");
}
