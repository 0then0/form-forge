import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { requireWorkspace } from "@/auth/permissions";
import { db } from "@/db/client";
import { auditLogs, memberships, users, workspaces } from "@/db/schema";
import { AppError, forbiddenError, notFoundError } from "@/lib/errors";

const manageableRoleSchema = z.enum(["owner", "editor", "viewer"]);
const addMemberSchema = z
  .object({
    email: z.email(),
    role: manageableRoleSchema,
  })
  .strict();
const updateMemberSchema = z
  .object({
    role: manageableRoleSchema,
    userId: z.uuid(),
  })
  .strict();

export const listMembers = async (workspaceSlug: string) => {
  const workspace = await requireWorkspace(workspaceSlug);
  return db
    .select({
      email: users.email,
      image: users.image,
      name: users.name,
      role: memberships.role,
      userId: users.id,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspace.id))
    .orderBy(asc(users.name));
};

export const addMember = async (workspaceSlug: string, input: unknown) => {
  const workspace = await requireWorkspace(workspaceSlug, "owner");
  const parsed = addMemberSchema.parse(input);
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, parsed.email.toLowerCase()))
    .limit(1);
  if (!user) {
    throw new AppError(
      "NOT_FOUND",
      "That email must sign in to Form Forge before it can be added",
      404,
    );
  }

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(memberships)
      .values({ role: parsed.role, userId: user.id, workspaceId: workspace.id })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      throw new AppError("CONFLICT", "This user is already a member", 409);
    }
    await tx.insert(auditLogs).values({
      action: "membership.created",
      actorId: workspace.user.id,
      metadata: { email: parsed.email, role: parsed.role },
      resourceId: user.id,
      resourceType: "membership",
      workspaceId: workspace.id,
    });
    return created;
  });
};

const ensureAnotherOwner = async (
  tx: Pick<typeof db, "select">,
  workspaceId: string,
  targetUserId: string,
) => {
  const owners = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        eq(memberships.role, "owner"),
      ),
    )
    .for("update");
  if (owners.length === 1 && owners[0]?.userId === targetUserId) {
    throw new AppError(
      "CONFLICT",
      "A workspace must keep at least one owner",
      409,
    );
  }
};

const verifyActorStillOwnsWorkspace = async (
  tx: Pick<typeof db, "select">,
  workspaceId: string,
  actorId: string,
) => {
  const [actorMembership] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        eq(memberships.userId, actorId),
      ),
    )
    .limit(1);
  if (actorMembership?.role !== "owner") throw forbiddenError();
};

export const updateMember = async (workspaceSlug: string, input: unknown) => {
  const workspace = await requireWorkspace(workspaceSlug, "owner");
  const parsed = updateMemberSchema.parse(input);
  return db.transaction(async (tx) => {
    await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspace.id))
      .for("update");
    await verifyActorStillOwnsWorkspace(tx, workspace.id, workspace.user.id);
    const [existing] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.workspaceId, workspace.id),
          eq(memberships.userId, parsed.userId),
        ),
      )
      .limit(1)
      .for("update");
    if (!existing) throw notFoundError("Membership not found");
    if (existing.role === "owner" && parsed.role !== "owner") {
      await ensureAnotherOwner(tx, workspace.id, parsed.userId);
    }
    const [updated] = await tx
      .update(memberships)
      .set({ role: parsed.role })
      .where(
        and(
          eq(memberships.workspaceId, workspace.id),
          eq(memberships.userId, parsed.userId),
        ),
      )
      .returning();
    await tx.insert(auditLogs).values({
      action: "membership.role_changed",
      actorId: workspace.user.id,
      metadata: { from: existing.role, to: parsed.role },
      resourceId: parsed.userId,
      resourceType: "membership",
      workspaceId: workspace.id,
    });
    return updated;
  });
};

export const removeMember = async (workspaceSlug: string, userId: string) => {
  const workspace = await requireWorkspace(workspaceSlug, "owner");
  return db.transaction(async (tx) => {
    await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspace.id))
      .for("update");
    await verifyActorStillOwnsWorkspace(tx, workspace.id, workspace.user.id);
    const [existing] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.workspaceId, workspace.id),
          eq(memberships.userId, userId),
        ),
      )
      .limit(1)
      .for("update");
    if (!existing) throw notFoundError("Membership not found");
    if (existing.role === "owner") {
      await ensureAnotherOwner(tx, workspace.id, userId);
    }
    await tx
      .delete(memberships)
      .where(
        and(
          eq(memberships.workspaceId, workspace.id),
          eq(memberships.userId, userId),
        ),
      );
    await tx.insert(auditLogs).values({
      action: "membership.removed",
      actorId: workspace.user.id,
      metadata: { role: existing.role },
      resourceId: userId,
      resourceType: "membership",
      workspaceId: workspace.id,
    });
    return { userId };
  });
};
