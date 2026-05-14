"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus, ExternalLink, Trash2, Edit3, Eye, EyeOff,
  FileText, Image as ImageIcon, Film, Folder, Globe, Save, X,
  ClipboardList, Users2, LayoutGrid, ListChecks,
} from "lucide-react";
import { api } from "@/lib/api/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

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

interface AssignmentSubmission {
  id: number;
  assignment_id: number;
  assignment_title: string;
  subject: string;
  filename: string | null;
  file_size: number | null;
  status: string;
  submitted_at: string | null;
  review_comment: string | null;
  show_in_portfolio: boolean;
}

interface ClubSubmission {
  id: number;
  club_id: number;
  club_name: string;
  title: string;
  submission_type: string;
  file_path: string | null;
  created_at: string | null;
}

interface TimelineItem {
  type: "artifact" | "assignment_submission" | "club_submission";
  id: number;
  title: string;
  date: string | null;
  // 공통 외 분기 필드들
  category?: string;
  description?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  is_public?: boolean;
  subject?: string;
  filename?: string | null;
  status?: string;
  review_comment?: string | null;
  show_in_portfolio?: boolean;
  club_name?: string;
  submission_type?: string;
  file_path?: string | null;
}

const CATEGORIES = [
  { key: "report", label: "보고서/논문", icon: FileText },
  { key: "presentation", label: "발표자료", icon: FileText },
  { key: "project", label: "프로젝트", icon: Folder },
  { key: "media", label: "이미지/영상", icon: ImageIcon },
  { key: "other", label: "기타", icon: Folder },
];

type Tab = "timeline" | "artifacts" | "assignments" | "clubs";

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: "timeline", label: "전체 (timeline)", icon: ListChecks },
  { key: "artifacts", label: "자유 산출물", icon: LayoutGrid },
  { key: "assignments", label: "과제 제출물", icon: ClipboardList },
  { key: "clubs", label: "동아리 산출물", icon: Users2 },
];

