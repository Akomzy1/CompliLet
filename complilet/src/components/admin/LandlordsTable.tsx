"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { PLAN_LABEL, planBadgeClass, type LandlordPlan } from "@/lib/admin-plans";

export interface LandlordTableRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string;
  plan: string;
  stripe_subscription_id: string | null;
  created_at: string;
  updated_at: string;
  properties_count: number;
  tenancies_count: number;
  last_active_at: string | null;
  estimated_mrr_pence: number;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtGbp(pence: number): string {
  if (pence === 0) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
  }).format(pence / 100);
}

interface Props {
  rows: LandlordTableRow[];
}

export function LandlordsTable({ rows }: Props) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "last_active_at", desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns = useMemo<ColumnDef<LandlordTableRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Landlord",
        cell: ({ row }) => (
          <Link
            href={`/admin/landlords/${row.original.id}`}
            className="block min-w-0 hover:underline"
          >
            <p className="truncate font-medium text-admin-ink">
              {row.original.name ?? "(unnamed)"}
            </p>
            <p className="truncate text-xs text-admin-mute">
              {row.original.email ?? row.original.phone}
            </p>
          </Link>
        ),
      },
      {
        accessorKey: "plan",
        header: "Plan",
        cell: ({ row }) => {
          const plan = row.original.plan as LandlordPlan;
          return (
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${planBadgeClass(plan)}`}
            >
              {PLAN_LABEL[plan] ?? plan}
            </span>
          );
        },
      },
      {
        accessorKey: "created_at",
        header: "Signup",
        cell: ({ row }) => (
          <span className="text-sm text-admin-mute">
            {fmtDate(row.original.created_at)}
          </span>
        ),
      },
      {
        accessorKey: "properties_count",
        header: "Properties",
        cell: ({ row }) => (
          <span className="tabular-nums text-sm text-admin-ink">
            {row.original.properties_count}
          </span>
        ),
      },
      {
        accessorKey: "tenancies_count",
        header: "Active tenancies",
        cell: ({ row }) => (
          <span className="tabular-nums text-sm text-admin-ink">
            {row.original.tenancies_count}
          </span>
        ),
      },
      {
        accessorKey: "stripe_subscription_id",
        header: "Subscription",
        cell: ({ row }) => {
          const sub = row.original.stripe_subscription_id;
          if (sub) {
            return (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-admin-teal">
                <span className="h-1.5 w-1.5 rounded-full bg-admin-teal" aria-hidden />
                Active
              </span>
            );
          }
          return (
            <span className="inline-flex items-center gap-1 text-xs text-admin-mute">
              <span className="h-1.5 w-1.5 rounded-full bg-admin-mute" aria-hidden />
              —
            </span>
          );
        },
      },
      {
        accessorKey: "last_active_at",
        header: "Last active",
        cell: ({ row }) => (
          <span className="text-sm text-admin-mute">
            {fmtDate(row.original.last_active_at)}
          </span>
        ),
      },
      {
        accessorKey: "estimated_mrr_pence",
        header: "MRR",
        cell: ({ row }) => (
          <span className="tabular-nums text-sm font-medium text-admin-ink">
            {fmtGbp(row.original.estimated_mrr_pence)}
          </span>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _col, filterValue: string) => {
      const q = filterValue.toLowerCase();
      return (
        (row.original.name ?? "").toLowerCase().includes(q) ||
        (row.original.email ?? "").toLowerCase().includes(q) ||
        row.original.phone.toLowerCase().includes(q)
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  const totalRows = table.getFilteredRowModel().rows.length;
  const pageIndex = table.getState().pagination.pageIndex;
  const pageSize = table.getState().pagination.pageSize;
  const pageStart = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const pageEnd = Math.min((pageIndex + 1) * pageSize, totalRows);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="relative flex-1 max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-admin-mute"
            aria-hidden
          />
          <input
            type="search"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Search by name, email, or phone"
            className="w-full rounded-lg border border-admin-line bg-white py-2 pl-9 pr-3 text-sm text-admin-ink placeholder-admin-mute outline-none transition focus:border-admin-teal focus:ring-2 focus:ring-admin-teal/20"
          />
        </label>
        <span className="text-xs text-admin-mute">
          {totalRows.toLocaleString()} landlord
          {totalRows === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-admin-line bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="border-b border-admin-line bg-admin-cream/50">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-admin-mute"
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 hover:text-admin-ink"
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          <ArrowUpDown className="h-3 w-3" aria-hidden />
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-admin-line">
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-16 text-center text-sm text-admin-mute"
                >
                  No landlords match your search.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="transition hover:bg-admin-cream/40"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-admin-mute">
        <p>
          Showing{" "}
          <span className="font-medium text-admin-ink">
            {pageStart}–{pageEnd}
          </span>{" "}
          of <span className="font-medium text-admin-ink">{totalRows}</span>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-admin-line bg-white text-admin-ink transition hover:bg-admin-cream disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <span className="tabular-nums">
            Page {pageIndex + 1} of {Math.max(1, table.getPageCount())}
          </span>
          <button
            type="button"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-admin-line bg-white text-admin-ink transition hover:bg-admin-cream disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
