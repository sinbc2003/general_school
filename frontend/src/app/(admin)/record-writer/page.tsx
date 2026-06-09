"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Users,
  Loader2,
  Trash2,
  ClipboardList,
  X,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { api } from "@/lib/api/client";

interface Project {
  id: number;
  name: string;
  scope_type: string;
  scope_ref_id: number | null;
  scope_ref_class: string | null;
  student_count: number;
  created_at: string | null;
  updated_at: string | null;
}

interface ScopeOptions {
  courses: { id: number; label: string }[];
  homerooms: string[];
  clubs: { id: number; label: string }[];
  groups: { id: number; label: string }[];
  research_count: number;
}

const SCOPE_LABELS: Record<string, string> = {
  course: "수업",
  homeroom: "담임",
  club: "동아리",
  group: "그룹",
  research: "연구",
  manual: "직접 선택",
};

// 생기부 종류 — 종류마다 대상 학생군(범위)이 다르다.
const RECORD_TYPES = [
  { id: "subject", label: "교과 세부능력 및 특기사항", scope: "course", target: "수업 듣는 학생" },
  { id: "individual", label: "개인별 세부능력 및 특기사항", scope: "course", target: "수업 듣는 학생" },
  { id: "club", label: "동아리활동 특기사항", scope: "club", target: "담당 동아리 학생" },
  { id: "autonomous", label: "자율활동 특기사항", scope: "homeroom", target: "담임 학급 학생" },
  { id: "career", label: "진로활동 특기사항", scope: "homeroom", target: "담임 학급 학생" },
  { id: "behavior", label: "행동특성 및 종합의견", scope: "homeroom", target: "담임 학급 학생" },
  { id: "custom", label: "직접 구성", scope: "", target: "범위·항목을 직접 구성" },
];

export default function RecordWriterPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/record-writer/projects");
      setProjects(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onDelete = async (id: number, name: string) => {
    if (!confirm(`'${name}' 생활기록부 프로젝트를 삭제하시겠습니까? (휴지통으로 이동)`)) return;
    try {
      await api.delete(`/api/record-writer/projects/${id}`);
      await load();
    } catch (e: any) {
      alert(`삭제 실패: ${e?.detail || e}`);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-title text-text-primary">생활기록부 작성</h1>
          <p className="text-caption text-text-tertiary mt-1">
            종류를 고르면 대상 학생이 자동으로 채워지고, 학생이 과제·설문을 제출하면 셀에 자동 반영됩니다.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-accent text-white rounded text-body inline-flex items-center gap-2 whitespace-nowrap"
        >
          <Plus size={16} /> 새 생활기록부
        </button>
      </div>

      {loading ? (
        <div className="p-12 text-center text-text-tertiary">
          <Loader2 size={20} className="animate-spin mx-auto" />
        </div>
      ) : projects.length === 0 ? (
        <div className="p-12 text-center text-text-tertiary border border-dashed border-border-default rounded-lg">
          <ClipboardList size={32} className="mx-auto mb-2 opacity-50" />
          <div className="text-body">아직 생활기록부 프로젝트가 없습니다.</div>
          <div className="text-caption mt-1">&quot;새 생활기록부&quot;로 종류를 선택해 시작하세요.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects.map((p) => (
            <div
              key={p.id}
              onClick={() => router.push(`/record-writer/${p.id}`)}
              className="bg-bg-primary border border-border-default rounded-lg p-4 cursor-pointer hover:shadow-md transition group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-body font-semibold text-text-primary truncate">{p.name}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="px-1.5 py-0.5 bg-cream-100 text-amber-700 rounded text-[10px]">
                      {SCOPE_LABELS[p.scope_type] || p.scope_type}
                    </span>
                    <span className="text-caption text-text-tertiary inline-flex items-center gap-1">
                      <Users size={12} /> {p.student_count}명
                    </span>
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(p.id, p.name);
                  }}
                  title="삭제"
                  className="p-1.5 hover:bg-red-50 rounded text-red-600 opacity-0 group-hover:opacity-100 transition"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex items-center justify-end mt-2 text-caption text-accent">
                열기 <ChevronRight size={14} />
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            router.push(`/record-writer/${id}`);
          }}
        />
      )}
    </div>
  );
}

