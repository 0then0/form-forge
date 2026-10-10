"use client";

import { Badge, Button, EmptyState, Select, Skeleton } from "@form-forge/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { Download } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { readApiData } from "@/lib/client-api";
import { LocalDateTime } from "@/components/local-date-time";

type SubmissionRow = {
  createdAt: string;
  deliveryStatus: "pending" | "processing" | "succeeded" | "failed";
  formId: string;
  formName: string;
  id: string;
  normalizedValues: Record<string, string | number | boolean>;
  versionNumber: number;
};

type SubmissionPage = {
  data: SubmissionRow[];
  nextCursor: string | null;
};

const statusTone = {
  failed: "danger",
  pending: "warning",
  processing: "info",
  succeeded: "success",
} as const;

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, SubmissionRow>();

export const SubmissionsTable = ({
  forms,
  workspaceSlug,
}: {
  forms: Array<{ id: string; name: string }>;
  workspaceSlug: string;
}) => {
  const [formId, setFormId] = useState("");
  const [status, setStatus] = useState("");
  const query = useInfiniteQuery({
    initialPageParam: "",
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam);
      if (formId) params.set("formId", formId);
      if (status) params.set("deliveryStatus", status);
      const response = await fetch(
        `/api/admin/workspaces/${workspaceSlug}/submissions?${params}`,
      );
      return readApiData<SubmissionPage>(
        response,
        "Could not load submissions",
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    queryKey: ["submissions", workspaceSlug, formId, status],
  });
  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );
  const exportParams = new URLSearchParams();
  if (formId) exportParams.set("formId", formId);
  if (status) exportParams.set("deliveryStatus", status);
  const exportHref = `/api/admin/workspaces/${workspaceSlug}/submissions/export${
    exportParams.size > 0 ? `?${exportParams}` : ""
  }`;
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("formName", {
          cell: (cell) => (
            <Link
              href={`/app/${workspaceSlug}/submissions/${cell.row.original.id}`}
              className="font-medium text-slate-950 hover:underline"
            >
              {cell.getValue()}
            </Link>
          ),
          header: "Form",
        }),
        columnHelper.accessor("versionNumber", {
          cell: (cell) => `v${cell.getValue()}`,
          header: "Version",
        }),
        columnHelper.accessor("normalizedValues", {
          cell: (cell) => {
            const preview = Object.entries(cell.getValue())
              .slice(0, 2)
              .map(([key, value]) => `${key}: ${String(value)}`)
              .join(" · ");
            return (
              <span className="line-clamp-1 max-w-md text-slate-600">
                {preview || "No values"}
              </span>
            );
          },
          header: "Values",
        }),
        columnHelper.accessor("deliveryStatus", {
          cell: (cell) => (
            <Badge tone={statusTone[cell.getValue()]}>{cell.getValue()}</Badge>
          ),
          header: "Delivery",
        }),
        columnHelper.accessor("createdAt", {
          cell: (cell) => <LocalDateTime value={cell.getValue()} />,
          header: "Received",
        }),
      ]),
    [workspaceSlug],
  );
  const table = useTable({
    features,
    columns,
    data: rows,
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          aria-label="Filter by delivery status"
          className="w-48"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All delivery statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
        </Select>
        <Select
          aria-label="Filter by form"
          className="w-56"
          value={formId}
          onChange={(event) => setFormId(event.target.value)}
        >
          <option value="">All forms</option>
          {forms.map((form) => (
            <option key={form.id} value={form.id}>
              {form.name}
            </option>
          ))}
        </Select>
        <Button asChild className="ml-auto" variant="secondary">
          <a href={exportHref}>
            <Download className="size-4" /> Export CSV
          </a>
        </Button>
      </div>

      {query.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: Placeholder rows have a fixed order and no state.
            <Skeleton key={index} className="h-14" />
          ))}
        </div>
      ) : query.error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          {query.error.message}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No submissions"
          description="Submissions from published hosted forms will appear here."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} className="px-4 py-3 font-medium">
                      {header.isPlaceholder ? null : (
                        <table.FlexRender header={header} />
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-slate-100">
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  {row.getAllCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 whitespace-nowrap">
                      <table.FlexRender cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {query.hasNextPage ? (
        <div className="mt-4 text-center">
          <Button
            disabled={query.isFetchingNextPage}
            variant="secondary"
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
};
