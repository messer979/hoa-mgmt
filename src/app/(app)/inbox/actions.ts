"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: me } = await supabase
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") throw new Error("Admin only");
  return { supabase, user };
}

export async function linkEmailToTopic(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id"));
  const topic_id = String(formData.get("topic_id") ?? "") || null;
  const { error } = await supabase.from("emails").update({ topic_id }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/inbox/${id}`);
  revalidatePath("/inbox");
}

export async function linkEmailToProfile(formData: FormData) {
  const { supabase } = await requireAdmin();
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
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id"));
  const processed = formData.get("processed") === "true";
  const { error } = await supabase.from("emails").update({ processed }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/inbox/${id}`);
  revalidatePath("/inbox");
}
