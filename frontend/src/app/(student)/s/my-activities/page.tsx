"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload, Loader2, FileText, Users, ClipboardList, AlertCircle, CheckCircle2, XCircle,
  Clock, Download,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { downloadSecure } from "@/lib/api/download";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

interface Activity {
  group_id: number;
  group_name: string;
  type: string;
  description: string | null;
  teacher_id: number;
  teacher_name: string;
  submissions: Sub[];
}

interface Sub {
  id: number;
  title: string;
  status: string;
  file_url: string | null;
  file_name: string | null;
  rejection_reason: string | null;
  created_at: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  event: "행사", contest: "대회", research: "연구", etc: "기타",
};

export default function MyActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadGroupId, setUploadGroupId] = useState<number | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/teacher-groups/_my/student-activities");
      setActivities(data.items || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSubmitFile = async () => {
    if (!uploadGroupId || !uploadFile || !uploadTitle.trim()) {
      alert("그룹/파일/제목 모두 입력");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("title", uploadTitle.trim());
      if (uploadDesc.trim()) fd.append("description", uploadDesc.trim());
      const token = localStorage.getItem("access_token");
      const res = await fetch(`${API_URL}/api/teacher-groups/${uploadGroupId}/_submissions`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || `HTTP ${res.status}`);
      }
      alert("제출 완료! 담당 교사 승인을 기다려주세요.");
      setUploadGroupId(null);
      setUploadFile(null);
      setUploadTitle("");
      setUploadDesc("");
      if (inputRef.current) inputRef.current.value = "";
      load();
    } catch (e: any) {
      alert(`제출 실패: ${e.message || e}`);
    } finally {
      setUploading(false);
    }
  };

  const statusBadge = (s: string) => {
    if (s === "approved") return <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded"><CheckCircle2 size={10} /> 승인됨</span>;
    if (s === "rejected") return <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded"><XCircle size={10} /> 반려</span>;
    return <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded"><Clock size={10} /> 검토 중</span>;
  };

  if (loading) return <div className="p-12 text-center"><Loader2 size={20} className="animate-spin mx-auto" /></div>;

  return (
    <div>
      <h1 className="text-title text-text-primary mb-1">내 활동</h1>
      <p className="text-caption text-text-tertiary mb-4">
        담당 교사가 등록해준 그룹별 활동·산출물을 관리할 수 있습니다.
      </p>

      {activities.length === 0 ? (
        <div className="p-8 text-center text-text-tertiary bg-bg-primary border border-border-default rounded-lg">
          <Users size={32} className="mx-auto mb-2 opacity-50" />
          <div className="text-body">등록된 활동이 없습니다</div>
          <div className="text-caption mt-1">담당 교사가 행사/대회/연구 그룹에 등록해야 표시됩니다</div>
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map((a) => (
            <div key={a.group_id} className="bg-bg-primary border border-border-default rounded-lg overflow-hidden">
              <div className="p-3 border-b border-border-default">
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] px-1.5 py-0.5 bg-cream-100 text-blue-700 rounded">{TYPE_LABEL[a.type] || a.type}</span>
                      <h3 className="text-body font-semibold text-text-primary">{a.group_name}</h3>
                    </div>
                    {a.description && <div className="text-caption text-text-tertiary mt-1 whitespace-pre-wrap">{a.description}</div>}
                    <div className="text-caption text-text-tertiary mt-1">담당: {a.teacher_name} 선생님</div>
                  </div>
                  <button
                    onClick={() => { setUploadGroupId(a.group_id); setUploadTitle(""); setUploadDesc(""); setUploadFile(null); }}
                    className="px-3 py-1.5 bg-accent text-white text-caption rounded inline-flex items-center gap-1"
                  >
                    <Upload size={12} /> 산출물 업로드
                  </button>
                </div>
              </div>

              {/* 본인 산출물 list */}
              {a.submissions.length > 0 && (
                <div className="p-3 space-y-1">
                  {a.submissions.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 p-2 bg-bg-secondary rounded">
                      <FileText size={14} className="text-text-tertiary" />
                      <div className="flex-1 min-w-0">
                        <div className="text-caption text-text-primary truncate">{s.title}</div>
                        {s.rejection_reason && <div className="text-[10px] text-red-600 mt-0.5">반려 사유: {s.rejection_reason}</div>}
                      </div>
                      {statusBadge(s.status)}
                      {s.file_url && (
                        <button onClick={() => downloadSecure(s.file_url!, s.file_name || undefined)}
                                className="p-1 text-text-tertiary hover:text-text-primary">
                          <Download size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 업로드 모달 */}
      {uploadGroupId !== null && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-bg-primary rounded-lg p-5 w-full max-w-md">
            <h3 className="text-body font-semibold text-text-primary mb-3">산출물 업로드</h3>
            <input
              ref={inputRef} type="file"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className="mb-3 w-full text-caption"
            />
            <input
              type="text" placeholder="제목 *"
              value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)}
              className="w-full mb-2 px-3 py-1.5 border border-border-default rounded text-body bg-bg-primary"
            />
            <textarea
              placeholder="설명 (선택)"
              value={uploadDesc} onChange={(e) => setUploadDesc(e.target.value)}
              rows={3}
              className="w-full mb-3 px-3 py-1.5 border border-border-default rounded text-caption bg-bg-primary"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setUploadGroupId(null)} disabled={uploading}
                      className="px-3 py-1.5 text-caption text-text-secondary">취소</button>
              <button onClick={onSubmitFile} disabled={uploading || !uploadFile || !uploadTitle.trim()}
                      className="px-4 py-1.5 bg-accent text-white text-caption rounded disabled:opacity-50">
                {uploading ? "업로드 중..." : "제출"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
