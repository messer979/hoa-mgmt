"use server";

import { revalidatePath } from "next/cache";
import { issueMagicLink, requireAdmin } from "@/lib/auth";
import { sendInvite } from "@/lib/email";
import { getBaseUrl } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/server";

export async function addMember(formData: FormData) {
  await requireAdmin();
  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = (formData.get("role") === "admin" ? "admin" : "member") as "admin" | "member";
  const shouldInvite = formData.get("send_invite") === "on";
  if (!full_name || !email) throw new Error("Name and email are required");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("profiles")
    .insert({ full_name, email, role });
  if (error) throw new Error(error.message);

  if (shouldInvite) {
    try {
      const issued = await issueMagicLink(email);
      if (issued.ok) {
        const baseUrl = await getBaseUrl();
        const link = `${baseUrl}/auth/verify?token=${encodeURIComponent(issued.token)}`;
        await sendInvite({
          to: issued.profile.email,
          recipientName: issued.profile.full_name,
          link,
        });
        console.log("addMember: invite sent", { to: email });
      } else {
        console.warn("addMember: invite skipped — could not issue link", {
          email,
          reason: issued.reason,
        });
      }
    } catch (e) {
      // Member is created either way; the invite is secondary.
      console.error("addMember: invite send failed", e);
    }
  }

  revalidatePath("/members");
}

export async function updateMember(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  const full_name = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = (formData.get("role") === "admin" ? "admin" : "member") as "admin" | "member";

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name, email, role })
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

// Re-issue a magic link + send the invite email for an existing member.
// Handy when the original invite expired before they clicked.
export async function resendInvite(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));

  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id,email,full_name")
    .eq("id", id)
    .maybeSingle();
  if (!profile) throw new Error("Member not found");

  const issued = await issueMagicLink(profile.email);
  if (!issued.ok) throw new Error(`Could not issue link: ${issued.reason}`);

  const baseUrl = await getBaseUrl();
  const link = `${baseUrl}/auth/verify?token=${encodeURIComponent(issued.token)}`;
  await sendInvite({
    to: issued.profile.email,
    recipientName: issued.profile.full_name,
    link,
  });
  console.log("resendInvite: sent", { to: profile.email });

  revalidatePath("/members");
}
