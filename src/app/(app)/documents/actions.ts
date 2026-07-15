"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function deleteDocument(formData: FormData) {
  const me = await requireUser();
  const id = String(formData.get("id"));
  if (!id) throw new Error("Missing document id");

  const supabase = createAdminClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path,uploaded_by")
    .eq("id", id)
    .maybeSingle();
  if (!doc) return;

  // Uploader or admin can delete.
  if (doc.uploaded_by !== me.id && me.role !== "admin") {
    throw new Error("You can only delete documents you uploaded");
  }

  const { error: rmErr } = await supabase.storage
    .from("documents")
    .remove([doc.storage_path]);
  if (rmErr) {
    console.error("deleteDocument: storage remove failed", rmErr);
    throw new Error("Could not remove file from storage");
  }
  const { error: delErr } = await supabase
    .from("documents")
    .delete()
    .eq("id", id);
  if (delErr) throw new Error(delErr.message);

  revalidatePath("/documents");
}
