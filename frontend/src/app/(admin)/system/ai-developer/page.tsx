"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import {
  Plus,
  Play,
  Check,
  X,
  Trash2,
  Loader2,
  FileCode,
  AlertTriangle,
} from "lucide-react";

interface DevRequest {
  id: number;
  feedback_id: number | null;
  title: string;
  prompt: string;
  request_type: string;
  status: string;
  created_by_id: number | null;
  used_model: string | null;
  ai_response: string | null;
  file_changes: any[] | null;
  error_message: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
}

interface ModelInfo {
  id: string;
  display_name: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: "초안", color: "bg-gray-200 text-gray-700" },
  generating: { label: "생성중", color: "bg-yellow-100 text-yellow-700" },
  generated: { label: "생성완료", color: "bg-blue-100 text-blue-700" },
  approved: { label: "승인", color: "bg-green-100 text-green-700" },
  applied: { label: "적용됨", color: "bg-green-200 text-green-800" },
  rejected: { label: "거부", color: "bg-red-100 text-red-700" },
  failed: { label: "실패", color: "bg-red-200 text-red-800" },
};

const TYPE_LABELS: Record<string, string> = {
  feature: "기능 추가",
  bugfix: "버그 수정",
  ui_change: "UI 변경",
  config_change: "설정 변경",
};

