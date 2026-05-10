"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { htmlToText, parseQuotedHistory, stripQuotedReply } from "@/lib/text";

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

// Rebuild the conversation rows for this email by re-running the parser. Use
// after we improve parseQuotedHistory to retroactively fix already-imported
// emails without making the user re-send.
export async function reparseEmailHistory(formData: FormData) {
  await requireAdmin();
  const supabase = createAdminClient();
  const id = String(formData.get("id"));

  const { data: email, error } = await supabase
    .from("emails")
    .select("id,topic_id,matched_profile_id,body_text,body_html,subject,received_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!email) throw new Error("Email not found");
  if (!email.topic_id) {
    throw new Error("Email isn't linked to a topic — link it first, then reparse.");
  }

  // Drop existing rows we previously created from this email, plus any
  // extracted history rows on this topic so we can rewrite them cleanly.
  await supabase.from("topic_messages").delete().eq("email_id", email.id);
  await supabase
    .from("topic_messages")
    .delete()
    .eq("topic_id", email.topic_id)
    .eq("extracted", true);

  const source = email.body_text || htmlToText(email.body_html);
  const { newContent, history } = parseQuotedHistory(source);

  // Backfill historical messages, oldest-first, with author lookup.
  if (history.length) {
    const emails = Array.from(
      new Set(history.map((h) => h.author_email).filter((e): e is string => !!e)),
    );
    const profileByEmail = new Map<string, string>();
    if (emails.length) {
      const { data: matched } = await supabase
        .from("profiles")
        .select("id,email")
        .in("email", emails);
      for (const p of matched ?? []) {
        if (p.email) profileByEmail.set(p.email.toLowerCase(), p.id);
      }
    }
    const baseMs = new Date(email.received_at).getTime();
    const rows = history.map((h, i) => ({
      topic_id: email.topic_id!,
      author_profile_id:
        h.author_email ? profileByEmail.get(h.author_email.toLowerCase()) ?? null : null,
      author_email: h.author_email,
      author_name: h.author_name,
      body_text: h.body || "(empty)",
      body_html: null,
      source: "email" as const,
      email_id: null,
      extracted: true,
      original_date: h.date,
      // Synthetic timestamps in parser order; see webhook for rationale.
      created_at: new Date(baseMs - (history.length - i) * 1000).toISOString(),
    }));
    const { error: hErr } = await supabase.from("topic_messages").insert(rows);
    if (hErr) throw new Error(hErr.message);
  }

  // Re-insert the email's own conversation row.
  const body =
    newContent ||
    stripQuotedReply(source) ||
    source.trim() ||
    email.subject ||
    "(no message)";
  const { error: mErr } = await supabase.from("topic_messages").insert({
    topic_id: email.topic_id,
    author_profile_id: email.matched_profile_id ?? null,
    body_text: body,
    body_html: email.body_html,
    source: "email",
    email_id: email.id,
    extracted: false,
    created_at: email.received_at,
  });
  if (mErr) throw new Error(mErr.message);

  revalidatePath(`/inbox/${id}`);
  revalidatePath(`/topics/${email.topic_id}`);
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
