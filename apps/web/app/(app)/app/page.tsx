import { redirect } from "next/navigation";

import { getSession } from "@/auth/session";
import {
  ensurePersonalWorkspace,
  listUserWorkspaces,
} from "@/services/workspaces";

export default async function AppIndexPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const user = session.user;
  let workspaces = await listUserWorkspaces(user.id);
  if (workspaces.length === 0) {
    await ensurePersonalWorkspace(user);
    workspaces = await listUserWorkspaces(user.id);
  }
  const first = workspaces[0];
  if (!first) {
    throw new Error("Your account does not have a workspace");
  }
  redirect(`/app/${first.slug}/forms`);
}
