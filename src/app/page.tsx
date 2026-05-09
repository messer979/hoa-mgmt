import { redirect } from "next/navigation";
import { getCurrentProfile, isAuthed } from "@/lib/auth";

export default async function Home() {
  if (!(await isAuthed())) redirect("/login");
  const me = await getCurrentProfile();
  redirect(me ? "/topics" : "/whoami");
}
