import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { memberships, workspaces, type MembershipRole } from "@/db/schema";
import { forbiddenError, notFoundError } from "@/lib/errors";
import { requireUser } from "./session";

const roleRank: Record<MembershipRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export const requireWorkspace = async (
  workspaceSlug: string,
  minimumRole: MembershipRole = "viewer",
) => {
  const user = await requireUser();
  const [result] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      role: memberships.role,
      slug: workspaces.slug,
    })
    .from(workspaces)
    .innerJoin(
      memberships,
      and(
        eq(memberships.workspaceId, workspaces.id),
        eq(memberships.userId, user.id),
      ),
    )
    .where(eq(workspaces.slug, workspaceSlug))
    .limit(1);

  if (!result) throw notFoundError("Workspace not found");
  if (roleRank[result.role] < roleRank[minimumRole]) throw forbiddenError();
  return { ...result, user };
};

export const canManageMembers = (role: MembershipRole) => role === "owner";
export const canEdit = (role: MembershipRole) => role !== "viewer";
