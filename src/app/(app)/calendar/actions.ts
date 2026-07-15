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

export async function createEventsBulk(formData: FormData) {
  const me = await requireUser();
  const payload = String(formData.get("events") ?? "");
  if (!payload) throw new Error("No events to create");

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("Events payload was not valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("No events to create");
  }

  const rows: Array<{
    title: string;
    description: string | null;
    location: string | null;
    starts_at: string;
    ends_at: string | null;
    created_by: string;
  }> = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const starts = typeof r.starts_at === "string" ? r.starts_at : "";
    if (!title || !starts) continue;
    const startDate = new Date(starts);
    if (Number.isNaN(startDate.getTime())) continue;
    const endsRaw = typeof r.ends_at === "string" && r.ends_at ? r.ends_at : null;
    const endDate = endsRaw ? new Date(endsRaw) : null;
    if (endDate && Number.isNaN(endDate.getTime())) continue;
    rows.push({
      title,
      description: typeof r.description === "string" && r.description ? r.description : null,
      location: typeof r.location === "string" && r.location ? r.location : null,
      starts_at: startDate.toISOString(),
      ends_at: endDate ? endDate.toISOString() : null,
      created_by: me.id,
    });
  }
  if (rows.length === 0) throw new Error("No valid events in payload");

  const supabase = createAdminClient();
  const { error } = await supabase.from("events").insert(rows);
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
