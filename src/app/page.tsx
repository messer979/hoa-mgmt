import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";

export default async function Home() {
  const me = await getCurrentProfile();
  redirect(me ? "/topics" : "/login");
}