function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [typeId, setTypeId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [refId, setRefId] = useState("");
  const [refClass, setRefClass] = useState("");
  const [customScope, setCustomScope] = useState("course");
  const [opts, setOpts] = useState<ScopeOptions | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api
      .get("/api/record-writer/scope-options")
      .then(setOpts)
      .catch(() => setOpts(null));
  }, []);

  const selected = RECORD_TYPES.find((t) => t.id === typeId);
  const scope = typeId === "custom" ? customScope : selected?.scope || "";

  const pickType = (t: (typeof RECORD_TYPES)[number]) => {
    setTypeId(t.id);
    setName(t.id === "custom" ? "새 생활기록부" : t.label);
    setRefId("");
    setRefClass("");
  };

  const submit = async () => {
    const body: any = { name: name.trim() || "새 생활기록부", scope_type: scope };
    if (typeId && typeId !== "custom") body.template_id = typeId;
    if (["course", "club", "group"].includes(scope)) {
      if (!refId) {
        alert("대상을 선택하세요");
        return;
      }
      body.scope_ref_id = Number(refId);
    }
    if (scope === "homeroom") {
      if (!refClass) {
        alert("학급을 선택하세요");
        return;
      }
      body.scope_ref_class = refClass;
    }
    setCreating(true);
    try {
      const res = await api.post("/api/record-writer/projects", body);
      onCreated(res.id);
    } catch (e: any) {
      alert(`생성 실패: ${e?.detail || e}`);
      setCreating(false);
    }
  };

  const selectCls = "w-full px-3 py-2 border border-border-default rounded text-body bg-bg-primary mb-4";
  const lbl = "block text-caption text-text-secondary mb-1";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary rounded-lg w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-body font-semibold text-text-primary">
            {typeId ? selected?.label || "직접 구성" : "생활기록부 종류 선택"}
          </h2>
          <button onClick={onClose}>
            <X size={18} className="text-text-tertiary hover:text-text-primary" />
          </button>
        </div>

        {/* 1단계: 종류 카드 */}
        {!typeId ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {RECORD_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => pickType(t)}
                className="text-left p-3 border border-border-default rounded-lg hover:border-accent hover:bg-cream-100/40 transition"
              >
                <div className="text-body font-medium text-text-primary">{t.label}</div>
                <div className="text-caption text-text-tertiary mt-0.5">{t.target}</div>
              </button>
            ))}
          </div>
        ) : (
          <>
            <button
              onClick={() => setTypeId(null)}
              className="text-caption text-text-tertiary inline-flex items-center gap-1 mb-3 hover:text-text-primary"
            >
              <ArrowLeft size={13} /> 종류 다시 선택
            </button>

            <label className={lbl}>이름</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-border-default rounded text-body bg-bg-primary mb-4"
            />

            {typeId === "custom" && (
              <>
                <label className={lbl}>범위</label>
                <select
                  value={customScope}
                  onChange={(e) => {
                    setCustomScope(e.target.value);
                    setRefId("");
                    setRefClass("");
                  }}
                  className={selectCls}
                >
                  <option value="course">수업 (강좌 수강생)</option>
                  <option value="homeroom">담임 (학급 학생)</option>
                  <option value="club">동아리 (담당 부원)</option>
                  <option value="group">그룹 (담당 학생)</option>
                  <option value="research">연구 (담당 학생)</option>
                  <option value="manual">직접 선택 (빈 프로젝트)</option>
                </select>
              </>
            )}

            {scope === "course" && (
              <>
                <label className={lbl}>대상 강좌</label>
                <select value={refId} onChange={(e) => setRefId(e.target.value)} className={selectCls}>
                  <option value="">강좌 선택</option>
                  {opts?.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </>
            )}
            {scope === "homeroom" && (
              <>
                <label className={lbl}>담임 학급</label>
                <select value={refClass} onChange={(e) => setRefClass(e.target.value)} className={selectCls}>
                  <option value="">학급 선택</option>
                  {opts?.homerooms.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </>
            )}
            {scope === "club" && (
              <>
                <label className={lbl}>동아리</label>
                <select value={refId} onChange={(e) => setRefId(e.target.value)} className={selectCls}>
                  <option value="">동아리 선택</option>
                  {opts?.clubs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </>
            )}
            {scope === "group" && (
              <>
                <label className={lbl}>그룹</label>
                <select value={refId} onChange={(e) => setRefId(e.target.value)} className={selectCls}>
                  <option value="">그룹 선택</option>
                  {opts?.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </>
            )}
            {scope === "research" && (
              <div className="text-caption text-text-tertiary mb-4 p-2 bg-bg-secondary rounded">
                본인이 담당(supervisor)인 연구 학생 {opts?.research_count ?? 0}명이 자동 추가됩니다.
              </div>
            )}
            {scope === "manual" && (
              <div className="text-caption text-text-tertiary mb-4 p-2 bg-bg-secondary rounded">
                빈 프로젝트로 생성됩니다. 학생은 상세 화면에서 직접 추가합니다.
              </div>
            )}

            {typeId !== "custom" && (
              <div className="text-[11px] text-text-tertiary mb-4 -mt-1">
                선택한 종류에 맞는 기본 항목(시스템 프롬프트·글자수 포함)이 자동으로 생성됩니다.
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 text-body text-text-secondary">
                취소
              </button>
              <button
                onClick={submit}
                disabled={creating}
                className="px-4 py-2 bg-accent text-white rounded text-body disabled:opacity-50 inline-flex items-center gap-2"
              >
                {creating ? <Loader2 size={16} className="animate-spin" /> : null} 생성
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
