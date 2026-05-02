"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Choice } from "@/lib/types";

export async function createTopic(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const closesRaw = String(formData.get("closes_at") ?? "").trim();
  const closes_at = closesRaw ? new Date(closesRaw).toISOString() : null;

  if (!title) throw new Error("Title is required");

  const { data, error } = await supabase
    .from("topics")
    .insert({ title, description, closes_at, created_by: user.id })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/topics");
  redirect(`/topics/${data!.id}`);
}

export async function castVote(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const topic_id = String(formData.get("topic_id"));
  const choice = String(formData.get("choice")) as Choice;
  if (!["affirm", "reject", "abstain"].includes(choice)) {
    throw new Error("Invalid choice");
  }

  const { error } = await supabase.from("votes").upsert(
    { topic_id, voter_id: user.id, choice, source: "web", voted_by: user.id },
    { onConflict: "topic_id,voter_id" }
  );
  if (error) throw new Error(error.message);

  revalidatePath(`/topics/${topic_id}`);
  revalidatePath("/topics");
}

export async function adminProxyVote(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") throw new Error("Only admins can record proxy votes");

  const topic_id = String(formData.get("topic_id"));
  const voter_id = String(formData.get("voter_id"));
  const choice = String(formData.get("choice")) as Choice;
  const email_id = String(formData.get("email_id") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!["affirm", "reject", "abstain"].includes(choice)) {
    throw new Error("Invalid choice");
  }

  const { error } = await supabase.from("votes").upsert(
    {
      topic_id,
      voter_id,
      choice,
      source: email_id ? "email" : "admin_proxy",
      voted_by: user.id,
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
  const supabase = await createClient();
  const id = String(formData.get("id"));
  const status = String(formData.get("status"));
  if (!["open", "closed", "passed", "failed"].includes(status)) {
    throw new Error("Invalid status");
  }
  const { error } = await supabase.from("topics").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/topics/${id}`);
  revalidatePath("/topics");
}
