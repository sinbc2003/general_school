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

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

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
}: DataTableProps<T>) {
  const alignCls = (a?: "left" | "center" | "right") =>
    a === "center" ? "text-center" : a === "right" ? "text-right" : "text-left";

  return (
    <>
      <div className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-secondary">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-4 py-2 ${alignCls(c.align)} text-caption text-text-tertiary font-medium ${c.width ?? ""} ${c.thClassName ?? ""}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-body text-text-tertiary">
                  {loading ? "로딩 중..." : emptyText}
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
