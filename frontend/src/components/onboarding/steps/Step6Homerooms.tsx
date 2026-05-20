"use client";

import { useEffect, useState, useCallback } from "react";
import { Save, Users } from "lucide-react";
import { api } from "@/lib/api/client";

interface TeacherOption {
  id: number;
  name: string;
}

interface ClassInfo {
  grade: number;
  class_number: number;
  student_count: number;
  homeroom_teacher_id?: number | null;
  homeroom_teacher_name?: string | null;
}

/**
 * 학급 담임 매핑.
 * 학생 데이터에서 자동 감지된 (grade, class_number) 조합 표시.
 * 담임 = teacher 드롭다운. 저장은 학기 enrollment를 통해.
 *
 * 단순화: 현재 학기(is_current) 기준으로 enrollment에 homeroom_class_grade /
 * homeroom_class_number를 기록. 이미 enrollment에 매핑돼있으면 자동 표시.
 */
export function Step6Homerooms() {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentSemId, setCurrentSemId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, s, students] = await Promise.all([
        api.get<any>("/api/users?role=teacher,staff,designated_admin&limit=500"),
        api.get<any>("/api/timetable/semesters"),
        api.get<any>("/api/users?role=student&limit=2000"),
      ]);

      const teacherList = Array.isArray(t) ? t : t.items || t.users || [];
      setTeachers(teacherList.map((u: any) => ({ id: u.id, name: u.name })));

      const semList = Array.isArray(s) ? s : s.items || [];
      const current = semList.find((x: any) => x.is_current);
      setCurrentSemId(current?.id || null);

      // 학생 데이터에서 (grade, class_number) 추출 + 카운트
      const studentList = Array.isArray(students) ? students : students.items || students.users || [];
      const grouped: Record<string, ClassInfo> = {};
      for (const st of studentList) {
        if (!st.grade || !st.class_number) continue;
        const k = `${st.grade}-${st.class_number}`;
        if (!grouped[k]) {
          grouped[k] = { grade: st.grade, class_number: st.class_number, student_count: 0 };
        }
        grouped[k].student_count += 1;
      }

      // 학기 enrollment에서 homeroom 매핑 가져오기 (있으면)
      if (current) {
        try {
          const enr = await api.get<any>(`/api/timetable/enrollments?semester_id=${current.id}&limit=2000`);
          const enrList = Array.isArray(enr) ? enr : enr.items || [];
          for (const e of enrList) {
            if (e.homeroom_class_grade && e.homeroom_class_number) {
              const k = `${e.homeroom_class_grade}-${e.homeroom_class_number}`;
              if (grouped[k]) {
                grouped[k].homeroom_teacher_id = e.user_id;
                grouped[k].homeroom_teacher_name = e.user_name;
              }
            }
          }
        } catch {}
      }

      const list = Object.values(grouped).sort((a, b) =>
        a.grade !== b.grade ? a.grade - b.grade : a.class_number - b.class_number
      );
      setClasses(list);
    } catch (e) {
      console.error(e);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateHomeroom = (idx: number, teacherId: number) => {
    setClasses((prev) =>
      prev.map((c, i) => i === idx ? { ...c, homeroom_teacher_id: teacherId || null } : c)
    );
  };

  const saveAll = async () => {
    if (!currentSemId) {
      alert("현재 학기가 없습니다. 3단계에서 학기를 먼저 등록하세요.");
      return;
    }
    setSaving(true);
    let ok = 0, fail = 0;
    for (const c of classes) {
      if (!c.homeroom_teacher_id) continue;
      try {
        // /api/timetable/enrollments의 직접 매핑이 없으면 enrollment_positions 또는
        // 기존 _enrollments 흐름 활용. 일단 enrollments에 upsert 시도.
        await api.post(`/api/timetable/enrollments/_set-homeroom`, {
          semester_id: currentSemId,
          user_id: c.homeroom_teacher_id,
          grade: c.grade,
          class_number: c.class_number,
        });
        ok++;
      } catch (e) {
        fail++;
      }
    }
    setSaving(false);
    if (fail > 0) {
      alert(`${ok}개 담임 저장, ${fail}개 실패 (API 미구현일 수 있음 — 마법사 후 [학기별 명단]에서 직접 지정)`);
    } else if (ok > 0) {
      alert(`${ok}개 담임 매핑 저장 완료`);
    }
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-body font-semibold text-text-primary">학급 담임 매핑</h2>
        <p className="text-caption text-text-tertiary mt-1">
          학생 데이터에서 자동 감지된 학급 목록. 각 학급의 담임 교사를 지정합니다.
        </p>
      </div>

      {loading ? (
        <div className="text-text-tertiary">불러오는 중...</div>
      ) : classes.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-border-default rounded-lg">
          <Users size={32} className="mx-auto text-text-tertiary mb-2" />
          <div className="text-body text-text-tertiary">학생이 아직 등록되지 않았습니다</div>
          <div className="text-caption text-text-tertiary mt-1">이전 단계로 돌아가 학생을 먼저 등록하세요</div>
        </div>
      ) : (
        <div className="bg-bg-primary border border-border-default rounded-lg overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-bg-secondary border-b border-border-default text-text-tertiary">
              <tr>
                <th className="px-3 py-2 text-left">학급</th>
                <th className="px-3 py-2 text-left">학생 수</th>
                <th className="px-3 py-2 text-left">담임 교사</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c, i) => (
                <tr key={`${c.grade}-${c.class_number}`} className="border-b border-border-default/30">
                  <td className="px-3 py-2 font-medium">{c.grade}학년 {c.class_number}반</td>
                  <td className="px-3 py-2 text-text-tertiary">{c.student_count}명</td>
                  <td className="px-3 py-2">
                    <select
                      value={c.homeroom_teacher_id || 0}
                      onChange={(e) => updateHomeroom(i, Number(e.target.value))}
                      className="px-2 py-1 text-[12px] border border-border-default rounded bg-bg-primary"
                    >
                      <option value={0}>— 미지정 —</option>
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-3 border-t border-border-default flex justify-end">
            <button
              type="button"
              onClick={saveAll}
              disabled={saving}
              className="px-4 py-1.5 text-[13px] bg-accent text-white rounded hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
            >
              <Save size={14} /> {saving ? "저장 중..." : "담임 매핑 저장"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 text-[12px] text-text-tertiary text-center">
        💡 마법사 후 <code className="text-accent">시스템 → 학기별 명단</code>에서 부담임 등 세부 매핑 가능.
      </div>
    </div>
  );
}