export default function AiDeveloperPage() {
  const [items, setItems] = useState<DevRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<DevRequest | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  // 새 요청 폼
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newType, setNewType] = useState("feature");

  const fetchList = useCallback(async () => {
    try {
      const data = await api.get("/api/ai-developer?page_size=50");
      setItems(data.items);
      setTotal(data.total);
    } catch {}
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const data = await api.get("/api/ai-developer/models");
      setModels(data.models || []);
      if (data.models?.length > 0) setSelectedModel(data.models[0].id);
    } catch {}
  }, []);

  useEffect(() => { fetchList(); fetchModels(); }, [fetchList, fetchModels]);

  const handleCreate = async () => {
    if (!newTitle.trim() || !newPrompt.trim()) return;
    setLoading(true);
    try {
      const req = await api.post("/api/ai-developer", {
        title: newTitle.trim(),
        prompt: newPrompt.trim(),
        request_type: newType,
      });
      setShowCreate(false);
      setNewTitle("");
      setNewPrompt("");
      fetchList();
      setSelected(req);
    } catch (err: any) {
      alert(err?.detail || "생성 실패");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (id: number) => {
    setGenerating(true);
    try {
      const req = await api.post(`/api/ai-developer/${id}/generate`, {
        model: selectedModel || undefined,
      });
      setSelected(req);
      fetchList();
    } catch (err: any) {
      alert(err?.detail || "코드 생성 실패");
    } finally {
      setGenerating(false);
    }
  };

  const handleReview = async (id: number, action: "approve" | "reject") => {
    if (action === "approve" && !confirm("변경사항을 적용하시겠습니까?")) return;
    setReviewing(true);
    try {
      const req = await api.post(`/api/ai-developer/${id}/review`, { action });
      setSelected(req);
      fetchList();
    } catch (err: any) {
      alert(err?.detail || "리뷰 처리 실패");
    } finally {
      setReviewing(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("삭제하시겠습니까?")) return;
    try {
      await api.delete(`/api/ai-developer/${id}`);
      if (selected?.id === id) setSelected(null);
      fetchList();
    } catch (err: any) {
      alert(err?.detail || "삭제 실패");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">AI 개발자</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover"
        >
          <Plus size={14} /> 새 요청
        </button>
      </div>

      {/* 새 요청 모달 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-bg-primary rounded-lg border border-border-default w-full max-w-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-body font-medium text-text-primary">새 개발 요청</h2>
              <button onClick={() => setShowCreate(false)} className="text-text-tertiary hover:text-text-primary">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="요청 제목"
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
              />
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary"
              >
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <textarea
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                rows={8}
                placeholder="AI에게 전달할 개발 요청 내용을 자세히 작성하세요.&#10;파일 경로(frontend/src/... 또는 backend/app/...)를 포함하면 자동으로 참조합니다."
                className="w-full px-3 py-2 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent resize-y"
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary">
                취소
              </button>
              <button
                onClick={handleCreate}
                disabled={loading || !newTitle.trim() || !newPrompt.trim()}
                className="px-4 py-1.5 text-caption bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
              >
                {loading ? "생성 중..." : "생성"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 요청 목록 */}
        <div className="space-y-2">
          {items.map((req) => {
            const st = STATUS_LABELS[req.status] || STATUS_LABELS.draft;
            return (
              <div
                key={req.id}
                onClick={() => setSelected(req)}
                className={`p-3 bg-bg-primary border rounded-lg cursor-pointer hover:border-accent transition-colors ${
                  selected?.id === req.id ? "border-accent" : "border-border-default"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                  <span className="text-[11px] text-text-tertiary">{TYPE_LABELS[req.request_type]}</span>
                </div>
                <div className="text-[13px] font-medium text-text-primary truncate">{req.title}</div>
                <div className="text-[11px] text-text-tertiary mt-1">
                  {new Date(req.created_at).toLocaleDateString("ko-KR")}
                  {req.used_model && ` · ${req.used_model}`}
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <div className="p-8 text-center text-text-tertiary text-body">요청이 없습니다</div>
          )}
        </div>

        {/* 상세 패널 */}
        <div className="lg:col-span-2 bg-bg-primary border border-border-default rounded-lg p-6">
          {selected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-body font-semibold text-text-primary">{selected.title}</h2>
                <div className="flex items-center gap-2">
                  {selected.status !== "applied" && (
                    <button onClick={() => handleDelete(selected.id)} className="p-1 text-text-tertiary hover:text-status-error">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>

              {/* 프롬프트 */}
              <div>
                <div className="text-caption text-text-tertiary mb-1">요청 내용</div>
                <div className="text-[13px] text-text-primary whitespace-pre-wrap bg-bg-secondary rounded p-3 max-h-48 overflow-y-auto">
                  {selected.prompt}
                </div>
              </div>

              {/* 액션 버튼 */}
              {["draft", "failed", "rejected"].includes(selected.status) && (
                <div className="flex items-center gap-3">
                  {models.length > 0 && (
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="px-3 py-1.5 text-[12px] border border-border-default rounded bg-bg-primary"
                    >
                      {models.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                    </select>
                  )}
                  <button
                    onClick={() => handleGenerate(selected.id)}
                    disabled={generating}
                    className="flex items-center gap-1.5 px-4 py-2 text-[13px] bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
                  >
                    {generating ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    코드 생성
                  </button>
                </div>
              )}

              {/* AI 응답 */}
              {selected.ai_response && (
                <div>
                  <div className="text-caption text-text-tertiary mb-1">AI 응답</div>
                  <div className="text-[13px] text-text-primary bg-bg-secondary rounded p-3">
                    {selected.ai_response}
                  </div>
                </div>
              )}

              {/* 파일 변경사항 */}
              {selected.file_changes && selected.file_changes.length > 0 && (
                <div>
                  <div className="text-caption text-text-tertiary mb-1">
                    변경 파일 ({selected.file_changes.length}개)
                  </div>
                  <div className="space-y-1">
                    {selected.file_changes.map((change: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 bg-bg-secondary rounded text-[12px]">
                        <FileCode size={14} className={
                          change.action === "create" ? "text-green-600"
                          : change.action === "delete" ? "text-red-600"
                          : "text-blue-600"
                        } />
                        <span className="font-mono text-text-primary">{change.file_path}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          change.action === "create" ? "bg-green-100 text-green-700"
                          : change.action === "delete" ? "bg-red-100 text-red-700"
                          : "bg-blue-100 text-blue-700"
                        }`}>
                          {change.action}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 에러 */}
              {selected.error_message && (
                <div className="flex items-start gap-2 p-3 bg-red-50 rounded text-[13px] text-red-700">
                  <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                  <span>{selected.error_message}</span>
                </div>
              )}

              {/* 승인/거부 */}
              {selected.status === "generated" && (
                <div className="flex gap-3 pt-2 border-t border-border-default">
                  <button
                    onClick={() => handleReview(selected.id, "approve")}
                    disabled={reviewing}
                    className="flex items-center gap-1.5 px-4 py-2 text-[13px] bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                  >
                    <Check size={14} /> 승인 및 적용
                  </button>
                  <button
                    onClick={() => handleReview(selected.id, "reject")}
                    disabled={reviewing}
                    className="flex items-center gap-1.5 px-4 py-2 text-[13px] bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                  >
                    <X size={14} /> 거부
                  </button>
                </div>
              )}

              {/* 관리자 메모 */}
              {selected.admin_note && (
                <div className="text-[12px] text-text-tertiary whitespace-pre-wrap">
                  {selected.admin_note}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-text-tertiary py-16 text-body">
              왼쪽에서 요청을 선택하세요
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
