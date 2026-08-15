import { Skeleton } from "@form-forge/ui";

export default function WorkspaceLoading() {
  return (
    <div className="space-y-4" aria-label="Loading workspace">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
    </div>
  );
}
