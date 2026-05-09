"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function addMember(formData: FormData) {
  await requireAdmin();
  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const unit_number = String(formData.get("unit_number") ?? "").trim() || null;
  const role = (formData.get("role") === "admin" ? "admin" : "member") as "admin" | "member";
  if (!full_name || !email) throw new Error("Name and email are required");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("profiles")
    .insert({ full_name, email, unit_number, role });
  if (error) throw new Error(error.message);
  revalidatePath("/members");
}

export async function updateMember(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const unit_number = String(formData.get("unit_number") ?? "").trim() || null;
  const role = (formData.get("role") === "admin" ? "admin" : "member") as "admin" | "member";

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name, email, unit_number, role })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/members");
}

export async function removeMember(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  const supabase = createAdminClient();
  const { error } = await supabase.from("profiles").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/members");
}
