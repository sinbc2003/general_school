"use client";

/**
 * 학기 관리 페이지 (최고관리자 전용)
 * - 학기 CRUD
 * - 현재 학기 설정 (is_current=True 단 1개 보장)
 * - 이전 학기 → 다음 학기로 명단 일괄 진급/복제 (dry-run 지원)
 *
 * 모달은 _components/ 디렉토리로 분리. 본 파일은 데이터 fetch + 테이블 + 모달 트리거만.
 */

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Plus,
  Trash2,
  Edit3,
  CalendarRange,
  CheckCircle2,
  Circle,
  ArrowRight,
  School,
  Archive,
  ArchiveRestore,
} from "lucide-react";

import type { Semester } from "@/types";
import { SemesterFormModal } from "./_components/SemesterFormModal";
import { SchoolStructureModal } from "./_components/SchoolStructureModal";
import { PromoteModal } from "./_components/PromoteModal";

export default function SemestersPage() {
  const [items, setItems] = useState<Semester[]>([]);
  const [loading, setLoading] = useState(false);

  // 모달 상태
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [structureSemester, setStructureSemester] = useState<Semester | null>(null);
  const [showPromote, setShowPromote] = useState(false);

  const fetchSemesters = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Semester[]>("/api/timetable/semesters");
      setItems(data);
    } catch (err: any) {
      console.error(err);
      alert(err?.detail || "학기 목록 조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSemesters();
  }, [fetchSemesters]);

  const editingSemester = editingId ? items.find((s) => s.id === editingId) ?? null : null;

  const setCurrent = async (sid: number) => {
    if (!confirm("이 학기를 현재 학기로 지정합니다. 기존 현재 학기는 해제됩니다. 진행하시겠습니까?"))
      return;
    try {
      await api.post(`/api/timetable/semesters/${sid}/set-current`);
      fetchSemesters();
    } catch (err: any) {
      alert(err?.detail || "현재 학기 지정 실패");
    }
  };

  const remove = async (sid: number, name: string) => {
    if (!confirm(`'${name}' 학기를 삭제합니다. 시간표/명단/대회/과제/동아리 데이터가 함께 삭제됩니다. 계속하시겠습니까?`))
      return;
    try {
      await api.delete(`/api/timetable/semesters/${sid}`);
      fetchSemesters();
    } catch (err: any) {
      alert(err?.detail || "삭제 실패");
    }
  };

  const archive = async (sid: number, name: string) => {
    if (!confirm(
      `'${name}' 학기를 보관합니다.\n\n` +
      `보관 후:\n` +
      `· 명단 수정·시간표 편집·직책 변경이 차단됩니다 (조회는 가능 — 생기부/히스토리)\n` +
      `· 보관 상태는 언제든 해제할 수 있습니다.\n\n` +
      `계속하시겠습니까?`,
    )) return;
    try {
      await api.post(`/api/timetable/semesters/${sid}/archive`);
      fetchSemesters();
    } catch (err: any) {
      alert(err?.detail || "보관 실패");
    }
  };

  const unarchive = async (sid: number, name: string) => {
    if (!confirm(`'${name}' 학기의 보관을 해제하고 편집을 다시 허용합니다. 계속하시겠습니까?`)) return;
    try {
      await api.post(`/api/timetable/semesters/${sid}/unarchive`);
      fetchSemesters();
    } catch (err: any) {
      alert(err?.detail || "보관 해제 실패");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-title text-text-primary flex items-center gap-2">
            <CalendarRange size={22} /> 학기 관리
          </h1>
          <p className="text-caption text-text-tertiary mt-1">
            학기 단위로 명단/대회/과제/동아리 데이터가 격리됩니다. 현재 학기는 ★ 표시.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPromote(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
          >
            <ArrowRight size={14} />
            진급/명단 복제
          </button>
          <button
            onClick={() => {
              setEditingId(null);
              setShowForm(true);
            }}
            className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
          >
            <Plus size={14} />
            학기 생성
          </button>
        </div>
      </div>

      <SemesterFormModal
        open={showForm}
        editingId={editingId}
        editingSemester={editingSemester}
        items={items}
        onClose={() => {
          setShowForm(false);
          setEditingId(null);
        }}
        onSaved={fetchSemesters}
      />

      <SchoolStructureModal
        semester={structureSemester}
        onClose={() => setStructureSemester(null)}
        onSaved={fetchSemesters}
      />

      <PromoteModal
        open={showPromote}
        items={items}
        onClose={() => setShowPromote(false)}
        onPromoted={fetchSemesters}
      />

      {/* 테이블 */}
      <div className="bg-bg-primary rounded-lg border border-border-default overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-secondary">
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium w-16">현재</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">학기</th>
              <th className="px-4 py-2 text-left text-caption text-text-tertiary font-medium">기간</th>
              <th className="px-4 py-2 text-center text-caption text-text-tertiary font-medium w-32">작업</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr
                key={s.id}
                className={`border-t border-border-default hover:bg-bg-secondary ${
                  s.is_current ? "bg-cream-100/40" : ""
                } ${s.is_archived ? "opacity-60" : ""}`}
              >
                <td className="px-4 py-2">
                  {s.is_current ? (
                    <span className="inline-flex items-center gap-1 text-caption text-accent font-medium">
                      <CheckCircle2 size={14} /> 현재
                    </span>
                  ) : s.is_archived ? (
                    <span className="inline-flex items-center gap-1 text-caption text-text-tertiary" title={s.archived_at ? `보관 시각: ${s.archived_at.slice(0,16).replace('T',' ')}` : undefined}>
                      <Archive size={14} /> 보관
                    </span>
                  ) : (
                    <button
                      onClick={() => setCurrent(s.id)}
                      className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-accent"
                      title="현재 학기로 지정"
                    >
                      <Circle size={14} /> 지정
                    </button>
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="text-body text-text-primary font-medium">
                    {s.name}
                    {s.is_archived && (
                      <span className="ml-2 text-caption text-text-tertiary font-normal">(보관됨)</span>
                    )}
                  </div>
                  <div className="text-caption text-text-tertiary">{s.year}학년도 · {s.semester}학기</div>
                </td>
                <td className="px-4 py-2 text-body text-text-secondary">
                  {s.start_date?.slice(0, 10)} ~ {s.end_date?.slice(0, 10)}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={() => setStructureSemester(s)}
                      title="학교 구조 설정 (학급 수·과목·부서)"
                      disabled={s.is_archived}
                      className="p-1 hover:bg-bg-primary rounded text-text-tertiary hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <School size={14} />
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(s.id);
                        setShowForm(true);
                      }}
                      title="수정"
                      disabled={s.is_archived}
                      className="p-1 hover:bg-bg-primary rounded text-text-tertiary hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Edit3 size={14} />
                    </button>
                    {s.is_archived ? (
                      <button
                        onClick={() => unarchive(s.id, s.name)}
                        title="보관 해제 — 편집 다시 허용"
                        className="p-1 hover:bg-bg-primary rounded text-text-tertiary hover:text-accent"
                      >
                        <ArchiveRestore size={14} />
                      </button>
                    ) : (
                      <button
                        onClick={() => archive(s.id, s.name)}
                        title={s.is_current ? "현재 학기는 보관 불가 — 먼저 다른 학기를 현재로 지정" : "학기 보관 (편집 차단, 조회 가능)"}
                        disabled={s.is_current}
                        className="p-1 hover:bg-bg-primary rounded text-text-tertiary hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Archive size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => remove(s.id, s.name)}
                      title="삭제"
                      disabled={s.is_current}
                      className="p-1 hover:bg-bg-primary rounded text-text-tertiary hover:text-status-error disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-body text-text-tertiary">
                  {loading ? "로딩 중..." : "학기가 없습니다. '학기 생성'으로 추가하세요."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
