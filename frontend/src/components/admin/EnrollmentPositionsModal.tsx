"use client";

/**
 * 학기 enrollment 한 행에 직책 할당 모달.
 *
 * 운영 시나리오:
 * - 매 학년도 (1학기) 시작 시 enrollment마다 직책 부여
 * - 2학기 생성 시 기본적으로 1학기 직책 자동 복사 (copy_positions=True)
 * - 학기 중간에 업무분장이 약간 바뀌면 이 모달로 행별 수정
 * - "학년도 전체 적용" 옵션: 1학기에 바꾸면 같은 학년도 2학기도 함께 동기화
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Briefcase, Check, X, Calendar } from "lucide-react";

interface PositionTemplate {
  id: number;
  key: string;
  display_name: string;
  category: string;
  permission_count: number;
}

interface AssignedPosition {
  id: number;
  template_id: number;
  template_key: string;
  display_name: string;
  category: string;
  permission_count: number;
}

interface Props {
  open: boolean;
  semesterId: number;
  enrollmentId: number;
  userName: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function EnrollmentPositionsModal({
  open, semesterId, enrollmentId, userName, onClose, onSaved,
}: Props) {
  const [templates, setTemplates] = useState<PositionTemplate[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [initial, setInitial] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyToYear, setApplyToYear] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [tplData, assignedData] = await Promise.all([
          api.get<{ items: PositionTemplate[] }>("/api/permissions/position-templates"),
          api.get<{ items: AssignedPosition[] }>(
            `/api/timetable/semesters/${semesterId}/enrollments/${enrollmentId}/positions`,
          ),
        ]);
        if (cancelled) return;
        setTemplates(tplData.items);
        const ids = new Set(assignedData.items.map((a) => a.template_id));
        setSelected(ids);
        setInitial(ids);
      } catch (err: any) {
        if (!cancelled) alert(err?.detail || "로딩 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, semesterId, enrollmentId]);

  const toggle = (tid: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tid)) next.delete(tid);
      else next.add(tid);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const templateIds = Array.from(selected);
      if (applyToYear) {
        const res = await api.post<{
          synced_enrollments: number[]; skipped_semesters: number[];
        }>(
          `/api/timetable/semesters/${semesterId}/enrollments/${enrollmentId}/positions/sync-year`,
          { template_ids: templateIds },
        );
        alert(`학년도 동기화 완료 — ${res.synced_enrollments.length}개 학기에 적용됨`);
      } else {
        await api.put(
          `/api/timetable/semesters/${semesterId}/enrollments/${enrollmentId}/positions`,
          { template_ids: templateIds },
        );
      }
      onSaved?.();
      onClose();
    } catch (err: any) {
      alert(err?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  // 카테고리별 그룹핑
  const byCategory = new Map<string, PositionTemplate[]>();
  for (const t of templates) {
    if (!byCategory.has(t.category)) byCategory.set(t.category, []);
    byCategory.get(t.category)!.push(t);
  }

  const dirty = (() => {
    if (selected.size !== initial.size) return true;
    return Array.from(selected).some((id) => !initial.has(id));
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`직책 할당: ${userName}`}
      icon={<Briefcase size={18} />}
      maxWidth="xl"
    >
      {loading ? (
        <div className="py-8 text-center text-text-tertiary">로딩 중...</div>
      ) : (
        <div className="space-y-3">
          <div className="p-3 bg-cream-100 border border-cream-300 rounded text-caption text-text-secondary">
            <b>현재 학기</b>에만 적용됩니다. 학년도 전체에 적용하려면 아래 체크.
            새 학기를 생성하면 이 직책이 자동 복사됩니다 (copy_positions 옵션).
          </div>

          {templates.length === 0 ? (
            <div className="py-8 text-center text-body text-text-tertiary">
              직책 템플릿이 없습니다. <br />
              <a href="/permissions" className="text-accent underline">권한 관리 → 직책 권한</a>에서 먼저 만들어주세요.
            </div>
          ) : (
            <div className="border border-border-default rounded max-h-80 overflow-y-auto">
              {Array.from(byCategory.entries()).map(([cat, items]) => (
                <div key={cat}>
                  <div className="bg-bg-tertiary px-3 py-1.5 text-caption font-semibold text-text-secondary sticky top-0">
                    {cat}
                  </div>
                  {items.map((t) => (
                    <label
                      key={t.id}
                      className="flex items-center gap-2 px-3 py-2 border-t border-border-default cursor-pointer hover:bg-bg-secondary"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggle(t.id)}
                        className="rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-body text-text-primary">{t.display_name}</div>
                        <div className="text-caption text-text-tertiary truncate">
                          {t.key} · 권한 {t.permission_count}개
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer p-2 hover:bg-bg-secondary rounded">
            <input
              type="checkbox"
              checked={applyToYear}
              onChange={(e) => setApplyToYear(e.target.checked)}
              className="rounded"
            />
            <Calendar size={14} className="text-text-tertiary" />
            <span className="text-body text-text-primary">
              학년도 전체 동기화 (같은 학년도의 다른 학기에도 동일 적용)
            </span>
          </label>
        </div>
      )}

      <ModalFooter>
        <button
          onClick={onClose}
          className="flex items-center gap-1 px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
        >
          <X size={14} /> 취소
        </button>
        <button
          onClick={save}
          disabled={saving || loading || (!dirty && !applyToYear)}
          className="flex items-center gap-1 px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
        >
          <Check size={14} />
          {saving ? "저장 중..." : applyToYear ? "학년도 적용" : "저장"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
