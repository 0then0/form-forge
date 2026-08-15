"use client";

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
} from "@form-forge/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { readApiData } from "@/lib/client-api";

type Role = "owner" | "editor" | "viewer";
type Member = {
  email: string | null;
  name: string | null;
  role: Role;
  userId: string;
};

export const MembersManager = ({
  canManage,
  currentUserId,
  initialMembers,
  workspaceSlug,
}: {
  canManage: boolean;
  currentUserId: string;
  initialMembers: Member[];
  workspaceSlug: string;
}) => {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const mutate = async (
    method: "POST" | "PATCH" | "DELETE",
    body?: object,
    userId?: string,
  ) => {
    setPending(true);
    setError(undefined);
    try {
      const suffix = userId ? `?userId=${encodeURIComponent(userId)}` : "";
      const response = await fetch(
        `/api/admin/workspaces/${workspaceSlug}/members${suffix}`,
        {
          ...(body ? { body: JSON.stringify(body) } : {}),
          headers: { "Content-Type": "application/json" },
          method,
        },
      );
      await readApiData(response, "Membership update failed");
      setEmail("");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Membership update failed",
      );
    } finally {
      setPending(false);
    }
  };

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void mutate("POST", { email, role });
  };

  return (
    <div className="space-y-6">
      {error ? <Alert>{error}</Alert> : null}
      <div className="space-y-3">
        {initialMembers.map((member) => (
          <Card key={member.userId}>
            <CardContent className="flex flex-wrap items-center gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{member.name ?? "Unnamed user"}</p>
                <p className="truncate text-sm text-slate-600">
                  {member.email}
                </p>
              </div>
              {canManage ? (
                <Select
                  aria-label={`Role for ${member.email ?? member.name ?? "member"}`}
                  className="w-32"
                  disabled={pending}
                  value={member.role}
                  onChange={(event) =>
                    void mutate("PATCH", {
                      role: event.target.value,
                      userId: member.userId,
                    })
                  }
                >
                  <option value="owner">Owner</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </Select>
              ) : (
                <Badge>{member.role}</Badge>
              )}
              {canManage ? (
                <Button
                  disabled={pending || member.userId === currentUserId}
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void mutate("DELETE", undefined, member.userId)
                  }
                >
                  Remove
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      {canManage ? (
        <Card>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-[1fr_150px_auto] sm:items-end"
              onSubmit={add}
            >
              <div className="space-y-2">
                <Label htmlFor="member-email">Add existing user by email</Label>
                <Input
                  id="member-email"
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="member-role">Role</Label>
                <Select
                  id="member-role"
                  value={role}
                  onChange={(event) => setRole(event.target.value as Role)}
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="owner">Owner</option>
                </Select>
              </div>
              <Button type="submit" disabled={pending || !email.trim()}>
                {pending ? "Adding…" : "Add member"}
              </Button>
            </form>
            <p className="mt-3 text-xs text-slate-500">
              The user must sign in once before they can be added. Email
              invitations are outside this MVP.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};
