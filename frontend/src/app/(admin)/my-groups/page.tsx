"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2, Plus, Users, Trash2, ChevronDown, ChevronRight, Search, X, UserPlus,
  Crown, AlertCircle,
} from "lucide-react";
import { api } from "@/lib/api/client";

interface Group {
  id: number;
  semester_id: number;
  name: string;
  type: string;
  description: string | null;
  owner_id: number;
  is_active: boolean;
  member_count?: number;
  student_count?: number;
}

interface GroupDetail extends Group {
  members: { id: number; teacher_id: number; teacher_name: string; role: string }[];
  students: {
    id: number; student_id: number; student_name: string; student_username: string;
    grade: number | null; assigned_teacher_id: number; note: string | null;
  }[];
}

interface MeInfo { id: number; role: string }

const TYPE_LABEL: Record<string, string> = {
  event: "행사", contest: "대회", research: "연구", etc: "기타",
};

export default function MyGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, GroupDetail>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [me, setMe] = useState<MeInfo | null>(null);
  const [semesters, setSemesters] = useState<{ id: number; name: string; is_current: boolean }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/teacher-groups?mine=true");
      setGroups(data.items || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    api.get("/api/auth/me").then(setMe).catch(() => {});
    api.get("/api/timetable/semesters").then((d) => {
      const items = Array.isArray(d) ? d : d.items || [];
      setSemesters(items);
    }).catch(() => {});
  }, [load]);

  const expand = async (gid: number) => {
    if (expanded === gid) { setExpanded(null); return; }
    setExpanded(gid);
    if (!details[gid]) {
      try {
        const d = await api.get(`/api/teacher-groups/${gid}`);
        setDetails((p) => ({ ...p, [gid]: d }));
      } catch (e: any) { alert(`로딩 실패: ${e?.detail || e}`); }
    }
  };

  const refreshDetail = async (gid: number) => {
    const d = await api.get(`/api/teacher-groups/${gid}`);
    setDetails((p) => ({ ...p, [gid]: d }));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-title text-text-primary">내 그룹</h1>
          <p className="text-caption text-text-tertiary mt-1">
            내가 owner이거나 초대받은 행사·대회·연구 그룹. 학번 검색으로 담당 학생을 등록할 수 있습니다.
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
                className="px-3 py-1.5 bg-accent text-white text-body rounded inline-flex items-center gap-1">
          <Plus size={14} /> 새 그룹 만들기
        </button>
      </div>

      {loading ? (
        <div className="p-12 text-center"><Loader2 size={20} className="animate-spin mx-auto" /></div>
      ) : groups.length === 0 ? (
        <div className="p-8 text-center text-text-tertiary bg-bg-primary border border-border-default rounded-lg">
          <Users size={32} className="mx-auto mb-2 opacity-50" />
          <div className="text-body">참여 중인 그룹이 없습니다</div>
          <div className="text-caption mt-1">부장 교사가 초대하거나 본인이 만들 수 있습니다 (부장 권한 필요)</div>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.id} className="bg-bg-primary border border-border-default rounded-lg overflow-hidden">
              <button onClick={() => expand(g.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-secondary text-left">
                {expanded === g.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="text-[10px] px-1.5 py-0.5 bg-cream-100 text-blue-700 rounded">{TYPE_LABEL[g.type] || g.type}</span>
                <span className="text-body text-text-primary font-medium flex-1">{g.name}</span>
                {me?.id === g.owner_id && <Crown size={12} className="text-amber-600" />}
              </button>
              {expanded === g.id && (
                <GroupDetailView gid={g.id} detail={details[g.id]} me={me} onRefresh={() => refreshDetail(g.id)} onDelete={load} />
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateGroupModal semesters={semesters} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
    </div>
  );
}

function GroupDetailView({ gid, detail, me, onRefresh, onDelete }: {
  gid: number; detail?: GroupDetail; me: MeInfo | null;
  onRefresh: () => void; onDelete: () => void;
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

  const assignStudent = async (student_id: number, username: string) => {
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
      const items = d.items || d || [];
      setTeacherResults(items);
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
            <div className="flex gap-1">
              <input value={teacherSearch} onChange={(e) => doTeacherSearch(e.target.value)}
                     placeholder="교사 이름·아이디 검색해 초대"
                     className="flex-1 px-2 py-1 border border-border-default rounded text-caption bg-bg-primary" />
            </div>
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

        {/* 학번/이름 검색 */}
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
                <button key={s.id} onClick={() => assignStudent(s.id, s.username)}
                        className="w-full text-left px-2 py-1.5 hover:bg-bg-secondary text-caption flex items-center justify-between">
                  <span>{s.name} <span className="text-text-tertiary">({s.username})</span></span>
                  {s.grade && <span className="text-text-tertiary text-[10px]">{s.grade}학년</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 배정된 학생 list */}
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

function CreateGroupModal({ semesters, onClose, onCreated }: { semesters: any[]; onClose: () => void; onCreated: () => void }) {
  const current = semesters.find((s) => s.is_current) || semesters[0];
  const [form, setForm] = useState({
    semester_id: current?.id || 0,
    name: "",
    type: "event",
    description: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const create = async () => {
    if (!form.name.trim() || !form.semester_id) { alert("학기·이름 필수"); return; }
    setSubmitting(true);
    try {
      await api.post("/api/teacher-groups", form);
      onCreated();
    } catch (e: any) {
      alert(`생성 실패: ${e?.detail || e}`);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg p-5 w-full max-w-md">
        <h3 className="text-body font-semibold text-text-primary mb-3">새 그룹 만들기</h3>
        <p className="text-caption text-amber-600 mb-3 inline-flex items-center gap-1">
          <AlertCircle size={12} /> 부장 교사만 생성 가능 (admin은 항상 가능)
        </p>

        <label className="block mb-2">
          <span className="text-caption text-text-tertiary">학기</span>
          <select value={form.semester_id} onChange={(e) => setForm({ ...form, semester_id: parseInt(e.target.value) })}
                  className="w-full mt-0.5 px-2 py-1 border border-border-default rounded text-body bg-bg-primary">
            {semesters.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? " (현재)" : ""}</option>)}
          </select>
        </label>

        <label className="block mb-2">
          <span className="text-caption text-text-tertiary">그룹명 *</span>
          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                 placeholder="예: 2026 수학경시대회"
                 className="w-full mt-0.5 px-2 py-1 border border-border-default rounded text-body bg-bg-primary" />
        </label>

        <label className="block mb-2">
          <span className="text-caption text-text-tertiary">유형</span>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full mt-0.5 px-2 py-1 border border-border-default rounded text-body bg-bg-primary">
            <option value="event">행사</option>
            <option value="contest">대회</option>
            <option value="research">연구</option>
            <option value="etc">기타</option>
          </select>
        </label>

        <label className="block mb-3">
          <span className="text-caption text-text-tertiary">설명</span>
          <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1 border border-border-default rounded text-caption bg-bg-primary" />
        </label>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={submitting} className="px-3 py-1.5 text-caption text-text-secondary">취소</button>
          <button onClick={create} disabled={submitting || !form.name.trim()}
                  className="px-4 py-1.5 bg-accent text-white text-caption rounded disabled:opacity-50">
            {submitting ? "생성 중..." : "생성"}
          </button>
        </div>
      </div>
    </div>
  );
}
