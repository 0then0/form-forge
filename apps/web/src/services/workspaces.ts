import "server-only";

import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { memberships, workspaces } from "@/db/schema";
import { slugify } from "@/lib/slug";

export const listUserWorkspaces = async (userId: string) =>
  db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      role: memberships.role,
      slug: workspaces.slug,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(workspaces.name));

export const ensurePersonalWorkspace = async (user: {
  id: string;
  name?: string | null;
}) =>
  db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`);
    const [existing] = await tx
      .select({ workspaceId: memberships.workspaceId })
      .from(memberships)
      .where(eq(memberships.userId, user.id))
      .limit(1);
    if (existing) return existing.workspaceId;

    const workspaceName = user.name
      ? `${user.name}'s workspace`
      : "My workspace";
    const [workspace] = await tx
      .insert(workspaces)
      .values({
        name: workspaceName,
        slug: `${slugify(workspaceName)}-${crypto.randomUUID().slice(0, 8)}`,
      })
      .returning({ id: workspaces.id });
    if (!workspace) throw new Error("Workspace creation did not return an id");
    await tx.insert(memberships).values({
      role: "owner",
      userId: user.id,
      workspaceId: workspace.id,
    });
    return workspace.id;
  });
