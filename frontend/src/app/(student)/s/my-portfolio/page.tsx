"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus, Upload, ExternalLink, Trash2, Edit3, Eye, EyeOff,
  FileText, Image as ImageIcon, Film, Folder, Globe, Save, X,
} from "lucide-react";
import { api } from "@/lib/api/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8002";

interface Artifact {
  id: number;
  title: string;
  description: string | null;
  category: string;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  external_link: string | null;
  tags: string[];
  is_public: boolean;
  created_at: string | null;
}

const CATEGORIES = [
  { key: "report", label: "보고서/논문", icon: FileText },
  { key: "presentation", label: "발표자료", icon: FileText },
  { key: "project", label: "프로젝트", icon: Folder },
  { key: "media", label: "이미지/영상", icon: ImageIcon },
  { key: "other", label: "기타", icon: Folder },
];

export default function MyPortfolioPage() {
  const [items, setItems] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const [form, setForm] = useState({
    title: "", description: "", category: "report",
    external_link: "", is_public: false, tags: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/me/artifacts");
      setItems(data.items);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => {
    setForm({ title: "", description: "", category: "report",
              external_link: "", is_public: false, tags: "" });
    setFile(null);
    setEditingId(null);
    setShowForm(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const startEdit = (a: Artifact) => {
    setForm({
      title: a.title, description: a.description || "",
      category: a.category, external_link: a.external_link || "",
      is_public: a.is_public, tags: (a.tags || []).join(", "),
    });
    setEditingId(a.id);
    setFile(null);
    setShowForm(true);
  };

  const save = async () => {
    if (!form.title.trim()) return alert("제목을 입력하세요");
    setUploading(true);
    try {
      if (editingId) {
        // 메타 수정 (파일 교체는 일단 미지원)
        await api.put(`/api/me/artifacts/${editingId}`, {
          title: form.title, description: form.description || null,
          category: form.category, external_link: form.external_link || null,
          is_public: form.is_public,
          tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        });
      } else {
        const fd = new FormData();
        fd.append("title", form.title);
        if (form.description) fd.append("description", form.description);
        fd.append("category", form.category);
        if (form.external_link) fd.append("external_link", form.external_link);
        fd.append("is_public", String(form.is_public));
        if (form.tags) fd.append("tags", form.tags);
        if (file) fd.append("file", file);
        await api.fetch("/api/me/artifacts", { method: "POST", body: fd });
      }
      resetForm();
      await load();
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
    } finally { setUploading(false); }
  };

  const remove = async (id: number) => {
    if (!confirm("정말 삭제하시겠습니까? (복구 불가)")) return;
    await api.delete(`/api/me/artifacts/${id}`);
    await load();
  };

  const togglePublic = async (a: Artifact) => {
    await api.put(`/api/me/artifacts/${a.id}`, { is_public: !a.is_public });
    await load();
  };

  const filtered = filter === "all" ? items : items.filter((a) => a.category === filter);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-title text-text-primary">나의 포트폴리오</h1>
          <p className="text-caption text-text-tertiary mt-0.5">
            보고서, 발표자료, 프로젝트, 영상 등 본인의 산출물을 누적 보관하세요.
          </p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }}
                className="flex items-center gap-1 px-3 py-2 bg-accent text-white rounded text-body">
          <Plus size={14} /> 산출물 추가
        </button>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap gap-1 mb-4">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1 text-caption rounded ${filter === "all" ? "bg-accent text-white" : "bg-bg-primary border border-border-default"}`}
        >전체 {items.length}</button>
        {CATEGORIES.map((c) => {
          const count = items.filter((i) => i.category === c.key).length;
          return (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={`px-3 py-1 text-caption rounded ${filter === c.key ? "bg-accent text-white" : "bg-bg-primary border border-border-default"}`}
            >{c.label} {count}</button>
          );
        })}
      </div>

      {/* 폼 */}
      {showForm && (
        <div className="mb-4 bg-bg-primary border border-accent rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-body font-semibold">{editingId ? "산출물 수정" : "산출물 추가"}</h2>
            <button onClick={resetForm}><X size={16} /></button>
          </div>
          <div className="space-y-3">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="제목"
              className="w-full px-3 py-2 border border-border-default rounded text-body"
            />
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="설명 (활동 배경, 역할, 결과 등)"
              rows={3}
              className="w-full px-3 py-2 border border-border-default rounded text-body"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="px-3 py-2 border border-border-default rounded text-body"
              >
                {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <input
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="태그 (쉼표 구분)"
                className="px-3 py-2 border border-border-default rounded text-body"
              />
            </div>
            <input
              value={form.external_link}
              onChange={(e) => setForm({ ...form, external_link: e.target.value })}
              placeholder="외부 링크 (GitHub, YouTube 등 - 선택)"
              className="w-full px-3 py-2 border border-border-default rounded text-body"
            />
            {!editingId && (
              <div>
                <label className="block text-caption text-text-secondary mb-1">파일 (선택, 최대 50MB)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="w-full text-body"
                />
                {file && <div className="text-caption text-text-tertiary mt-1">선택됨: {file.name} ({(file.size/1024/1024).toFixed(2)}MB)</div>}
              </div>
            )}
            <label className="flex items-center gap-2 text-body">
              <input type="checkbox"
                checked={form.is_public}
                onChange={(e) => setForm({ ...form, is_public: e.target.checked })}
              />
              다른 학생/교사가 열람 가능 (공개)
            </label>
            <div className="flex gap-2">
              <button onClick={save} disabled={uploading}
                      className="flex items-center gap-1 px-4 py-2 bg-accent text-white rounded text-body disabled:opacity-50">
                <Save size={14} /> {uploading ? "저장 중..." : "저장"}
              </button>
              <button onClick={resetForm} className="px-4 py-2 border border-border-default rounded text-body">취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 목록 */}
      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-12 text-center">
          <Folder size={32} className="mx-auto text-text-tertiary mb-2" />
          <div className="text-body text-text-tertiary">아직 등록된 산출물이 없습니다</div>
          <button onClick={() => { resetForm(); setShowForm(true); }}
                  className="mt-3 px-3 py-1.5 bg-accent text-white rounded text-caption">
            첫 산출물 등록하기
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((a) => (
            <ArtifactCard key={a.id} a={a} onEdit={startEdit} onRemove={remove} onTogglePublic={togglePublic} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactCard({ a, onEdit, onRemove, onTogglePublic }: any) {
  const CategoryIcon = CATEGORIES.find((c) => c.key === a.category)?.icon || Folder;
  return (
    <div className="bg-bg-primary border border-border-default rounded-lg p-4">
      <div className="flex items-start gap-2 mb-2">
        <CategoryIcon size={16} className="text-accent mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-body font-medium text-text-primary truncate">{a.title}</div>
          <div className="text-caption text-text-tertiary">
            {CATEGORIES.find((c) => c.key === a.category)?.label}
            {a.created_at && ` · ${a.created_at.slice(0, 10)}`}
          </div>
        </div>
        <button
          onClick={() => onTogglePublic(a)}
          title={a.is_public ? "공개됨 (클릭하여 비공개)" : "비공개 (클릭하여 공개)"}
          className={`p-1 rounded ${a.is_public ? "text-accent" : "text-text-tertiary"}`}
        >
          {a.is_public ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      </div>

      {a.description && (
        <div className="text-caption text-text-secondary mb-2 line-clamp-2">{a.description}</div>
      )}

      {(a.tags || []).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {a.tags.map((t: string) => (
            <span key={t} className="px-2 py-0.5 bg-bg-secondary text-caption text-text-secondary rounded">
              #{t}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border-default">
        {a.file_url && (
          <a href={`${API_URL}${a.file_url}`} target="_blank" rel="noopener noreferrer"
             className="flex items-center gap-1 px-2 py-1 text-caption bg-bg-secondary rounded hover:bg-accent-light">
            <FileText size={12} /> 파일 ({((a.file_size || 0)/1024/1024).toFixed(2)}MB)
          </a>
        )}
        {a.external_link && (
          <a href={a.external_link} target="_blank" rel="noopener noreferrer"
             className="flex items-center gap-1 px-2 py-1 text-caption bg-bg-secondary rounded hover:bg-accent-light">
            <Globe size={12} /> 링크
          </a>
        )}
        <div className="flex-1" />
        <button onClick={() => onEdit(a)} className="p-1 text-text-tertiary hover:text-accent" title="수정">
          <Edit3 size={13} />
        </button>
        <button onClick={() => onRemove(a.id)} className="p-1 text-text-tertiary hover:text-status-error" title="삭제">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
