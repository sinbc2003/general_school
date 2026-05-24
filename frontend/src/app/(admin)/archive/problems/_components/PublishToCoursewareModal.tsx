"use client";

/**
 * 문제 검색 → 선택한 Problem id로 코스웨어 ProblemSet 생성 (강좌 select).
 *
 * backend POST /api/courseware/courses/{cid}/problem-sets/from-bank 호출.
 * 강좌 list는 /api/courseware/my-problem-sets로 가져옴 (본인 가르치는 강좌).
 */

import { useCallback, useEffect, useState } from "react";
import { X, Send } from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/components/ui/Toast";

interface CourseOption {
  course_id: number;
  course_name: string;
  class_name: string | null;
  semester: { year: number; term: number } | null;
}

interface Props {
  problemIds: number[];
  onClose: () => void;
  onDone: () => void;  // 성공 후 호출 (선택 해제 등)
}

export function PublishToCoursewareModal({ problemIds, onClose, onDone }: Props) {
  const toast = useToast();
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [selectedCid, setSelectedCid] = useState<number | null>(null);

  const [title, setTitle] = useState(`문제 검색 일괄 출제 ${new Date().toLocaleDateString("ko-KR")}`);
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [showSolutionAfterDue, setShowSolutionAfterDue] = useState(true);
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [saving, setSaving] = useState(false);

  const loadCourses = useCallback(async () => {
    setLoadingCourses(true);
    try {
      const res = await api.get<{ courses: any[] }>("/api/courseware/my-problem-sets");
      const opts: CourseOption[] = res.courses.map((c) => ({
        course_id: c.course_id,
        course_name: c.course_name,
        class_name: c.class_name,
        semester: c.semester,
      }));
      setCourses(opts);
      if (opts.length > 0) setSelectedCid(opts[0].course_id);
    } catch (e: any) {
      toast.show(e?.detail || "강좌 조회 실패", "error");
    } finally {
      setLoadingCourses(false);
    }
  }, [toast]);

  useEffect(() => { loadCourses(); }, [loadCourses]);

  const handleSave = async () => {
    if (!selectedCid) {
      toast.show("강좌를 선택하세요", "error");
      return;
    }
    if (!title.trim()) {
      toast.show("제목을 입력하세요", "error");
      return;
    }
    setSaving(true);
    try {
      await api.post(
        `/api/courseware/courses/${selectedCid}/problem-sets/from-bank`,
        {
          title,
          description: description || null,
          problem_ids: problemIds,
          status,
          due_date: dueDate ? new Date(dueDate).toISOString() : null,
          max_attempts: maxAttempts,
          show_solution_after_due: showSolutionAfterDue,
        },
      );
      toast.show(`${problemIds.length}문제 출제 완료`, "success");
      onDone();
      onClose();
    } catch (e: any) {
      toast.show(e?.detail || "출제 실패", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <h2 className="text-h3">코스웨어로 출제 ({problemIds.length}문제)</h2>
          <button type="button" onClick={onClose} className="text-text-tertiary hover:text-text-primary p-1">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loadingCourses ? (
            <div className="text-text-tertiary text-center py-4">강좌 불러오는 중...</div>
          ) : courses.length === 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-caption text-amber-900">
              가르치는 강좌가 없습니다. 먼저 강좌를 만들고 학생을 등록하세요.
            </div>
          ) : (
            <>
              <label className="text-caption block">
                <div className="text-text-secondary mb-1 font-semibold">출제할 강좌 *</div>
                <select
                  value={selectedCid ?? ""}
                  onChange={(e) => setSelectedCid(Number(e.target.value))}
                  className="w-full px-2 py-1.5 border border-border-default rounded text-body"
                >
                  {courses.map((c) => (
                    <option key={c.course_id} value={c.course_id}>
                      {c.semester ? `[${c.semester.year}-${c.semester.term}] ` : ""}
                      {c.course_name}{c.class_name ? ` (${c.class_name})` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-caption block">
                <div className="text-text-secondary mb-1 font-semibold">제목 *</div>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-2 py-1.5 border border-border-default rounded text-body"
                />
              </label>

              <label className="text-caption block">
                <div className="text-text-secondary mb-1">설명 (선택)</div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full px-2 py-1.5 border border-border-default rounded text-body"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-caption">
                  <div className="text-text-secondary mb-1">마감 (선택)</div>
                  <input
                    type="datetime-local"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-2 py-1.5 border border-border-default rounded text-body"
                  />
                </label>
                <label className="text-caption">
                  <div className="text-text-secondary mb-1">재응시 횟수</div>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={maxAttempts}
                    onChange={(e) => setMaxAttempts(parseInt(e.target.value || "1"))}
                    className="w-full px-2 py-1.5 border border-border-default rounded text-body"
                  />
                </label>
                <label className="text-caption">
                  <div className="text-text-secondary mb-1">상태</div>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full px-2 py-1.5 border border-border-default rounded text-body"
                  >
                    <option value="draft">초안 (학생 안 보임)</option>
                    <option value="published">바로 게시</option>
                  </select>
                </label>
                <label className="flex items-center gap-1 text-caption pt-5">
                  <input
                    type="checkbox"
                    checked={showSolutionAfterDue}
                    onChange={(e) => setShowSolutionAfterDue(e.target.checked)}
                  />
                  마감 후 정답·해설 공개
                </label>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-default">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || courses.length === 0}
            className="px-4 py-1.5 text-caption bg-accent-default text-white rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
          >
            <Send size={12} /> {saving ? "저장 중..." : "출제"}
          </button>
        </div>
      </div>
    </div>
  );
}
