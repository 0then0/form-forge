"use client";

import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  Skeleton,
} from "@form-forge/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

const emptyRows: SubmissionRow[] = [];
const listChangedMessage =
  "The submissions list has changed. Review your selection and try again.";

const statusTone = {
  failed: "danger",
  pending: "warning",
  processing: "info",
  succeeded: "success",
} as const;

const features = tableFeatures({});
const columnHelper = createColumnHelper<typeof features, SubmissionRow>();

export const SubmissionsTable = ({
  canEdit,
  forms,
  workspaceSlug,
}: {
  canEdit: boolean;
  forms: Array<{ id: string; name: string }>;
  workspaceSlug: string;
}) => {
  const queryClient = useQueryClient();
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
  const [pageCursors, setPageCursors] = useState<string[]>([]);
  const [selection, setSelection] = useState<string[] | "invalidated">([]);
  const cursor = pageCursors.at(-1);
  const submissionsPath = `/api/admin/workspaces/${workspaceSlug}/submissions`;
  const filterParams = new URLSearchParams();
  if (formId) filterParams.set("formId", formId);
  if (status) filterParams.set("deliveryStatus", status);
  if (processingStatus) filterParams.set("processingStatus", processingStatus);
  if (filters.q) filterParams.set("q", filters.q);
  if (filters.from) filterParams.set("from", `${filters.from}T00:00:00Z`);
  if (filters.until) filterParams.set("until", `${filters.until}T00:00:00Z`);
  const listKey = ["submissions", workspaceSlug];
  const queryKey = [...listKey, filterParams.toString(), cursor];
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams(filterParams);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`${submissionsPath}?${params}`, { signal });
      return readApiData<SubmissionPage>(
        response,
        "Could not load submissions",
      );
    },
  });
  const rows = query.data?.data ?? emptyRows;
  const nextCursor = query.data?.nextCursor;
  const selectedIds = selection === "invalidated" ? [] : selection;
  const selectedRows = rows.filter((row) => selectedIds.includes(row.id));
  if (selectedRows.length !== selectedIds.length) {
    // A later refresh can bring the missing response back to the page.
    setSelection("invalidated");
  }
  const selectedFormId = selectedRows[0]?.formId;
  const singleFormPage = rows.every((row) => row.formId === rows[0]?.formId);
  const allSelected = selectedIds.length === rows.length;
  const mutationKey = ["mark-submissions-processed", workspaceSlug];
  const markProcessed = useMutation({
    mutationKey,
    mutationFn: async (input: { formId: string; submissionIds: string[] }) => {
      const response = await fetch(`${submissionsPath}/mark-processed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (response.status === 409) return "conflict";
      await readApiData(response, "Could not mark responses as processed");
      return "processed";
    },
    onSuccess: async () => {
      setSelection([]);
      await queryClient.invalidateQueries({ queryKey: listKey });
      if (
        cursor &&
        queryClient.getQueryData<SubmissionPage>(queryKey)?.data.length === 0
      ) {
        setPageCursors([]);
      }
    },
  });
  const pending = markProcessed.isPending;
  const batchError =
    markProcessed.data === "conflict" || selection === "invalidated"
      ? listChangedMessage
      : markProcessed.error?.message;
  const updateSelection = (ids: string[]) => {
    setSelection(ids);
    markProcessed.reset();
  };
  const changePage = (cursors: string[]) => {
    setPageCursors(cursors);
    updateSelection([]);
  };
  const exportHref = `${submissionsPath}/export${
    filterParams.size > 0 ? `?${filterParams}` : ""
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
    getRowId: (row) => row.id,
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          aria-label="Filter by delivery status"
          className="w-48"
          disabled={pending}
          value={status}
          onChange={(event) => {
            changePage([]);
            setStatus(event.target.value);
          }}
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
          disabled={pending}
          value={formId}
          onChange={(event) => {
            changePage([]);
            setFormId(event.target.value);
          }}
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
          disabled={pending}
          value={processingStatus}
          onChange={(event) => {
            changePage([]);
            setProcessingStatus(event.target.value);
          }}
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
          changePage([]);
          setFilters({ ...filterDraft, q: filterDraft.q.trim() });
        }}
      >
        <label className="text-sm">
          From (UTC, inclusive)
          <Input
            type="date"
            disabled={pending}
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
            disabled={pending}
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
            disabled={pending}
            minLength={2}
            maxLength={100}
            value={filterDraft.q}
            onChange={(event) =>
              setFilterDraft({ ...filterDraft, q: event.target.value })
            }
          />
        </label>
        <Button type="submit" variant="secondary" disabled={pending}>
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

      {canEdit && (rows.length > 0 || pending) ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={pending || !selectedFormId || query.isError}
            onClick={() => {
              if (selectedFormId && !queryClient.isMutating({ mutationKey })) {
                markProcessed.mutate({
                  formId: selectedFormId,
                  submissionIds: selectedIds,
                });
              }
            }}
          >
            {pending
              ? "Marking as processed…"
              : `Mark as processed (${selectedIds.length})`}
          </Button>
          {singleFormPage ? null : (
            <p className="text-sm text-slate-600">
              Select responses from one form at a time.
            </p>
          )}
        </div>
      ) : null}
      {batchError ? <Alert className="mb-4">{batchError}</Alert> : null}
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
          description={
            cursor
              ? "There are no more submissions. Go to the previous page."
              : filterParams.size
                ? "No submissions match the current filters."
                : "Submissions from published hosted forms will appear here."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {canEdit ? (
                    <th scope="col" className="w-px px-4 py-3">
                      {singleFormPage ? (
                        <label className="flex items-center gap-2 whitespace-nowrap">
                          <input
                            type="checkbox"
                            ref={(checkbox) => {
                              if (checkbox)
                                checkbox.indeterminate =
                                  selectedIds.length > 0 && !allSelected;
                            }}
                            checked={allSelected}
                            disabled={pending}
                            onChange={(event) =>
                              updateSelection(
                                event.target.checked
                                  ? rows.map((row) => row.id)
                                  : [],
                              )
                            }
                          />
                          Select this page
                        </label>
                      ) : (
                        <span className="sr-only">Selection</span>
                      )}
                    </th>
                  ) : null}
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
                  {canEdit ? (
                    <td className="px-4 py-3">
                      <input
                        aria-label={`Select response ${row.original.id}`}
                        className="relative z-10"
                        type="checkbox"
                        checked={selectedIds.includes(row.original.id)}
                        disabled={
                          pending ||
                          (selectedFormId !== undefined &&
                            selectedFormId !== row.original.formId)
                        }
                        onChange={(event) =>
                          updateSelection(
                            event.target.checked
                              ? [...selectedIds, row.original.id]
                              : selectedIds.filter(
                                  (id) => id !== row.original.id,
                                ),
                          )
                        }
                      />
                    </td>
                  ) : null}
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

      {cursor || nextCursor ? (
        <div className="mt-4 flex justify-center gap-3">
          <Button
            type="button"
            disabled={pending || !cursor}
            variant="secondary"
            onClick={() => changePage(pageCursors.slice(0, -1))}
          >
            Previous page
          </Button>
          <Button
            type="button"
            disabled={pending || !nextCursor}
            variant="secondary"
            onClick={() => {
              if (nextCursor) changePage([...pageCursors, nextCursor]);
            }}
          >
            Next page
          </Button>
        </div>
      ) : null}
    </div>
  );
};
