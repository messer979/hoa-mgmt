"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { stripQuotedReply } from "@/lib/text";

export async function linkEmailToTopic(formData: FormData) {
  await requireAdmin();
  const supabase = createAdminClient();
  const id = String(formData.get("id"));
  const topic_id = String(formData.get("topic_id") ?? "") || null;

  const { data: email, error: getErr } = await supabase
    .from("emails")
    .select("id,topic_id,matched_profile_id,body_text,body_html,subject,received_at")
    .eq("id", id)
    .maybeSingle();
  if (getErr) throw new Error(getErr.message);
  if (!email) throw new Error("Email not found");

  const { error } = await supabase
    .from("emails")
    .update({ topic_id })
    .eq("id", id);
  if (error) throw new Error(error.message);

  if (topic_id) {
    // Upsert the conversation message (unique on email_id).
    const stripped = stripQuotedReply(email.body_text) || (email.subject ?? "(no message)");
    await supabase
      .from("topic_messages")
      .upsert(
        {
          topic_id,
          author_profile_id: email.matched_profile_id ?? null,
          body_text: stripped,
          body_html: email.body_html,
          source: "email",
          email_id: email.id,
          created_at: email.received_at,
        },
        { onConflict: "email_id" }
      );
  } else {
    await supabase.from("topic_messages").delete().eq("email_id", id);
  }

  revalidatePath(`/inbox/${id}`);
  revalidatePath("/inbox");
  if (topic_id) revalidatePath(`/topics/${topic_id}`);
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

  // Keep the linked conversation row's author in sync.
  await supabase
    .from("topic_messages")
    .update({ author_profile_id: matched_profile_id })
    .eq("email_id", id);

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
