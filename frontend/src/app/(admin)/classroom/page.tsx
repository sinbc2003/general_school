"use client";

/**
 * 클래스룸 관리 페이지 (교사·관리자).
 *
 * - super_admin/designated_admin: 학기 전체 강좌 + 자동 생성
 * - teacher/staff: 본인 강좌만
 *
 * 자동 생성 버튼: 학기 enrollment의 teaching_classes × teaching_subjects 조합으로
 * 강좌 일괄 생성 (학급 단위는 학생 자동 등록 옵션).
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, GraduationCap, Wand2, X, Save } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth-context";
import { CourseCard } from "@/components/classroom/CourseCard";
import { useToast } from "@/components/ui/Toast";

interface Course {
  id: number;
  semester_id: number;
  teacher_id: number;
  teacher_name?: string;
  subject: string;
  class_name: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
  student_count: number;
  created_at: string | null;
}

export default function ClassroomAdminPage() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === "super_admin" || user?.role === "designated_admin";

  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const endpoint = isAdmin ? "/api/classroom/courses/all" : "/api/classroom/courses";
      const data = await api.get<{ items: Course[] }>(endpoint);
      setCourses(data.items);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  const autoGenerate = async () => {
    if (!confirm("학기 명단 기준으로 모든 교사의 강좌를 자동 생성합니다.\n(이미 있는 강좌는 skip, 학급 단위는 학생 자동 등록)\n진행할까요?")) return;
    setGenerating(true);
    try {
      const res = await api.post<{ created: number; enrolled_students: number; skipped_existing: number }>(
        "/api/classroom/courses/_auto-generate",
        { auto_enroll_students: true },
      );
      toast.show(
        `자동 생성: 새 ${res.created} · 학생 ${res.enrolled_students}건 · 중복 ${res.skipped_existing}`,
        "success",
      );
      await load();
    } catch (e: any) {
      toast.show(e?.detail || "자동 생성 실패", "error");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-title text-text-primary flex items-center gap-2">
            <GraduationCap size={22} /> 클래스룸
          </h1>
          <p className="text-caption text-text-tertiary mt-1">
            {isAdmin
              ? "학기 전체 강좌 + 학생 명단 관리. 자동 생성으로 한 번에 정리하세요."
              : "본인이 담당하는 강좌. 학생 명단·공지·자료를 관리합니다."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={autoGenerate}
              disabled={generating}
              className="flex items-center gap-1 px-3 py-1.5 text-caption bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
            >
              <Wand2 size={14} /> {generating ? "생성 중..." : "자동 생성"}
            </button>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
          >
            <Plus size={14} /> 강좌 생성
          </button>
        </div>
      </div>

      {showCreate && (
        <CourseCreateModal
          onClose={() => setShowCreate(false)}
          onSaved={load}
          currentUserId={user?.id}
        />
      )}

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : courses.length === 0 ? (
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-12 text-center">
          <GraduationCap size={32} className="mx-auto text-text-tertiary mb-2" />
          <div className="text-body text-text-tertiary mb-1">아직 강좌가 없습니다</div>
          <div className="text-caption text-text-tertiary">
            {isAdmin ? "위 '자동 생성' 또는 '강좌 생성' 버튼을 사용하세요." : "관리자가 자동 생성하거나 본인이 직접 생성해주세요."}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {courses.map((c) => (
            <CourseCard
              key={c.id}
              id={c.id}
              name={c.name}
              subject={c.subject}
              class_name={c.class_name}
              teacher_name={c.teacher_name}
              is_active={c.is_active}
              student_count={c.student_count}
              baseHref="/classroom"
              showTeacher={isAdmin}
            />
          ))}
        </div>
      )}
    </div>
  );
}


// ─── 강좌 생성 모달 ───
function CourseCreateModal({
  onClose, onSaved, currentUserId,
}: {
  onClose: () => void;
  onSaved: () => void;
  currentUserId?: number;
}) {
  const [teacherId, setTeacherId] = useState<string>(String(currentUserId ?? ""));
  const [subject, setSubject] = useState("");
  const [className, setClassName] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  // class_name 변경 시 name 자동 채우기
  useEffect(() => {
    if (subject && className && !name) {
      setName(`${className} ${subject}`);
    } else if (subject && !className && !name) {
      setName(subject);
    }
  }, [subject, className]);  // eslint-disable-line

  const save = async () => {
    if (!subject.trim() || !name.trim() || !teacherId) {
      toast.show("교사·과목·이름은 필수입니다", "error");
      return;
    }
    setSaving(true);
    try {
      await api.post("/api/classroom/courses", {
        teacher_id: Number(teacherId),
        subject: subject.trim(),
        class_name: className.trim() || null,
        name: name.trim(),
        description: description.trim() || null,
      });
      toast.show(`강좌 "${name.trim()}" 생성됨`, "success");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.show(e?.detail || "생성 실패", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h2 className="text-body font-semibold">강좌 생성</h2>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-caption text-text-secondary mb-1">담당 교사 user_id *</label>
            <input
              type="number"
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              placeholder="본인 또는 다른 교사 ID"
              className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-caption text-text-secondary mb-1">과목 *</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="예: 수학, 미적분"
                className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
            <div>
              <label className="block text-caption text-text-secondary mb-1">
                학급 (예: 2-3) — 선택과목이면 비움
              </label>
              <input
                type="text"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                placeholder="2-3 또는 빈칸 (선택과목)"
                className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary"
              />
            </div>
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">강좌 표시명 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 2-3 수학 또는 미적분 A반"
              className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary"
            />
          </div>
          <div>
            <label className="block text-caption text-text-secondary mb-1">설명 (선택)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary resize-y"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-border-default">
          <button onClick={onClose} className="px-4 py-1.5 text-caption border border-border-default rounded">취소</button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1 px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
          >
            <Save size={14} /> {saving ? "저장 중..." : "생성"}
          </button>
        </div>
      </div>
    </div>
  );
}
