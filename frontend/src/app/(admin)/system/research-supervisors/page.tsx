"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, Trash2, Search, X, Upload, FileSpreadsheet, Download } from "lucide-react";
import { api } from "@/lib/api/client";
import { StudentPickerModal, type StudentRow } from "@/components/StudentPickerModal";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

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
  const [showCsv, setShowCsv] = useState(false);

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
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCsv(true)}
                  className="px-3 py-1.5 border border-border-default text-body rounded inline-flex items-center gap-1">
            <FileSpreadsheet size={14} /> CSV 일괄
          </button>
          <button onClick={() => setShowCreate(true)}
                  className="px-3 py-1.5 bg-accent text-white text-body rounded inline-flex items-center gap-1">
            <Plus size={14} /> 매핑 추가
          </button>
        </div>
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
      {showCsv && (
        <CsvBulkModal
          semesterId={semesterId}
          onClose={() => setShowCsv(false)}
          onDone={() => { setShowCsv(false); load(); }}
        />
      )}
    </div>
  );
}

function CsvBulkModal({ semesterId, onClose, onDone }: {
  semesterId: number; onClose: () => void; onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [dryRunResult, setDryRunResult] = useState<any>(null);
  const [working, setWorking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = async () => {
    const token = localStorage.getItem("access_token");
    const res = await fetch(`${API_URL}/api/past-research/_supervisions/_csv-template`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) { alert(`템플릿 다운로드 실패: ${res.status}`); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "research_supervisions_template.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const upload = async (dry: boolean) => {
    if (!file) { alert("CSV 파일을 선택하세요"); return; }
    setWorking(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("semester_id", String(semesterId));
      fd.append("dry_run", String(dry));
      const token = localStorage.getItem("access_token");
      const res = await fetch(`${API_URL}/api/past-research/_supervisions/_bulk-import`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
      if (dry) {
        setDryRunResult(data);
      } else {
        alert(`완료: 신규 ${data.added}건 / 변경 ${data.updated}건 / 실패 ${data.failed.length}건`);
        onDone();
      }
    } catch (e: any) {
      alert(`실패: ${e.message || e}`);
    } finally { setWorking(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg p-5 w-full max-w-lg">
        <h3 className="text-body font-semibold text-text-primary mb-3">학생-담당교사 CSV 일괄 등록</h3>

        <div className="mb-3 text-caption text-text-secondary space-y-1">
          <p>1. <button onClick={downloadTemplate} className="text-accent inline-flex items-center gap-1 hover:underline"><Download size={11} /> 템플릿 다운로드</button> → Excel 편집</p>
          <p>2. 컬럼: <code className="px-1 bg-bg-secondary rounded text-[11px]">student_username, supervisor_username, topic_title</code></p>
          <p>3. 같은 학기 학생 기존 매핑은 supervisor 자동 변경</p>
        </div>

        <input
          ref={inputRef} type="file" accept=".csv"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setDryRunResult(null); }}
          className="mb-3 w-full text-caption"
        />

        {dryRunResult && (
          <div className="mb-3 p-2 bg-bg-secondary rounded">
            <div className="text-caption font-semibold mb-1">검증 결과 (적용 전)</div>
            <div className="grid grid-cols-3 gap-1 text-caption">
              <div className="text-green-700">신규 {dryRunResult.added}</div>
              <div className="text-blue-700">변경 {dryRunResult.updated}</div>
              <div className="text-red-700">실패 {dryRunResult.failed.length}</div>
            </div>
            {dryRunResult.failed.length > 0 && (
              <details className="mt-2 text-caption">
                <summary className="cursor-pointer text-red-600">실패 행 보기</summary>
                <div className="mt-1 max-h-40 overflow-y-auto space-y-0.5">
                  {dryRunResult.failed.map((f: any, i: number) => (
                    <div key={i} className="text-[11px]">행 {f.row}: {f.reason}</div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={working} className="px-3 py-1.5 text-caption text-text-secondary">취소</button>
          <button onClick={() => upload(true)} disabled={working || !file}
                  className="px-3 py-1.5 border border-border-default text-caption rounded disabled:opacity-50">
            {working && !dryRunResult ? "검증 중..." : "검증만 (dry-run)"}
          </button>
          <button onClick={() => upload(false)} disabled={working || !file || (dryRunResult && dryRunResult.added === 0 && dryRunResult.updated === 0)}
                  className="px-4 py-1.5 bg-accent text-white text-caption rounded disabled:opacity-50">
            {working ? "등록 중..." : "실제 등록"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateSupervisionModal({ semesterId, onClose, onCreated }: {
  semesterId: number; onClose: () => void; onCreated: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<StudentRow | null>(null);
  const [teacherSearch, setTeacherSearch] = useState("");
  const [teachers, setTeachers] = useState<any[]>([]);
  const [selectedTeacher, setSelectedTeacher] = useState<any>(null);
  const [topicTitle, setTopicTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

        <div className="mb-3">
          <span className="text-caption text-text-tertiary">학생 *</span>
          {selectedStudent ? (
            <div className="mt-0.5 flex items-center justify-between px-2 py-1.5 bg-bg-secondary rounded">
              <span className="text-body text-text-primary">
                {selectedStudent.name}
                {selectedStudent.grade && selectedStudent.class_number && selectedStudent.student_number && (
                  <span className="text-text-tertiary ml-2 text-caption">
                    {selectedStudent.grade}{String(selectedStudent.class_number).padStart(2, "0")}{String(selectedStudent.student_number).padStart(2, "0")}
                  </span>
                )}
                {selectedStudent.username && <span className="text-text-tertiary ml-2 text-caption">({selectedStudent.username})</span>}
              </span>
              <button onClick={() => setSelectedStudent(null)} className="text-text-tertiary">
                <X size={14} />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setPickerOpen(true)}
                    className="mt-0.5 w-full flex items-center justify-center gap-1.5 px-2 py-2 border border-dashed border-border-default rounded text-caption text-text-secondary hover:bg-bg-secondary">
              <Search size={13} /> 학생 명단에서 찾기
            </button>
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

      <StudentPickerModal
        open={pickerOpen}
        mode="single"
        onClose={() => setPickerOpen(false)}
        title="학생 선택"
        onPick={(stu) => setSelectedStudent(stu)}
      />
    </div>
  );
}
