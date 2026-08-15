"use client";

import { Select } from "@form-forge/ui";
import { useRouter } from "next/navigation";

type Workspace = { name: string; slug: string };

export const WorkspaceSwitcher = ({
  currentSlug,
  workspaces,
}: {
  currentSlug: string;
  workspaces: Workspace[];
}) => {
  const router = useRouter();

  return (
    <Select
      aria-label="Workspace"
      className="h-9 min-w-44 py-1"
      value={currentSlug}
      onChange={(event) => {
        router.push(`/app/${event.target.value}/forms`);
      }}
    >
      {workspaces.map((workspace) => (
        <option key={workspace.slug} value={workspace.slug}>
          {workspace.name}
        </option>
      ))}
    </Select>
  );
};
