"use client";

/**
 * 공통 데이터 테이블 — 헤더/행/페이지네이션/빈 상태/로딩까지 표준화.
 *
 * 사용 예:
 *   <DataTable
 *     columns={[
 *       { key: "title", label: "제목" },
 *       { key: "status", label: "상태", render: (row) => <Badge>{row.status}</Badge> },
 *     ]}
 *     rows={items}
 *     keyExtractor={(row) => row.id}
 *     loading={loading}
 *     emptyText="등록된 항목이 없습니다"
 *     page={page}
 *     totalPages={totalPages}
 *     onPageChange={setPage}
 *     totalCount={total}
 *   />
 */

import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search, Download, ArrowUp, ArrowDown } from "lucide-react";

export interface DataTableColumn<T> {
  key: string;
  label: ReactNode;
  /** 셀 렌더 커스텀. 미지정 시 row[key] */
  render?: (row: T, rowIndex: number) => ReactNode;
  /** th 추가 클래스 (정렬 등) */
  thClassName?: string;
  /** td 추가 클래스 */
  tdClassName?: string;
  /** 컬럼 너비 (예: "w-32") */
  width?: string;
  /** 우측/중앙 정렬 */
  align?: "left" | "center" | "right";
  /** 정렬 가능 (이 컬럼 헤더 클릭 시 정렬). row[key]로 비교 */
  sortable?: boolean;
  /** 정렬 시 사용할 값 추출 (지정 안 하면 row[key]) */
  sortValue?: (row: T) => string | number | null | undefined;
  /** CSV export에서 사용할 값 추출 (지정 안 하면 row[key]) */
  csvValue?: (row: T) => string | number | null | undefined;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  keyExtractor: (row: T, index: number) => string | number;
  loading?: boolean;
  emptyText?: string;
  /** 페이지네이션 (선택) */
  page?: number;
  totalPages?: number;
  totalCount?: number;
  onPageChange?: (page: number) => void;
  /** 행 클릭 콜백 (선택) */
  onRowClick?: (row: T) => void;
  /** 행별 강조 (선택) */
  rowClassName?: (row: T) => string;
  /** 클라이언트측 검색 활성화 (지정 시 검색 input 노출) */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** CSV export 버튼 노출 + 다운로드 파일명 */
  exportable?: boolean;
  exportFileName?: string;
}

export function DataTable<T>({
  columns,
  rows,
  keyExtractor,
  loading,
  emptyText = "데이터가 없습니다",
  page,
  totalPages,
  totalCount,
  onPageChange,
  onRowClick,
  rowClassName,
  searchable,
  searchPlaceholder = "검색...",
  exportable,
  exportFileName = "data.csv",
}: DataTableProps<T>) {
  const alignCls = (a?: "left" | "center" | "right") =>
    a === "center" ? "text-center" : a === "right" ? "text-right" : "text-left";

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  // 클라이언트 측 필터/정렬 — 페이지네이션은 서버측 가정, 검색·정렬은 현재 페이지 행 기준.
  const visibleRows = useMemo(() => {
    let out = rows;
    if (searchable && search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((row) =>
        columns.some((c) => {
          const v = c.csvValue ? c.csvValue(row) : (row as any)[c.key];
          return v != null && String(v).toLowerCase().includes(q);
        }),
      );
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.sortable) {
        const get = (r: T) =>
          col.sortValue ? col.sortValue(r) : (r as any)[col.key];
        out = [...out].sort((a, b) => {
          const va = get(a), vb = get(b);
          if (va == null && vb == null) return 0;
          if (va == null) return 1;
          if (vb == null) return -1;
          if (va < vb) return sort.dir === "asc" ? -1 : 1;
          if (va > vb) return sort.dir === "asc" ? 1 : -1;
          return 0;
        });
      }
    }
    return out;
  }, [rows, search, sort, searchable, columns]);

  const toggleSort = (key: string) => {
    setSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: "asc" };
      if (cur.dir === "asc") return { key, dir: "desc" };
      return null;  // 3번째 클릭 → 해제
    });
  };

  const downloadCsv = () => {
    const headers = columns.map((c) => typeof c.label === "string" ? c.label : c.key);
    const csv = [headers.join(",")];
    for (const row of visibleRows) {
      const cells = columns.map((c) => {
        const v = c.csvValue ? c.csvValue(row) : (row as any)[c.key];
        if (v == null) return "";
        const s = String(v).replace(/"/g, '""');
        return /[",\n]/.test(s) ? `"${s}"` : s;
      });
      csv.push(cells.join(","));
    }
    const BOM = "﻿";
    const blob = new Blob([BOM + csv.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {(searchable || exportable) && (
        <div className="flex items-center gap-2 mb-2">
          {searchable && (
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
          )}
          {exportable && (
            <button
              onClick={downloadCsv}
              className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
              title="현재 페이지 + 검색 결과를 CSV로 다운로드"
            >
              <Download size={14} /> CSV
            </button>
          )}
          {searchable && search && (
            <span className="text-caption text-text-tertiary">
              {visibleRows.length}/{rows.length}건
            </span>
          )}
        </div>
      )}
      <div className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-secondary">
              {columns.map((c) => {
                const isSorted = sort?.key === c.key;
                const sortable = c.sortable;
                return (
                  <th
                    key={c.key}
                    onClick={sortable ? () => toggleSort(c.key) : undefined}
                    className={`px-4 py-2 ${alignCls(c.align)} text-caption text-text-tertiary font-medium ${c.width ?? ""} ${c.thClassName ?? ""} ${sortable ? "cursor-pointer select-none hover:text-text-primary" : ""}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {sortable && isSorted && (
                        sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, idx) => (
              <tr
                key={keyExtractor(row, idx)}
                className={`border-t border-border-default hover:bg-bg-secondary ${
                  onRowClick ? "cursor-pointer" : ""
                } ${rowClassName ? rowClassName(row) : ""}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-2 text-body text-text-primary ${alignCls(c.align)} ${c.tdClassName ?? ""}`}>
                    {c.render ? c.render(row, idx) : (row as any)[c.key]}
                  </td>
                ))}
              </tr>
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-body text-text-tertiary">
                  {loading ? "로딩 중..." : search ? "검색 결과가 없습니다" : emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages !== undefined && totalPages > 1 && onPageChange && page !== undefined && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page === 1}
            className="p-1 hover:bg-bg-secondary rounded disabled:opacity-30"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-caption text-text-secondary">
            {page} / {totalPages}
            {totalCount !== undefined && ` (${totalCount}건)`}
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="p-1 hover:bg-bg-secondary rounded disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </>
  );
}
