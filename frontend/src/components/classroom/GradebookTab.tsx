"use client";

/**
 * 강좌 성적표 — 과제 점수 + 코스웨어 문제세트 점수를 학생×항목 매트릭스로 표시.
 * admin/교사: 전원 / 학생: 본인 행만 (백엔드 GET .../grades가 role 따라 필터).
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { BarChart3, Loader2 } from "lucide-react";

interface GradeColumn {
  key: string;
  kind: "assignment" | "problemset";
  id: number;
  title: string;
  max_score?: number | null;
  total?: number;
}
interface CellAssignment { score: number | null; status: string }
interface CellProblemset { answered: number; total: number; earned: number; percent: number | null }
interface GradeRow {
  student_id: number;
  name: string;
  grade: number | null;
  class_number: number | null;
  student_number: number | null;
  cells: Record<string, CellAssignment | CellProblemset>;
}
interface GradebookData { columns: GradeColumn[]; rows: GradeRow[]; role: string }

const pad2 = (n: number | null) => (n == null ? "" : String(n).padStart(2, "0"));
const stuNo = (r: GradeRow) =>
  r.grade != null && r.class_number != null && r.student_number != null
    ? `${r.grade}${pad2(r.class_number)}${pad2(r.student_number)}`
    : "";

export default function GradebookTab({ cid }: { cid: number }) {
  const [data, setData] = useState<GradebookData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const d = await api.get<GradebookData>(`/api/classroom/courses/${cid}/grades`);
        if (alive) setData(d);
      } catch {
        if (alive) setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [cid]);

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Loader2 size={28} className="mx-auto text-accent animate-spin" />
      </div>
    );
  }

  if (!data || data.columns.length === 0) {
    return (
      <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-16 text-center">
        <BarChart3 size={32} className="mx-auto text-text-tertiary opacity-30 mb-3" />
        <div className="text-body text-text-secondary mb-1">집계할 성적이 없습니다</div>
        <div className="text-caption text-text-tertiary">
          채점된 과제나 게시된 문제 세트가 생기면 여기에 표시됩니다.
        </div>
      </div>
    );
  }

  const renderCell = (col: GradeColumn, cell?: CellAssignment | CellProblemset) => {
    if (!cell) return <span className="text-text-tertiary">—</span>;
    if (col.kind === "assignment") {
      const c = cell as CellAssignment;
      if (c.score == null) {
        return (
          <span className="text-text-tertiary text-[11px]">
            {c.status === "turned_in" ? "제출(미채점)" : "—"}
          </span>
        );
      }
      return (
        <span className="font-medium text-text-primary">
          {c.score}
          {col.max_score ? <span className="text-text-tertiary">/{col.max_score}</span> : null}
        </span>
      );
    }
    const c = cell as CellProblemset;
    return (
      <span className="font-medium text-text-primary">
        {c.percent != null ? `${c.percent}%` : "—"}
        <span className="text-text-tertiary text-[11px]"> ({c.answered}/{c.total})</span>
      </span>
    );
  };

  return (
    <div className="bg-bg-primary border border-border-default rounded-lg overflow-x-auto">
      <table className="w-full text-caption border-collapse">
        <thead>
          <tr className="border-b border-border-default bg-bg-secondary">
            <th className="text-left px-3 py-2 font-semibold text-text-secondary sticky left-0 bg-bg-secondary z-10">
              학생
            </th>
            {data.columns.map((col) => (
              <th key={col.key} className="px-3 py-2 font-semibold text-text-secondary whitespace-nowrap text-center">
                <div className="flex items-center justify-center gap-1">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${col.kind === "assignment" ? "bg-blue-400" : "bg-violet-400"}`} />
                  <span className="max-w-[160px] truncate" title={col.title}>{col.title}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.length === 0 ? (
            <tr>
              <td colSpan={data.columns.length + 1} className="px-3 py-8 text-center text-text-tertiary">
                등록된 학생이 없습니다.
              </td>
            </tr>
          ) : (
            data.rows.map((r) => (
              <tr key={r.student_id} className="border-b border-border-default last:border-0 hover:bg-bg-secondary/40">
                <td className="px-3 py-2 whitespace-nowrap sticky left-0 bg-bg-primary z-10">
                  <span className="font-medium text-text-primary">{r.name}</span>
                  {stuNo(r) && <span className="text-text-tertiary text-[11px] ml-1.5">{stuNo(r)}</span>}
                </td>
                {data.columns.map((col) => (
                  <td key={col.key} className="px-3 py-2 text-center whitespace-nowrap">
                    {renderCell(col, r.cells[col.key])}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div className="px-3 py-2 text-[11px] text-text-tertiary border-t border-border-default flex items-center gap-3">
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400" /> 과제
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-400" /> 문제 세트 (정답률)
        </span>
      </div>
    </div>
  );
}