export default function MyPortfolioPage() {
  const [tab, setTab] = useState<Tab>("timeline");

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-title text-text-primary">나의 포트폴리오</h1>
        <p className="text-caption text-text-tertiary mt-0.5">
          자유 업로드 산출물 · 과제 제출물 · 동아리 산출물을 한 곳에서 관리하세요.
        </p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 mb-5 bg-bg-secondary rounded-lg p-1 w-fit flex-wrap">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-body rounded transition-colors ${
              tab === key
                ? "bg-bg-primary text-accent font-medium shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === "timeline" && <TimelineTab />}
      {tab === "artifacts" && <ArtifactsTab />}
      {tab === "assignments" && <AssignmentsTab />}
      {tab === "clubs" && <ClubsTab />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 전체 timeline 탭
// ─────────────────────────────────────────────────────────────
function TimelineTab() {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/me/all-activities");
      setItems(data.items);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const totals = {
    artifact: items.filter(i => i.type === "artifact").length,
    assignment: items.filter(i => i.type === "assignment_submission").length,
    club: items.filter(i => i.type === "club_submission").length,
  };

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="총 활동" value={items.length} icon={ListChecks} accent />
        <StatCard label="자유 산출물" value={totals.artifact} icon={LayoutGrid} />
        <StatCard label="과제 제출물" value={totals.assignment} icon={ClipboardList} />
        <StatCard label="동아리 산출물" value={totals.club} icon={Users2} />
      </div>

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : items.length === 0 ? (
        <EmptyState text="아직 활동 기록이 없습니다" />
      ) : (
        <div className="space-y-2">
          {items.map((it) => <TimelineRow key={`${it.type}-${it.id}`} item={it} />)}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon: Icon, accent = false }: any) {
  return (
    <div className={`bg-bg-primary border ${accent ? "border-accent" : "border-border-default"} rounded-lg p-3`}>
      <div className="flex items-center gap-2 text-caption text-text-tertiary mb-1">
        <Icon size={14} /> {label}
      </div>
      <div className={`text-title ${accent ? "text-accent" : "text-text-primary"}`}>{value}</div>
    </div>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  const typeMeta = {
    artifact: { label: "자유 산출물", color: "bg-cream-200 text-blue-700", icon: LayoutGrid },
    assignment_submission: { label: "과제 제출", color: "bg-purple-100 text-purple-700", icon: ClipboardList },
    club_submission: { label: "동아리 산출", color: "bg-orange-100 text-orange-700", icon: Users2 },
  }[item.type];
  const Icon = typeMeta.icon;

  return (
    <div className="bg-bg-primary border border-border-default rounded-lg p-3 flex items-start gap-3">
      <div className="flex-shrink-0 mt-0.5">
        <Icon size={16} className="text-text-tertiary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className={`px-2 py-0.5 text-caption rounded ${typeMeta.color}`}>{typeMeta.label}</span>
          {item.type === "assignment_submission" && item.show_in_portfolio && (
            <span className="px-2 py-0.5 text-caption rounded bg-green-100 text-green-700">포트폴리오 노출 ON</span>
          )}
          {item.type === "artifact" && item.is_public && (
            <span className="px-2 py-0.5 text-caption rounded bg-green-100 text-green-700">공개</span>
          )}
          {item.date && <span className="text-caption text-text-tertiary">{item.date.slice(0, 10)}</span>}
        </div>
        <div className="text-body text-text-primary font-medium truncate">{item.title}</div>
        {item.type === "artifact" && item.description && (
          <div className="text-caption text-text-secondary line-clamp-2 mt-0.5">{item.description}</div>
        )}
        {item.type === "assignment_submission" && (
          <div className="text-caption text-text-tertiary mt-0.5">
            {item.subject} {item.filename && `· ${item.filename}`} {item.status && `· ${item.status}`}
          </div>
        )}
        {item.type === "club_submission" && (
          <div className="text-caption text-text-tertiary mt-0.5">
            {item.club_name} · {item.submission_type}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-10 text-center">
      <Folder size={28} className="mx-auto text-text-tertiary mb-2" />
      <div className="text-body text-text-tertiary">{text}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 자유 산출물 탭 (기존 로직)
// ─────────────────────────────────────────────────────────────
function ArtifactsTab() {
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
      <div className="flex items-center justify-between mb-3">
        <span className="text-caption text-text-tertiary">총 {items.length}건</span>
        <button onClick={() => { resetForm(); setShowForm(true); }}
                className="flex items-center gap-1 px-3 py-2 bg-accent text-white rounded text-body">
          <Plus size={14} /> 산출물 추가
        </button>
      </div>

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

// ─────────────────────────────────────────────────────────────
// 과제 제출물 탭 (toggle 포함)
// ─────────────────────────────────────────────────────────────
function AssignmentsTab() {
  const [items, setItems] = useState<AssignmentSubmission[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/me/assignment-submissions");
      setItems(data.items);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (s: AssignmentSubmission) => {
    try {
      await api.put(`/api/me/assignment-submissions/${s.id}/portfolio-visibility`, {
        show_in_portfolio: !s.show_in_portfolio,
      });
      setItems((prev) => prev.map((p) => p.id === s.id ? { ...p, show_in_portfolio: !p.show_in_portfolio } : p));
    } catch (e: any) {
      alert(e?.detail || "토글 실패");
    }
  };

  const remove = async (s: AssignmentSubmission) => {
    if (!confirm(`"${s.assignment_title}" 제출물을 삭제하시겠습니까? (교사가 검토하기 전에만 가능)`)) return;
    try {
      await api.delete(`/api/me/assignment-submissions/${s.id}`);
      setItems((prev) => prev.filter((p) => p.id !== s.id));
    } catch (e: any) {
      alert(e?.detail || "삭제 실패 (이미 검토되었을 수 있음)");
    }
  };

  const visibleCount = items.filter((s) => s.show_in_portfolio).length;

  return (
    <div>
      <div className="mb-4 p-3 bg-cream-100 border border-cream-300 rounded-lg">
        <div className="text-caption text-blue-900">
          ⓘ 과제 제출물을 <b>"포트폴리오 노출"</b>로 켜면 PDF 생기부, 공개 갤러리에 자동으로 포함됩니다.
          {" "}현재 노출 중: <b>{visibleCount}개</b> / 전체 {items.length}개
        </div>
      </div>

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : items.length === 0 ? (
        <EmptyState text="아직 과제 제출 기록이 없습니다" />
      ) : (
        <div className="space-y-2">
          {items.map((s) => (
            <div key={s.id} className="bg-bg-primary border border-border-default rounded-lg p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-body text-text-primary font-medium">{s.assignment_title}</div>
                  <div className="text-caption text-text-tertiary mt-0.5">
                    {s.subject} {s.filename && `· ${s.filename}`} {s.submitted_at && `· ${s.submitted_at.slice(0, 10)}`}
                  </div>
                  {s.review_comment && (
                    <div className="text-caption text-text-secondary mt-1 italic">교사 코멘트: {s.review_comment}</div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggle(s)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded text-caption border ${
                      s.show_in_portfolio
                        ? "bg-green-50 border-green-300 text-green-700"
                        : "bg-bg-secondary border-border-default text-text-tertiary"
                    }`}
                  >
                    {s.show_in_portfolio ? <Eye size={13} /> : <EyeOff size={13} />}
                    {s.show_in_portfolio ? "노출 ON" : "노출 OFF"}
                  </button>
                  <button
                    onClick={() => remove(s)}
                    className="p-1.5 text-text-tertiary hover:text-status-error"
                    title="제출물 삭제 (검토 전만 가능)"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 동아리 산출물 탭 (수정/삭제 가능)
// ─────────────────────────────────────────────────────────────
function ClubsTab() {
  const [items, setItems] = useState<ClubSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/me/club-submissions");
      setItems(data.items);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const startEdit = (c: ClubSubmission) => {
    setEditingId(c.id);
    setEditTitle(c.title);
  };
  const saveEdit = async () => {
    if (!editingId) return;
    if (!editTitle.trim()) return alert("제목을 입력하세요");
    try {
      await api.put(`/api/me/club-submissions/${editingId}`, { title: editTitle });
      setItems((prev) => prev.map((p) => p.id === editingId ? { ...p, title: editTitle } : p));
      setEditingId(null);
    } catch (e: any) {
      alert(e?.detail || "수정 실패");
    }
  };
  const remove = async (c: ClubSubmission) => {
    if (!confirm(`"${c.title}" 산출물을 삭제하시겠습니까?`)) return;
    try {
      await api.delete(`/api/me/club-submissions/${c.id}`);
      setItems((prev) => prev.filter((p) => p.id !== c.id));
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  return (
    <div>
      <div className="mb-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
        <div className="text-caption text-orange-900">
          ⓘ 동아리 산출물은 동아리 페이지(<b>활동/대회/과제</b>)에서 새로 등록합니다. 여기서는 본인 제출 기록 확인 + 제목 수정·삭제.
        </div>
      </div>

      {loading ? (
        <div className="text-text-tertiary">로딩 중...</div>
      ) : items.length === 0 ? (
        <EmptyState text="아직 동아리 산출물이 없습니다" />
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <div key={c.id} className="bg-bg-primary border border-border-default rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  {editingId === c.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="flex-1 px-2 py-1 text-body border border-border-default rounded"
                        autoFocus
                      />
                      <button onClick={saveEdit} className="px-2 py-1 bg-accent text-white text-caption rounded">저장</button>
                      <button onClick={() => setEditingId(null)} className="px-2 py-1 border border-border-default text-caption rounded">취소</button>
                    </div>
                  ) : (
                    <div className="text-body text-text-primary font-medium">{c.title}</div>
                  )}
                  <div className="text-caption text-text-tertiary mt-0.5">
                    {c.club_name} · {c.submission_type}
                    {c.created_at && ` · ${c.created_at.slice(0, 10)}`}
                  </div>
                </div>
                {editingId !== c.id && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEdit(c)} className="p-1.5 text-text-tertiary hover:text-accent" title="제목 수정">
                      <Edit3 size={14} />
                    </button>
                    <button onClick={() => remove(c)} className="p-1.5 text-text-tertiary hover:text-status-error" title="삭제">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
              {c.file_path && (
                <a href={`${API_URL}${c.file_path}`} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 mt-1.5 px-2 py-1 text-caption bg-bg-secondary rounded">
                  <FileText size={12} /> 파일 열기
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
