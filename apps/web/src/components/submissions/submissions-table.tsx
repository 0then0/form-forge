"use client";

import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  Skeleton,
} from "@form-forge/ui";
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
  processingStatus: "new" | "processed";
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
  const [processingStatus, setProcessingStatus] = useState("");
  const [filterDraft, setFilterDraft] = useState({
    q: "",
    from: "",
    until: "",
  });
  const [filters, setFilters] = useState(filterDraft);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [valueColumns, setValueColumns] = useState<string[]>([]);
  const appendFilters = (params: URLSearchParams) => {
    if (processingStatus) params.set("processingStatus", processingStatus);
    if (filters.q) params.set("q", filters.q);
    if (filters.from) params.set("from", `${filters.from}T00:00:00Z`);
    if (filters.until) params.set("until", `${filters.until}T00:00:00Z`);
  };
  const query = useInfiniteQuery({
    initialPageParam: "",
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam);
      if (formId) params.set("formId", formId);
      if (status) params.set("deliveryStatus", status);
      appendFilters(params);
      const response = await fetch(
        `/api/admin/workspaces/${workspaceSlug}/submissions?${params}`,
      );
      return readApiData<SubmissionPage>(
        response,
        "Could not load submissions",
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    queryKey: [
      "submissions",
      workspaceSlug,
      formId,
      status,
      processingStatus,
      filters,
    ],
  });
  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );
  const exportParams = new URLSearchParams();
  if (formId) exportParams.set("formId", formId);
  if (status) exportParams.set("deliveryStatus", status);
  appendFilters(exportParams);
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
              className="font-medium text-slate-950 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-blue-600"
            >
              {cell.getValue()}
            </Link>
          ),
          header: "Form",
        }),
        ...(!hiddenColumns.includes("Version")
          ? [
              columnHelper.accessor("versionNumber", {
                cell: (cell) => `v${cell.getValue()}`,
                header: "Version",
              }),
            ]
          : []),
        ...(!hiddenColumns.includes("Values")
          ? [
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
            ]
          : []),
        ...valueColumns.map((key) =>
          columnHelper.accessor((row) => row.normalizedValues[key], {
            id: `value:${key}`,
            header: key,
            cell: (cell) => String(cell.getValue() ?? ""),
          }),
        ),
        ...(!hiddenColumns.includes("Processing")
          ? [
              columnHelper.accessor("processingStatus", {
                header: "Processing",
                cell: (cell) =>
                  cell.getValue() === "processed" ? "Processed" : "New",
              }),
            ]
          : []),
        ...(!hiddenColumns.includes("Delivery")
          ? [
              columnHelper.accessor("deliveryStatus", {
                cell: (cell) => (
                  <Badge tone={statusTone[cell.getValue()]}>
                    {cell.getValue()}
                  </Badge>
                ),
                header: "Delivery",
              }),
            ]
          : []),
        ...(!hiddenColumns.includes("Received")
          ? [
              columnHelper.accessor("createdAt", {
                cell: (cell) => <LocalDateTime value={cell.getValue()} />,
                header: "Received",
              }),
            ]
          : []),
      ]),
    [workspaceSlug, hiddenColumns, valueColumns],
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
        <Select
          aria-label="Filter by processing status"
          className="w-48"
          value={processingStatus}
          onChange={(event) => setProcessingStatus(event.target.value)}
        >
          <option value="">All processing statuses</option>
          <option value="new">New</option>
          <option value="processed">Processed</option>
        </Select>
        <Button asChild className="ml-auto" variant="secondary">
          <a href={exportHref}>
            <Download className="size-4" /> Export CSV
          </a>
        </Button>
      </div>

      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setFilters({ ...filterDraft, q: filterDraft.q.trim() });
        }}
      >
        <label className="text-sm">
          From (UTC, inclusive)
          <Input
            type="date"
            value={filterDraft.from}
            onChange={(event) =>
              setFilterDraft({ ...filterDraft, from: event.target.value })
            }
          />
        </label>
        <label className="text-sm">
          Until (UTC, exclusive)
          <Input
            type="date"
            value={filterDraft.until}
            onChange={(event) =>
              setFilterDraft({ ...filterDraft, until: event.target.value })
            }
          />
        </label>
        <label className="text-sm">
          Search answer words
          <Input
            type="search"
            minLength={2}
            maxLength={100}
            value={filterDraft.q}
            onChange={(event) =>
              setFilterDraft({ ...filterDraft, q: event.target.value })
            }
          />
        </label>
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
      </form>
      <details className="mb-4 text-sm">
        <summary className="cursor-pointer">Displayed columns</summary>
        <p className="my-2 text-slate-600">
          Form always stays visible. Select up to 20 answer columns from loaded
          rows. CSV includes all answer fields matching the filters.
        </p>
        <div className="flex flex-wrap gap-4">
          {["Version", "Values", "Processing", "Delivery", "Received"].map(
            (column) => (
              <label key={column} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!hiddenColumns.includes(column)}
                  onChange={(event) =>
                    setHiddenColumns((current) =>
                      event.target.checked
                        ? current.filter((value) => value !== column)
                        : [...current, column],
                    )
                  }
                />
                {column}
              </label>
            ),
          )}
          {Array.from(
            new Set([
              ...valueColumns,
              ...rows.flatMap((row) => Object.keys(row.normalizedValues)),
            ]),
          )
            .sort()
            .slice(0, 500)
            .map((key) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={valueColumns.includes(key)}
                  disabled={
                    !valueColumns.includes(key) && valueColumns.length >= 20
                  }
                  onChange={(event) =>
                    setValueColumns((current) =>
                      event.target.checked
                        ? [...current, key]
                        : current.filter((value) => value !== key),
                    )
                  }
                />
                Answer: {key}
              </label>
            ))}
        </div>
      </details>

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
                <tr
                  key={row.id}
                  className="relative hover:bg-slate-50 focus-within:bg-slate-50"
                >
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
