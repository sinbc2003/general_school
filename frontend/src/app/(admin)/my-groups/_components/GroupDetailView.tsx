"use client";

import { useState } from "react";
import { Loader2, Trash2, Users, X, UserPlus } from "lucide-react";
import { api } from "@/lib/api/client";

export interface GroupDetail {
  id: number;
  semester_id: number;
  name: string;
  type: string;
  description: string | null;
  owner_id: number;
  is_active: boolean;
  members: { id: number; teacher_id: number; teacher_name: string; role: string }[];
  students: {
    id: number; student_id: number; student_name: string; student_username: string;
    grade: number | null; assigned_teacher_id: number; note: string | null;
  }[];
}

export interface MeInfo { id: number; role: string }

export function GroupDetailView({
  gid, detail, me, onRefresh, onDelete,
}: {
  gid: number;
  detail?: GroupDetail;
  me: MeInfo | null;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const [studentSearch, setStudentSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [teacherSearch, setTeacherSearch] = useState("");
  const [teacherResults, setTeacherResults] = useState<any[]>([]);

  if (!detail) return <div className="p-3 text-caption text-text-tertiary">로딩...</div>;

  const isOwner = me?.id === detail.owner_id;

  const doStudentSearch = async (q: string) => {
    setStudentSearch(q);
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const d = await api.get(`/api/teacher-groups/_students/_search?q=${encodeURIComponent(q)}`);
      setSearchResults(d.items || []);
    } catch {} finally { setSearching(false); }
  };

  const assignStudent = async (username: string) => {
    try {
      await api.post(`/api/teacher-groups/${gid}/_students`, { username });
      setStudentSearch(""); setSearchResults([]);
      onRefresh();
    } catch (e: any) { alert(`배정 실패: ${e?.detail || e}`); }
  };

  const unassign = async (sid: number) => {
    if (!confirm("학생 배정을 해제하시겠습니까?")) return;
    try {
      await api.delete(`/api/teacher-groups/${gid}/_students/${sid}`);
      onRefresh();
    } catch (e: any) { alert(`해제 실패: ${e?.detail || e}`); }
  };

  const doTeacherSearch = async (q: string) => {
    setTeacherSearch(q);
    if (!q.trim()) { setTeacherResults([]); return; }
    try {
      const d = await api.get(`/api/users?role=teacher,staff&search=${encodeURIComponent(q)}&page_size=10`);
      setTeacherResults(d.items || d || []);
    } catch {}
  };

  const inviteTeacher = async (teacher_id: number) => {
    try {
      await api.post(`/api/teacher-groups/${gid}/_members`, { teacher_id, role: "member" });
      setTeacherSearch(""); setTeacherResults([]);
      onRefresh();
    } catch (e: any) { alert(`초대 실패: ${e?.detail || e}`); }
  };

  const removeMember = async (mid: number) => {
    if (!confirm("참여 교사를 그룹에서 제외하시겠습니까?")) return;
    try {
      await api.delete(`/api/teacher-groups/${gid}/_members/${mid}`);
      onRefresh();
    } catch (e: any) { alert(`제외 실패: ${e?.detail || e}`); }
  };

  const deleteGroup = async () => {
    if (!confirm(`정말 '${detail.name}' 그룹을 삭제하시겠습니까?\n모든 학생/산출물도 함께 삭제됩니다.`)) return;
    try {
      await api.delete(`/api/teacher-groups/${gid}`);
      onDelete();
    } catch (e: any) { alert(`삭제 실패: ${e?.detail || e}`); }
  };

  return (
    <div className="border-t border-border-default p-3 bg-bg-secondary">
      {detail.description && (
        <div className="mb-3 p-2 bg-bg-primary rounded text-caption text-text-secondary whitespace-pre-wrap">
          {detail.description}
        </div>
      )}

      {/* 참여 교사 */}
      <section className="mb-4">
        <h4 className="text-caption font-semibold text-text-secondary mb-2 inline-flex items-center gap-1">
          <Users size={12} /> 참여 교사 ({detail.members.length})
        </h4>
        <div className="flex flex-wrap gap-1 mb-2">
          {detail.members.map((m) => (
            <div key={m.id} className="inline-flex items-center gap-1 px-2 py-1 bg-bg-primary border border-border-default rounded text-caption">
              <span>{m.teacher_name}</span>
              {isOwner && (
                <button onClick={() => removeMember(m.id)} className="text-red-500 hover:text-red-700">
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
        {isOwner && (
          <div className="relative">
            <input value={teacherSearch} onChange={(e) => doTeacherSearch(e.target.value)}
                   placeholder="교사 이름·아이디 검색해 초대"
                   className="w-full px-2 py-1 border border-border-default rounded text-caption bg-bg-primary" />
            {teacherResults.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-bg-primary border border-border-default rounded shadow-lg max-h-48 overflow-y-auto">
                {teacherResults.map((t: any) => (
                  <button key={t.id} onClick={() => inviteTeacher(t.id)}
                          className="w-full text-left px-2 py-1.5 hover:bg-bg-secondary text-caption">
                    {t.name} <span className="text-text-tertiary">({t.username})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 학생 배정 */}
      <section>
        <h4 className="text-caption font-semibold text-text-secondary mb-2 inline-flex items-center gap-1">
          <UserPlus size={12} /> 배정 학생 ({detail.students.length})
        </h4>

        <div className="relative mb-2">
          <div className="flex gap-1">
            <input value={studentSearch} onChange={(e) => doStudentSearch(e.target.value)}
                   placeholder="학번 또는 이름 검색"
                   className="flex-1 px-2 py-1 border border-border-default rounded text-caption bg-bg-primary" />
            {searching && <Loader2 size={14} className="self-center animate-spin text-text-tertiary" />}
          </div>
          {searchResults.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-bg-primary border border-border-default rounded shadow-lg max-h-60 overflow-y-auto">
              {searchResults.map((s) => (
                <button key={s.id} onClick={() => assignStudent(s.username)}
                        className="w-full text-left px-2 py-1.5 hover:bg-bg-secondary text-caption flex items-center justify-between">
                  <span>{s.name} <span className="text-text-tertiary">({s.username})</span></span>
                  {s.grade && <span className="text-text-tertiary text-[10px]">{s.grade}학년</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {detail.students.length === 0 ? (
          <div className="text-caption text-text-tertiary p-2">아직 배정된 학생이 없습니다</div>
        ) : (
          <div className="space-y-1">
            {detail.students.map((s) => {
              const isMine = me?.id === s.assigned_teacher_id;
              return (
                <div key={s.id} className="flex items-center justify-between px-2 py-1.5 bg-bg-primary border border-border-default rounded">
                  <div className="text-caption">
                    <span className="text-text-primary">{s.student_name}</span>
                    <span className="text-text-tertiary ml-1">({s.student_username})</span>
                    {s.grade && <span className="text-text-tertiary ml-1">· {s.grade}학년</span>}
                    {!isMine && <span className="ml-2 text-[10px] px-1 py-0.5 bg-bg-secondary text-text-tertiary rounded">다른 교사 담당</span>}
                  </div>
                  {(isMine || me?.role === "super_admin" || me?.role === "designated_admin" || isOwner) && (
                    <button onClick={() => unassign(s.id)} className="text-red-500 hover:text-red-700">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {isOwner && (
        <div className="mt-4 pt-3 border-t border-border-default">
          <button onClick={deleteGroup} className="text-caption text-red-600 inline-flex items-center gap-1">
            <Trash2 size={12} /> 그룹 삭제
          </button>
        </div>
      )}
    </div>
  );
}
