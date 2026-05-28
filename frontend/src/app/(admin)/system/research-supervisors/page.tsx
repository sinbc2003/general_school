"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Search, X } from "lucide-react";
import { api } from "@/lib/api/client";

interface Supervision {
  id: number;
  semester_id: number;
  student_id: number;
  student_name: string | null;
  student_username: string | null;
  supervisor_id: number;
  supervisor_name: string | null;
  topic_title: string | null;
  note: string | null;
}

interface Semester { id: number; name: string; is_current: boolean }

export default function ResearchSupervisorsPage() {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [semesterId, setSemesterId] = useState<number>(0);
  const [items, setItems] = useState<Supervision[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    api.get("/api/timetable/semesters").then((d) => {
      const arr = Array.isArray(d) ? d : d.items || [];
      setSemesters(arr);
      const cur = arr.find((s: Semester) => s.is_current) || arr[0];
      if (cur) setSemesterId(cur.id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!semesterId) return;
    setLoading(true);
    try {
      const d = await api.get(`/api/past-research/_supervisions?semester_id=${semesterId}`);
      setItems(d.items || []);
    } catch {} finally { setLoading(false); }
  }, [semesterId]);

  useEffect(() => { load(); }, [load]);

  const onDelete = async (id: number, name: string | null) => {
    if (!confirm(`정말 매핑을 해제하시겠습니까?\n${name || `ID ${id}`}`)) return;
    try {
      await api.delete(`/api/past-research/_supervisions/${id}`);
      load();
    } catch (e: any) { alert(`삭제 실패: ${e?.detail || e}`); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-title text-text-primary">연구 담당교사 매핑</h1>
          <p className="text-caption text-text-tertiary mt-1">
            학기별 학생-담당교사 1:1 매핑. 학생은 본인 supervisor에게 연구 보고서를 제출합니다.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
                className="px-3 py-1.5 bg-accent text-white text-body rounded inline-flex items-center gap-1">
          <Plus size={14} /> 매핑 추가
        </button>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <select value={semesterId} onChange={(e) => setSemesterId(parseInt(e.target.value))}
                className="px-2 py-1 border border-border-default rounded text-body bg-bg-primary">
          {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? " (현재)" : ""}</option>)}
        </select>
        <span className="text-caption text-text-tertiary ml-auto">총 {items.length}건</span>
      </div>

      {loading ? (
        <div className="p-12 text-center"><Loader2 size={20} className="animate-spin mx-auto" /></div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-text-tertiary bg-bg-primary border border-border-default rounded-lg">
          매핑이 없습니다. 우측 상단 + 버튼으로 추가하세요.
        </div>
      ) : (
        <div className="bg-bg-primary border border-border-default rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-bg-secondary border-b border-border-default text-caption text-text-tertiary">
              <tr>
                <th className="text-left px-3 py-2">학생</th>
                <th className="text-left px-3 py-2">담당 교사</th>
                <th className="text-left px-3 py-2">연구 주제</th>
                <th className="text-right px-3 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b border-border-default last:border-b-0 hover:bg-bg-secondary">
                  <td className="px-3 py-2 text-body text-text-primary">
                    {it.student_name} <span className="text-text-tertiary text-caption">({it.student_username})</span>
                  </td>
                  <td className="px-3 py-2 text-body text-text-primary">{it.supervisor_name}</td>
                  <td className="px-3 py-2 text-caption text-text-secondary">{it.topic_title || "-"}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => onDelete(it.id, it.student_name)}
                            className="p-1.5 hover:bg-red-50 rounded text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateSupervisionModal
          semesterId={semesterId}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

function CreateSupervisionModal({ semesterId, onClose, onCreated }: {
  semesterId: number; onClose: () => void; onCreated: () => void;
}) {
  const [studentSearch, setStudentSearch] = useState("");
  const [students, setStudents] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [teacherSearch, setTeacherSearch] = useState("");
  const [teachers, setTeachers] = useState<any[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState<any>(null);
  const [topicTitle, setTopicTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const searchStudent = async (q: string) => {
    setStudentSearch(q);
    if (!q.trim()) { setStudents([]); return; }
    try {
      const d = await api.get(`/api/teacher-groups/_students/_search?q=${encodeURIComponent(q)}`);
      setStudents(d.items || []);
    } catch {}
  };

  const searchTeacher = async (q: string) => {
    setTeacherSearch(q);
    if (!q.trim()) { setTeachers([]); return; }
    try {
      const d = await api.get(`/api/users?role=teacher,staff&search=${encodeURIComponent(q)}&page_size=10`);
      setTeachers(d.items || d || []);
    } catch {}
  };

  const create = async () => {
    if (!selectedStudent || !selectedTeacher) { alert("학생·교사 모두 선택"); return; }
    setSubmitting(true);
    try {
      await api.post("/api/past-research/_supervisions", {
        semester_id: semesterId,
        student_id: selectedStudent.id,
        supervisor_id: selectedTeacher.id,
        topic_title: topicTitle.trim() || null,
      });
      onCreated();
    } catch (e: any) {
      alert(`등록 실패: ${e?.detail || e}`);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg p-5 w-full max-w-md">
        <h3 className="text-body font-semibold text-text-primary mb-3">담당교사 매핑 추가</h3>

        <div className="mb-3 relative">
          <span className="text-caption text-text-tertiary">학생 *</span>
          {selectedStudent ? (
            <div className="mt-0.5 flex items-center justify-between px-2 py-1.5 bg-bg-secondary rounded">
              <span className="text-body text-text-primary">{selectedStudent.name} ({selectedStudent.username})</span>
              <button onClick={() => { setSelectedStudent(null); setStudentSearch(""); }} className="text-text-tertiary">
                <X size={14} />
              </button>
            </div>
          ) : (
            <>
              <input value={studentSearch} onChange={(e) => searchStudent(e.target.value)}
                     placeholder="학번 또는 이름 검색"
                     className="mt-0.5 w-full px-2 py-1 border border-border-default rounded text-body bg-bg-primary" />
              {students.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-bg-primary border border-border-default rounded shadow-lg max-h-48 overflow-y-auto">
                  {students.map((s) => (
                    <button key={s.id} onClick={() => { setSelectedStudent(s); setStudents([]); }}
                            className="w-full text-left px-2 py-1.5 hover:bg-bg-secondary text-caption">
                      {s.name} ({s.username}) {s.grade && `· ${s.grade}학년`}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="mb-3 relative">
          <span className="text-caption text-text-tertiary">담당 교사 *</span>
          {selectedTeacher ? (
            <div className="mt-0.5 flex items-center justify-between px-2 py-1.5 bg-bg-secondary rounded">
              <span className="text-body text-text-primary">{selectedTeacher.name} ({selectedTeacher.username})</span>
              <button onClick={() => { setSelectedTeacher(null); setTeacherSearch(""); }} className="text-text-tertiary">
                <X size={14} />
              </button>
            </div>
          ) : (
            <>
              <input value={teacherSearch} onChange={(e) => searchTeacher(e.target.value)}
                     placeholder="교사 이름·아이디 검색"
                     className="mt-0.5 w-full px-2 py-1 border border-border-default rounded text-body bg-bg-primary" />
              {teachers.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-bg-primary border border-border-default rounded shadow-lg max-h-48 overflow-y-auto">
                  {teachers.map((t: any) => (
                    <button key={t.id} onClick={() => { setSelectedTeacher(t); setTeachers([]); }}
                            className="w-full text-left px-2 py-1.5 hover:bg-bg-secondary text-caption">
                      {t.name} ({t.username})
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <label className="block mb-3">
          <span className="text-caption text-text-tertiary">연구 주제 (선택)</span>
          <input type="text" value={topicTitle} onChange={(e) => setTopicTitle(e.target.value)}
                 className="mt-0.5 w-full px-2 py-1 border border-border-default rounded text-body bg-bg-primary" />
        </label>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={submitting} className="px-3 py-1.5 text-caption text-text-secondary">취소</button>
          <button onClick={create} disabled={submitting || !selectedStudent || !selectedTeacher}
                  className="px-4 py-1.5 bg-accent text-white text-caption rounded disabled:opacity-50">
            {submitting ? "등록 중..." : "등록"}
          </button>
        </div>
      </div>
    </div>
  );
}
