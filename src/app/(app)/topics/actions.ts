"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth";
import { sendTopicAnnouncement, sendThreadReply } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/server";
import type { Choice } from "@/lib/types";

export async function createTopic(formData: FormData) {
  const me = await requireAdmin();

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const closesRaw = String(formData.get("closes_at") ?? "").trim();
  const closes_at = closesRaw ? new Date(closesRaw).toISOString() : null;
  const notify = formData.get("notify") === "on";
  if (!title) throw new Error("Title is required");

  const supabase = createAdminClient();
  const { data: topic, error } = await supabase
    .from("topics")
    .insert({ title, description, closes_at, created_by: me.id })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (notify) {
    const { data: members } = await supabase
      .from("profiles")
      .select("email");
    const recipients = (members ?? [])
      .map((m) => m.email)
      .filter((e): e is string => !!e);

    if (recipients.length) {
      try {
        const sent = await sendTopicAnnouncement({
          to: recipients,
          topicId: topic!.id,
          title,
          description,
          closesAt: closes_at,
        });

        // Persist the outbound announcement so inbound replies thread back
        // to it via In-Reply-To, and so the conversation has a starter row.
        if (sent.messageId) {
          const { data: outbound } = await supabase
            .from("emails")
            .insert({
              message_id: sent.messageId,
              from_email: process.env.RESEND_FROM_EMAIL ?? "",
              from_name: null,
              to_email: recipients.join(", "),
              subject: title,
              body_text: description,
              body_html: null,
              matched_profile_id: me.id,
              topic_id: topic!.id,
              is_outbound: true,
              processed: true,
              raw: null,
            })
            .select("id")
            .maybeSingle();

          await supabase
            .from("topic_messages")
            .insert({
              topic_id: topic!.id,
              author_profile_id: me.id,
              body_text: description ?? `(announcement: ${title})`,
              body_html: null,
              source: "email",
              email_id: outbound?.id ?? null,
            });
        }
      } catch (e) {
        console.error("sendTopicAnnouncement failed", e);
      }
    }
  }

  revalidatePath("/topics");
  redirect(`/topics/${topic!.id}`);
}

export async function postReply(formData: FormData) {
  const me = await requireUser();

  const topic_id = String(formData.get("topic_id"));
  const body = String(formData.get("body") ?? "").trim();
  const fanOut = formData.get("fan_out") !== "off";
  if (!topic_id || !body) throw new Error("Topic and message are required");

  const supabase = createAdminClient();
  const { data: topic } = await supabase
    .from("topics")
    .select("id,title")
    .eq("id", topic_id)
    .maybeSingle();
  if (!topic) throw new Error("Topic not found");

  // Insert the web message immediately so the UI shows it even if email fails.
  const { data: msg, error: msgErr } = await supabase
    .from("topic_messages")
    .insert({
      topic_id,
      author_profile_id: me.id,
      body_text: body,
      body_html: null,
      source: "web",
      email_id: null,
    })
    .select("id")
    .single();
  if (msgErr) throw new Error(msgErr.message);

  if (!fanOut) {
    console.log("postReply: fan-out disabled by user");
  } else if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    console.warn("postReply: skipping fan-out — RESEND_API_KEY or RESEND_FROM_EMAIL is not set");
  } else {
    try {
      // Fan out to the full roster (matching the announcement behavior so the
      // author also gets a confirmation copy in their inbox).
      const { data: members } = await supabase
        .from("profiles")
        .select("email");
      const recipients = (members ?? [])
        .map((m) => m.email)
        .filter((e): e is string => !!e);

      console.log("postReply: fanning out", {
        topic_id,
        recipientCount: recipients.length,
        from: process.env.RESEND_FROM_EMAIL,
      });

      if (!recipients.length) {
        console.warn("postReply: no recipients found in profiles table");
      }

      if (recipients.length) {
        // Find threading anchors: the most recent prior email on this topic.
        const { data: anchor } = await supabase
          .from("emails")
          .select("message_id,in_reply_to,references_ids")
          .eq("topic_id", topic_id)
          .not("message_id", "is", null)
          .order("received_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const inReplyTo = anchor?.message_id ?? null;
        const references = [
          ...(anchor?.references_ids ?? []),
          ...(anchor?.in_reply_to ? [anchor.in_reply_to] : []),
          ...(anchor?.message_id ? [anchor.message_id] : []),
        ].filter((v, i, a) => v && a.indexOf(v) === i) as string[];

        const sent = await sendThreadReply({
          to: recipients,
          topicId: topic_id,
          topicTitle: topic.title,
          bodyText: body,
          authorName: me.full_name ?? me.email,
          inReplyTo,
          references,
        });
        console.log("postReply: sent", { messageId: sent.messageId, rawId: sent.rawId });

        // Persist outbound email row + back-link the topic_message to it so
        // inbound replies can thread back via In-Reply-To.
        if (sent.messageId) {
          const { data: outbound } = await supabase
            .from("emails")
            .insert({
              message_id: sent.messageId,
              from_email: process.env.RESEND_FROM_EMAIL ?? "",
              from_name: me.full_name ?? null,
              to_email: recipients.join(", "),
              subject: topic.title.startsWith("Re:") ? topic.title : `Re: ${topic.title}`,
              body_text: body,
              body_html: null,
              matched_profile_id: me.id,
              topic_id,
              in_reply_to: inReplyTo,
              references_ids: references.length ? references : null,
              is_outbound: true,
              processed: true,
              raw: null,
            })
            .select("id")
            .maybeSingle();

          if (outbound) {
            await supabase
              .from("topic_messages")
              .update({ email_id: outbound.id })
              .eq("id", msg.id);
          }
        }
      }
    } catch (e) {
      console.error("postReply fan-out failed", e);
    }
  }

  revalidatePath(`/topics/${topic_id}`);
}

