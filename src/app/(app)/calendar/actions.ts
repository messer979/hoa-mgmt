"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function createEvent(formData: FormData) {
  const me = await requireUser();

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const location = String(formData.get("location") ?? "").trim() || null;
  const startsRaw = String(formData.get("starts_at") ?? "").trim();
  const endsRaw = String(formData.get("ends_at") ?? "").trim();

  if (!title) throw new Error("Title is required");
  if (!startsRaw) throw new Error("Start time is required");

  const starts_at = new Date(startsRaw).toISOString();
  const ends_at = endsRaw ? new Date(endsRaw).toISOString() : null;
  if (ends_at && ends_at < starts_at) {
    throw new Error("End time must be after start time");
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("events").insert({
    title,
    description,
    location,
    starts_at,
    ends_at,
    created_by: me.id,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/calendar");
  redirect("/calendar");
}

export async function deleteEvent(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing event id");

  const supabase = createAdminClient();
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/calendar");
}