export async function castVote(formData: FormData) {
  const me = await requireUser();
  const topic_id = String(formData.get("topic_id"));
  const choice = String(formData.get("choice")) as Choice;
  if (!["affirm", "reject", "abstain"].includes(choice)) {
    throw new Error("Invalid choice");
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("votes").upsert(
    { topic_id, voter_id: me.id, choice, source: "web", voted_by: me.id },
    { onConflict: "topic_id,voter_id" }
  );
  if (error) throw new Error(error.message);

  revalidatePath(`/topics/${topic_id}`);
  revalidatePath("/topics");
}

export async function adminProxyVote(formData: FormData) {
  const me = await requireAdmin();

  const topic_id = String(formData.get("topic_id"));
  const voter_id = String(formData.get("voter_id"));
  const choice = String(formData.get("choice")) as Choice;
  const email_id = String(formData.get("email_id") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!["affirm", "reject", "abstain"].includes(choice)) {
    throw new Error("Invalid choice");
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("votes").upsert(
    {
      topic_id,
      voter_id,
      choice,
      source: email_id ? "email" : "admin_proxy",
      voted_by: me.id,
      email_id,
      notes,
    },
    { onConflict: "topic_id,voter_id" }
  );
  if (error) throw new Error(error.message);

  if (email_id) {
    await supabase
      .from("emails")
      .update({ processed: true, topic_id })
      .eq("id", email_id);
  }

  revalidatePath(`/topics/${topic_id}`);
  revalidatePath("/inbox");
}

export async function setTopicStatus(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["open", "closed", "passed", "failed"].includes(status)) {
    throw new Error("Invalid status");
  }
  const supabase = createAdminClient();
  const { error } = await supabase.from("topics").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/topics/${id}`);
  revalidatePath("/topics");
}

export async function deleteTopic(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing topic id");

  const supabase = createAdminClient();

  // Detach inbound emails so they remain in the inbox archive but are no
  // longer attributed to a deleted topic. (topic_messages cascades, votes
  // cascade via FK; emails do not — preserving the audit trail.)
  await supabase
    .from("emails")
    .update({ topic_id: null })
    .eq("topic_id", id);

  const { error } = await supabase.from("topics").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/topics");
  revalidatePath("/inbox");
  redirect("/topics");
}

// Move a single conversation message (and any underlying email) to a
// different topic. Used to fix mis-threaded replies without dropping into
// SQL — e.g. a reply on an old thread that was actually about a new topic.
export async function moveMessage(formData: FormData) {
  await requireAdmin();
  const message_id = String(formData.get("message_id"));
  const target_topic_id = String(formData.get("target_topic_id"));
  if (!message_id || !target_topic_id) throw new Error("Missing fields");

  const supabase = createAdminClient();

  const { data: msg, error: getErr } = await supabase
    .from("topic_messages")
    .select("id,topic_id,email_id")
    .eq("id", message_id)
    .maybeSingle();
  if (getErr) throw new Error(getErr.message);
  if (!msg) throw new Error("Message not found");

  const fromTopic = msg.topic_id;

  const { error: msgErr } = await supabase
    .from("topic_messages")
    .update({ topic_id: target_topic_id })
    .eq("id", message_id);
  if (msgErr) throw new Error(msgErr.message);

  // Keep the underlying email row in sync so future replies in this thread
  // inherit the correct topic via the In-Reply-To walk.
  if (msg.email_id) {
    await supabase
      .from("emails")
      .update({ topic_id: target_topic_id })
      .eq("id", msg.email_id);
  }

  revalidatePath(`/topics/${target_topic_id}`);
  if (fromTopic) revalidatePath(`/topics/${fromTopic}`);
  revalidatePath("/inbox");
}

export async function deleteMessage(formData: FormData) {
  await requireAdmin();
  const message_id = String(formData.get("message_id"));
  if (!message_id) throw new Error("Missing message id");

  const supabase = createAdminClient();
  const { data: msg } = await supabase
    .from("topic_messages")
    .select("id,topic_id,email_id")
    .eq("id", message_id)
    .maybeSingle();
  if (!msg) return;

  // Delete the conversation row; if it was email-backed, detach the email
  // (set topic_id null) so it returns to the inbox for re-routing rather
  // than disappearing from the audit trail.
  const { error } = await supabase
    .from("topic_messages")
    .delete()
    .eq("id", message_id);
  if (error) throw new Error(error.message);

  if (msg.email_id) {
    await supabase
      .from("emails")
      .update({ topic_id: null, processed: false })
      .eq("id", msg.email_id);
  }

  if (msg.topic_id) revalidatePath(`/topics/${msg.topic_id}`);
  revalidatePath("/inbox");
}
