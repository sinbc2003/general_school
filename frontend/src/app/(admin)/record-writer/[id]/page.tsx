"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  Plus,
  Settings2,
  Trash2,
  X,
  Download,
  Sparkles,
  SpellCheck,
  GitCompare,
  Eye,
  EyeOff,
  Maximize2,
  FileDown,
} from "lucide-react";
import { api } from "@/lib/api/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/** 글자수·바이트수 배지 (NEIS 기준 UTF-8 바이트) */
function CountBadge({ text, charMax }: { text: string; charMax?: number | null }) {
  const cc = text.length;
  const bc = new TextEncoder().encode(text).length;
  const over = charMax != null && cc > charMax;
  return (
    <span
      className={`text-[9px] px-1 rounded ${over ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"}`}
      title={`${cc}자 / ${bc}바이트${charMax ? ` (한도 ${charMax}자)` : ""}`}
    >
      {cc}자·{bc}B
    </span>
  );
}

interface StudentRow {
  id: number;
  student_id: number;
  name: string;
  display_order: number;
  is_published: boolean;
  final_text: string | null;
}
interface Column {
  id: number;
  name: string;
  display_order: number;
  system_prompt: string | null;
  source_config: any;
  char_min: number | null;
  char_max: number | null;
  kind: string;
}
interface Cell {
  id: number;
  column_id: number;
  student_id: number;
  raw_data: string | null;
  raw_sources: any;
  generated_text: string | null;
  status: string;
  similarity_flag: number | null;
}
interface FullData {
  id: number;
  name: string;
  students: StudentRow[];
  columns: Column[];
  cells: Record<string, Cell>;
}
interface ModelOpt {
  provider: string;
  model_id: string;
  label: string;
}

const INP = "w-full px-3 py-2 border border-border-default rounded text-body bg-bg-primary";
const LBL = "block text-caption text-text-secondary mb-1";

const SOURCE_LABELS: Record<string, string> = {
  survey: "설문",
  assignment: "과제",
  artifact: "산출물",
  career: "진로",
  club: "동아리",
  group: "그룹",
  classroom: "클래스룸 활동",
  classroom_submission: "클래스룸 과제",
  coursework: "문제세트",
};

export default function RecordProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const pid = params.id as string;
  const [data, setData] = useState<FullData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [collectingCol, setCollectingCol] = useState<number | null>(null);
  const [generatingCol, setGeneratingCol] = useState<number | null>(null);
  const [checkingSim, setCheckingSim] = useState(false);
  const [cellEdit, setCellEdit] = useState<{ col: Column; stu: StudentRow } | null>(null);
  const [colEdit, setColEdit] = useState<Column | "new" | null>(null);
  const [models, setModels] = useState<ModelOpt[]>([]);
  const [model, setModel] = useState<{ provider: string; model_id: string } | null>(null);
  const [tab, setTab] = useState<"write" | "neis">("write");
  // 인라인 셀 편집 (스프레드시트식) — key: "col:sid" 또는 "final:sid"
  const [inline, setInline] = useState<{ key: string; value: string } | null>(null);
  const [composing, setComposing] = useState(false);
  const [exporting, setExporting] = useState(false);

  // 인라인 저장 — 일반 셀은 generated_text(있으면) 아니면 raw_data, final은 final_text
  const saveInline = async () => {
    if (!inline || !data) return;
    const { key, value } = inline;
    setInline(null);
    try {
      if (key.startsWith("final:")) {
        const sid = Number(key.slice(6));
        await api.put(`/api/record-writer/projects/${pid}/students/${sid}/final-text`, {
          final_text: value,
        });
      } else {
        const [colId, sid] = key.split(":").map(Number);
        const cell = data.cells[`${colId}:${sid}`];
        const body: any = { project_id: Number(pid), column_id: colId, student_id: sid };
        if (cell?.generated_text != null && cell.generated_text !== "") {
          body.generated_text = value;
        } else {
          body.raw_data = value;
        }
        await api.put(`/api/record-writer/cells`, body);
      }
      await load();
    } catch (e: any) {
      alert(`저장 실패: ${e?.detail || e}`);
    }
  };

  const composeFinal = async () => {
    if (!model) {
      alert("상단에서 AI 모델을 선택하세요.");
      return;
    }
    const minS = window.prompt("최종 종합 최소 글자 수 (비우면 제한 없음)", "");
    if (minS === null) return;
    const maxS = window.prompt("최종 종합 최대 글자 수 (비우면 제한 없음)", "500");
    if (maxS === null) return;
    if (!confirm("모든 학생의 항목 생성문을 통합해 '최종 종합'을 일괄 생성합니다. 기존 최종 종합은 덮어씁니다."))
      return;
    setComposing(true);
    try {
      const r = await api.post(`/api/record-writer/projects/${pid}/compose-final`, {
        provider: model.provider,
        model_id: model.model_id,
        char_min: minS.trim() ? Number(minS) : null,
        char_max: maxS.trim() ? Number(maxS) : null,
      });
      await load();
      let msg = `최종 종합 ${r.generated}명 생성 (총 ${r.total}명, $${r.cost_usd})`;
      if (r.errors?.length) msg += `\n실패 ${r.errors.length}건`;
      alert(msg);
    } catch (e: any) {
      alert(`생성 실패: ${e?.detail || e}`);
    } finally {
      setComposing(false);
    }
  };

  const exportXlsx = async () => {
    setExporting(true);
    try {
      await api.ensureFreshToken().catch(() => false);
      const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
      const res = await fetch(`${API_URL}/api/record-writer/projects/${pid}/export.xlsx`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `생기부_${data?.name || pid}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(`내보내기 실패: ${e?.message || e}`);
    } finally {
      setExporting(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get(`/api/record-writer/projects/${pid}/full`);
      setData(d);
    } catch (e) {
      console.error(e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get(`/api/record-writer/models`)
      .then((d) => {
        setModels(d.models || []);
        if (d.default_provider && d.default_model) {
          setModel({ provider: d.default_provider, model_id: d.default_model });
        } else if (d.models?.length) {
          setModel({ provider: d.models[0].provider, model_id: d.models[0].model_id });
        }
      })
      .catch(() => {});
  }, []);

  const refresh = async () => {
    setSyncing(true);
    try {
      const r = await api.post(`/api/record-writer/projects/${pid}/refresh-students`, {});
      await load();
      alert(`${r.added}명 추가됨 (총 ${r.total}명)`);
    } catch (e: any) {
      alert(`동기화 실패: ${e?.detail || e}`);
    } finally {
      setSyncing(false);
    }
  };

  const collectColumn = async (c: Column) => {
    setCollectingCol(c.id);
    try {
      const r = await api.post(`/api/record-writer/projects/${pid}/columns/${c.id}/collect`, {});
      await load();
      alert(`${r.collected}명 자동 수집됨 (총 ${r.total}명)`);
    } catch (e: any) {
      alert(`수집 실패: ${e?.detail || e}`);
    } finally {
      setCollectingCol(null);
    }
  };

  const generateColumn = async (c: Column) => {
    if (!model) {
      alert("상단에서 AI 모델을 선택하세요. (관리자가 챗봇 API 키를 등록해야 합니다)");
      return;
    }
    if (!confirm(`'${c.name}' 열을 AI로 일괄 생성합니다. 기존 생성 결과는 덮어쓰여집니다. 계속할까요?`))
      return;
    setGeneratingCol(c.id);
    try {
      const r = await api.post(`/api/record-writer/projects/${pid}/columns/${c.id}/generate`, {
        provider: model.provider,
        model_id: model.model_id,
      });
      await load();
      let msg = `${r.generated}명 생성 완료 (총 ${r.total}명, $${r.cost_usd})`;
      if (r.errors?.length) msg += `\n실패 ${r.errors.length}건: ${r.errors[0]?.error ?? ""}`;
      alert(msg);
    } catch (e: any) {
      alert(`생성 실패: ${e?.detail || e}`);
    } finally {
      setGeneratingCol(null);
    }
  };

  const checkSimilarity = async () => {
    setCheckingSim(true);
    try {
      const r = await api.post(`/api/record-writer/projects/${pid}/similarity`, {});
      await load();
      alert(`유사도 검사 완료 — ${r.flagged}개 셀이 유사(60%+)로 표시됨`);
    } catch (e: any) {
      alert(`유사도 검사 실패: ${e?.detail || e}`);
    } finally {
      setCheckingSim(false);
    }
  };

  const togglePublish = async (s: StudentRow) => {
    try {
      await api.post(`/api/record-writer/projects/${pid}/students/${s.student_id}/publish`, {
        published: !s.is_published,
      });
      await load();
    } catch (e: any) {
      alert(`공개 설정 변경 실패: ${e?.detail || e}`);
    }
  };

  const deleteColumn = async (c: Column) => {
    if (!confirm(`'${c.name}' 항목을 삭제하시겠습니까? (해당 열의 셀 모두 삭제)`)) return;
    try {
      await api.delete(`/api/record-writer/columns/${c.id}`);
      await load();
    } catch (e: any) {
      alert(`삭제 실패: ${e?.detail || e}`);
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center">
        <Loader2 size={20} className="animate-spin mx-auto text-text-tertiary" />
      </div>
    );
  }
  if (!data) {
    return <div className="p-12 text-center text-text-tertiary">프로젝트를 불러올 수 없습니다.</div>;
  }

  const cellOf = (col: Column, stu: StudentRow) => data.cells[`${col.id}:${stu.student_id}`];

  return (
    <div>
      <button
        onClick={() => router.push("/record-writer")}
        className="text-caption text-text-tertiary inline-flex items-center gap-1 mb-3 hover:text-text-primary"
      >
        <ArrowLeft size={14} /> 목록
      </button>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-title text-text-primary">{data.name}</h1>
        <div className="flex gap-2 flex-wrap items-center">
          <select
            value={model ? `${model.provider}:${model.model_id}` : ""}
            onChange={(e) => {
              const v = e.target.value;
              const idx = v.indexOf(":");
              if (idx > 0) setModel({ provider: v.slice(0, idx), model_id: v.slice(idx + 1) });
            }}
            className="px-2 py-1.5 border border-border-default rounded text-caption bg-bg-primary max-w-[180px]"
            title="AI 모델"
          >
            {models.length === 0 && <option value="">모델 없음</option>}
            {models.map((m) => (
              <option key={`${m.provider}:${m.model_id}`} value={`${m.provider}:${m.model_id}`}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            onClick={refresh}
            disabled={syncing}
            className="px-3 py-1.5 border border-border-default rounded text-caption inline-flex items-center gap-1 disabled:opacity-50"
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 학생 동기화
          </button>
          <button
            onClick={checkSimilarity}
            disabled={checkingSim}
            title="학생 간 유사도(표절·복붙) 검사"
            className="px-3 py-1.5 border border-border-default rounded text-caption inline-flex items-center gap-1 disabled:opacity-50"
          >
            {checkingSim ? <Loader2 size={14} className="animate-spin" /> : <GitCompare size={14} />} 유사도 검사
          </button>
          <button
            onClick={composeFinal}
            disabled={composing}
            title="모든 항목 생성문을 학생별 하나의 최종 종합으로 통합 생성"
            className="px-3 py-1.5 border border-purple-300 text-purple-700 rounded text-caption inline-flex items-center gap-1 disabled:opacity-50"
          >
            {composing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} 최종 종합
          </button>
          <button
            onClick={exportXlsx}
            disabled={exporting}
            title="엑셀(.xlsx) 내보내기 — NEIS 붙여넣기용"
            className="px-3 py-1.5 border border-border-default rounded text-caption inline-flex items-center gap-1 disabled:opacity-50"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} 엑셀
          </button>
          <button
            onClick={() => setColEdit("new")}
            className="px-3 py-1.5 bg-accent text-white rounded text-caption inline-flex items-center gap-1"
          >
            <Plus size={14} /> 항목 추가
          </button>
        </div>
      </div>

      {/* 탭 — 작성 / NEIS 검증 */}
      <div className="flex items-center gap-1 border-b border-border-default mb-4">
        {([["write", "작성"], ["neis", "NEIS 검증"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-caption border-b-2 -mb-px transition ${
              tab === k
                ? "border-accent text-accent font-medium"
                : "border-transparent text-text-secondary hover:text-text-primary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "neis" ? (
        <NeisPanel pid={pid} />
      ) : data.students.length === 0 ? (
        <div className="p-8 text-center text-text-tertiary text-caption border border-dashed border-border-default rounded-lg">
          대상 학생이 없습니다. &quot;학생 동기화&quot;를 눌러보세요.
        </div>
      ) : (
        <div className="overflow-x-auto border border-border-default rounded-lg">
          <table className="border-collapse">
            <thead>
              <tr className="bg-bg-secondary">
                <th className="sticky left-0 z-10 bg-bg-secondary border-b border-r border-border-default px-3 py-2 text-left text-caption text-text-tertiary min-w-[110px]">
                  학생
                </th>
                {data.columns.map((c) => {
                  const srcType = c.source_config?.type;
                  const hasSource = srcType && srcType !== "none";
                  return (
                    <th
                      key={c.id}
                      className="border-b border-r border-border-default px-3 py-2 text-left min-w-[210px] max-w-[300px]"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-body text-text-primary truncate">
                          {c.name}
                          {c.kind === "summary" && (
                            <span className="ml-1 text-[10px] text-amber-700">(종합)</span>
                          )}
                        </span>
                        <span className="flex items-center gap-0.5 flex-shrink-0">
                          {hasSource && (
                            <button
                              onClick={() => collectColumn(c)}
                              disabled={collectingCol === c.id}
                              title={`자동 수집 (${SOURCE_LABELS[srcType] || srcType})`}
                              className="p-1 hover:bg-bg-primary rounded text-accent disabled:opacity-50"
                            >
                              {collectingCol === c.id ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <Download size={13} />
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => generateColumn(c)}
                            disabled={generatingCol === c.id}
                            title="AI 일괄 생성"
                            className="p-1 hover:bg-bg-primary rounded text-purple-600 disabled:opacity-50"
                          >
                            {generatingCol === c.id ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Sparkles size={13} />
                            )}
                          </button>
                          <button
                            onClick={() => setColEdit(c)}
                            title="항목 설정"
                            className="p-1 hover:bg-bg-primary rounded text-text-tertiary"
                          >
                            <Settings2 size={13} />
                          </button>
                          <button
                            onClick={() => deleteColumn(c)}
                            title="항목 삭제"
                            className="p-1 hover:bg-red-50 rounded text-red-600"
                          >
                            <Trash2 size={13} />
                          </button>
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {hasSource && (
                          <span className="text-[10px] px-1 bg-cream-100 text-amber-700 rounded">
                            {SOURCE_LABELS[srcType] || srcType}
                          </span>
                        )}
                        {(c.char_min || c.char_max) && (
                          <span className="text-[10px] text-text-tertiary">
                            {c.char_min || 0}~{c.char_max || "?"}자
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}
                {data.columns.length === 0 && (
                  <th className="border-b border-r border-border-default px-4 py-2 text-caption text-text-tertiary font-normal">
                    &quot;항목 추가&quot;로 첫 열을 만드세요
                  </th>
                )}
                <th className="border-b border-border-default px-3 py-2 text-left min-w-[230px] bg-purple-50/40">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-body text-purple-900">최종 종합</span>
                    <button
                      onClick={composeFinal}
                      disabled={composing}
                      title="모든 항목을 학생별 하나의 서술로 통합 생성"
                      className="p-1 hover:bg-bg-primary rounded text-purple-600 disabled:opacity-50"
                    >
                      {composing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    </button>
                  </div>
                  <div className="text-[10px] text-purple-700/70 mt-0.5 font-normal">행 단위 통합 (행특·종합)</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => (
                <tr key={s.id} className="hover:bg-bg-secondary/40">
                  <td className="sticky left-0 z-10 bg-bg-primary border-b border-r border-border-default px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-body text-text-primary">{s.name}</span>
                      <button
                        onClick={() => togglePublish(s)}
                        title={s.is_published ? "공개됨 — 학생이 열람 가능" : "비공개 (클릭해 공개)"}
                        className="p-0.5 flex-shrink-0"
                      >
                        {s.is_published ? (
                          <Eye size={13} className="text-green-600" />
                        ) : (
                          <EyeOff size={13} className="text-text-tertiary" />
                        )}
                      </button>
                    </div>
                  </td>
                  {data.columns.map((c) => {
                    const cell = cellOf(c, s);
                    const text = cell?.generated_text || cell?.raw_data || "";
                    const isGen = !!cell?.generated_text;
                    const ikey = `${c.id}:${s.student_id}`;
                    const editing = inline?.key === ikey;
                    return (
                      <td
                        key={c.id}
                        onClick={() => {
                          if (!editing) setInline({ key: ikey, value: text });
                        }}
                        className={`border-b border-r border-border-default px-2 py-1.5 align-top ${
                          editing ? "bg-cream-100/70" : "cursor-text hover:bg-cream-100/50"
                        }`}
                      >
                        {editing ? (
                          <div>
                            <textarea
                              autoFocus
                              value={inline.value}
                              onChange={(e) => setInline({ key: ikey, value: e.target.value })}
                              onBlur={saveInline}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setInline(null);
                                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveInline();
                              }}
                              rows={5}
                              className="w-full text-caption border border-accent rounded p-1.5 bg-bg-primary resize-y outline-none"
                            />
                            <div className="flex items-center justify-between mt-0.5">
                              <CountBadge text={inline.value} charMax={c.char_max} />
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setInline(null);
                                  setCellEdit({ col: c, stu: s });
                                }}
                                title="전체 편집 (원자료·AI·맞춤법)"
                                className="text-text-tertiary hover:text-accent p-0.5"
                              >
                                <Maximize2 size={12} />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div
                              className={`text-caption line-clamp-3 ${isGen ? "text-text-primary" : "text-text-tertiary"}`}
                            >
                              {text || <span className="text-text-tertiary/50">비어 있음</span>}
                            </div>
                            {cell && (
                              <div className="flex items-center gap-1 mt-1 flex-wrap">
                                {cell.generated_text && (
                                  <span className="text-[9px] px-1 bg-green-100 text-green-700 rounded">생성</span>
                                )}
                                {!cell.generated_text && cell.raw_data && (
                                  <span className="text-[9px] px-1 bg-yellow-100 text-yellow-700 rounded">원자료</span>
                                )}
                                {isGen && <CountBadge text={text} charMax={c.char_max} />}
                                {cell.similarity_flag != null && cell.similarity_flag >= 0.6 && (
                                  <span className="text-[9px] px-1 bg-red-100 text-red-700 rounded">
                                    유사 {Math.round(cell.similarity_flag * 100)}%
                                  </span>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}
                  {/* 최종 종합 (행 단위 final_text) */}
                  {(() => {
                    const fkey = `final:${s.student_id}`;
                    const editing = inline?.key === fkey;
                    const ftext = s.final_text || "";
                    return (
                      <td
                        onClick={() => {
                          if (!editing) setInline({ key: fkey, value: ftext });
                        }}
                        className={`border-b border-border-default px-2 py-1.5 align-top min-w-[230px] ${
                          editing ? "bg-purple-50" : "cursor-text hover:bg-purple-50/50 bg-purple-50/20"
                        }`}
                      >
                        {editing ? (
                          <div>
                            <textarea
                              autoFocus
                              value={inline.value}
                              onChange={(e) => setInline({ key: fkey, value: e.target.value })}
                              onBlur={saveInline}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setInline(null);
                                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveInline();
                              }}
                              rows={5}
                              className="w-full text-caption border border-purple-400 rounded p-1.5 bg-bg-primary resize-y outline-none"
                            />
                            <CountBadge text={inline.value} />
                          </div>
                        ) : ftext ? (
                          <>
                            <div className="text-caption text-text-primary line-clamp-3">{ftext}</div>
                            <div className="mt-1"><CountBadge text={ftext} /></div>
                          </>
                        ) : (
                          <span className="text-caption text-text-tertiary/50">비어 있음</span>
                        )}
                      </td>
                    );
                  })()}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "write" && (
        <p className="text-caption text-text-tertiary mt-3">
          <Download size={11} className="inline" /> 자동 수집 → <Sparkles size={11} className="inline" /> AI 일괄 생성 →
          셀 클릭으로 개별 편집·맞춤법. 종합 항목은 다른 열의 생성 결과를 합쳐 작성합니다. 셀에 글자수·바이트수 표시.
        </p>
      )}

      {colEdit && (
        <ColumnModal
          pid={pid}
          column={colEdit === "new" ? null : colEdit}
          onClose={() => setColEdit(null)}
          onSaved={() => {
            setColEdit(null);
            load();
          }}
        />
      )}
      {cellEdit && (
        <CellModal
          pid={Number(pid)}
          col={cellEdit.col}
          stu={cellEdit.stu}
          cell={cellOf(cellEdit.col, cellEdit.stu)}
          model={model}
          onClose={() => setCellEdit(null)}
          onSaved={() => {
            setCellEdit(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function NeisPanel({ pid }: { pid: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get(`/api/record-writer/projects/${pid}/neis-check`);
      setData(d);
      setRan(true);
    } catch (e: any) {
      alert(`검증 실패: ${e?.detail || e}`);
    } finally {
      setLoading(false);
    }
  }, [pid]);

  const SEV: Record<string, { label: string; cls: string }> = {
    high: { label: "금지 가능성 높음", cls: "bg-red-100 text-red-700" },
    review: { label: "검토 필요", cls: "bg-amber-100 text-amber-700" },
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-caption text-text-tertiary">
          생성된 생기부 문장에서 NEIS 기재 금지 가능 항목(어학시험·대학명·교외수상·부모정보 등)과
          글자수 초과를 일괄 점검합니다. 휴리스틱이므로 최종 판단은 교사가 합니다.
        </p>
        <button
          onClick={run}
          disabled={loading}
          className="px-3 py-1.5 bg-accent text-white rounded text-caption inline-flex items-center gap-1 disabled:opacity-50 flex-shrink-0"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <GitCompare size={14} />}
          {ran ? "다시 검사" : "NEIS 검사 실행"}
        </button>
      </div>

      {!ran ? (
        <div className="p-10 text-center text-text-tertiary text-caption border border-dashed border-border-default rounded-lg">
          &quot;NEIS 검사 실행&quot;을 눌러 점검하세요.
        </div>
      ) : (
        <>
          <div className="flex gap-2 mb-3 flex-wrap text-caption">
            <span className="px-2.5 py-1 bg-bg-secondary rounded">검사 셀 {data.summary.total_cells}</span>
            <span className="px-2.5 py-1 bg-red-50 text-red-700 rounded">위반 셀 {data.summary.flagged_cells}</span>
            <span className="px-2.5 py-1 bg-red-50 text-red-700 rounded">금지높음 {data.summary.high}</span>
            <span className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded">검토 {data.summary.review}</span>
            <span className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded">글자초과 {data.summary.over_char}</span>
          </div>
          {data.items.length === 0 ? (
            <div className="p-8 text-center text-green-700 text-caption border border-green-200 bg-green-50 rounded-lg">
              ✓ 발견된 NEIS 금지 항목·글자수 초과가 없습니다.
            </div>
          ) : (
            <div className="space-y-2">
              {data.items.map((it: any, i: number) => (
                <div key={i} className="border border-border-default rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                    <div className="text-body text-text-primary">
                      <span className="font-medium">{it.student_name}</span>
                      <span className="text-text-tertiary mx-1.5">·</span>
                      <span className="text-text-secondary">{it.column_name}</span>
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${
                        it.over_char ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {it.char_count}자 / {it.byte_count}B
                      {it.char_max ? ` (한도 ${it.char_max}자)` : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-1">
                    {it.over_char && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded">글자수 초과</span>
                    )}
                    {it.findings.map((f: any, j: number) => (
                      <span
                        key={j}
                        className={`text-[10px] px-1.5 py-0.5 rounded ${SEV[f.severity]?.cls || "bg-gray-100"}`}
                        title={`${SEV[f.severity]?.label}: ${f.terms.join(", ")}`}
                      >
                        {f.label}: {f.terms.join(", ")}
                      </span>
                    ))}
                  </div>
                  <p className="text-caption text-text-tertiary line-clamp-2">{it.excerpt}…</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`bg-bg-primary rounded-lg w-full ${wide ? "max-w-2xl" : "max-w-md"} p-5 max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-body font-semibold text-text-primary">{title}</h2>
          <button onClick={onClose}>
            <X size={18} className="text-text-tertiary hover:text-text-primary" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ColumnModal({
  pid,
  column,
  onClose,
  onSaved,
}: {
  pid: string;
  column: Column | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(column?.name ?? "새 항목");
  const [kind, setKind] = useState(column?.kind ?? "normal");
  const [charMin, setCharMin] = useState(column?.char_min?.toString() ?? "");
  const [charMax, setCharMax] = useState(column?.char_max?.toString() ?? "");
  const [prompt, setPrompt] = useState(column?.system_prompt ?? "");
  const [srcType, setSrcType] = useState<string>(column?.source_config?.type ?? "none");
  const [srcId, setSrcId] = useState<string>(
    column?.source_config?.survey_id?.toString() ??
      column?.source_config?.assignment_id?.toString() ??
      column?.source_config?.post_id?.toString() ??
      column?.source_config?.set_id?.toString() ??
      ""
  );
  const [cands, setCands] = useState<{
    surveys: any[]; assignments: any[];
    classroom_posts?: any[]; coursework_sets?: any[]; classroom_course_id?: number | null;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get(`/api/record-writer/projects/${pid}/source-candidates`)
      .then(setCands)
      .catch(() => setCands(null));
  }, [pid]);

  const save = async () => {
    let source_config: any = {};
    if (srcType === "survey") {
      if (!srcId) {
        alert("설문을 선택하세요");
        return;
      }
      source_config = { type: "survey", survey_id: Number(srcId) };
    } else if (srcType === "assignment") {
      if (!srcId) {
        alert("과제를 선택하세요");
        return;
      }
      source_config = { type: "assignment", assignment_id: Number(srcId) };
    } else if (srcType === "classroom_submission") {
      if (!srcId) {
        alert("클래스룸 과제를 선택하세요");
        return;
      }
      source_config = { type: "classroom_submission", post_id: Number(srcId) };
    } else if (srcType === "coursework") {
      if (!srcId) {
        alert("문제세트를 선택하세요");
        return;
      }
      source_config = { type: "coursework", set_id: Number(srcId) };
    } else if (["artifact", "career", "club", "group", "classroom"].includes(srcType)) {
      source_config = { type: srcType };
    }
    setSaving(true);
    const body: any = {
      name: name.trim() || "새 항목",
      kind,
      system_prompt: prompt || null,
      char_min: charMin ? Number(charMin) : null,
      char_max: charMax ? Number(charMax) : null,
      source_config,
    };
    try {
      if (column) await api.put(`/api/record-writer/columns/${column.id}`, body);
      else await api.post(`/api/record-writer/projects/${pid}/columns`, body);
      onSaved();
    } catch (e: any) {
      alert(`저장 실패: ${e?.detail || e}`);
      setSaving(false);
    }
  };

  return (
    <Modal title={column ? "항목 설정" : "새 항목"} onClose={onClose} wide>
      <label className={LBL}>항목 이름</label>
      <input value={name} onChange={(e) => setName(e.target.value)} className={`${INP} mb-3`} />

      <div className="flex gap-3 mb-3">
        <div className="flex-1">
          <label className={LBL}>종류</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={INP}>
            <option value="normal">일반 항목</option>
            <option value="summary">종합 (다른 열을 합쳐 작성)</option>
          </select>
        </div>
        <div className="w-24">
          <label className={LBL}>최소 글자</label>
          <input value={charMin} onChange={(e) => setCharMin(e.target.value)} className={INP} placeholder="-" />
        </div>
        <div className="w-24">
          <label className={LBL}>최대 글자</label>
          <input value={charMax} onChange={(e) => setCharMax(e.target.value)} className={INP} placeholder="-" />
        </div>
      </div>

      <label className={LBL}>데이터 소스 (학생 제출물 자동 수집)</label>
      <select
        value={srcType}
        onChange={(e) => {
          setSrcType(e.target.value);
          setSrcId("");
        }}
        className={`${INP} mb-2`}
      >
        <option value="none">없음 (수동 입력)</option>
        <optgroup label="클래스룸">
          <option value="classroom">클래스룸 활동 전체 (이 강좌)</option>
          <option value="classroom_submission">클래스룸 과제 제출</option>
          <option value="coursework">문제세트 점수</option>
        </optgroup>
        <optgroup label="설문·제출">
          <option value="survey">설문 응답</option>
          <option value="assignment">과제 제출 (학교 단위)</option>
        </optgroup>
        <optgroup label="학생별 누적">
          <option value="artifact">학생 산출물</option>
          <option value="career">진로 설계</option>
          <option value="club">동아리 활동</option>
          <option value="group">그룹 활동</option>
        </optgroup>
      </select>
      {srcType === "survey" && (
        <select value={srcId} onChange={(e) => setSrcId(e.target.value)} className={`${INP} mb-3`}>
          <option value="">설문 선택</option>
          {cands?.surveys.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      )}
      {srcType === "assignment" && (
        <select value={srcId} onChange={(e) => setSrcId(e.target.value)} className={`${INP} mb-3`}>
          <option value="">과제 선택</option>
          {cands?.assignments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      )}
      {srcType === "classroom_submission" && (
        <select value={srcId} onChange={(e) => setSrcId(e.target.value)} className={`${INP} mb-3`}>
          <option value="">클래스룸 과제 선택</option>
          {(cands?.classroom_posts || []).map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
      )}
      {srcType === "coursework" && (
        <select value={srcId} onChange={(e) => setSrcId(e.target.value)} className={`${INP} mb-3`}>
          <option value="">문제세트 선택</option>
          {(cands?.coursework_sets || []).map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
      )}
      {(srcType === "classroom_submission" || srcType === "coursework") &&
        !cands?.classroom_course_id && (
          <div className="text-[11px] text-amber-600 mb-3 -mt-1">
            이 생기부의 범위가 강좌가 아니라 후보가 없습니다. 강좌 범위 프로젝트에서 사용하세요.
          </div>
        )}
      {srcType === "classroom" && (
        <div className="text-[11px] text-text-tertiary mb-3 -mt-1">
          이 강좌의 모든 과제 제출물(첨부 문서 본문·점수·피드백)과 문제세트 점수를 한 번에 모읍니다.
        </div>
      )}
      {["artifact", "career", "club", "group"].includes(srcType) && (
        <div className="text-[11px] text-text-tertiary mb-3 -mt-1">
          담당 학생 각자의 {SOURCE_LABELS[srcType]} 데이터를 자동으로 모읍니다.
        </div>
      )}

      <label className={LBL}>시스템 프롬프트 (AI 작성 지시)</label>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={5}
        className={`${INP} font-mono text-caption`}
        placeholder="예: 학생의 활동 자료를 바탕으로 교과 세부능력 및 특기사항을 객관적·구체적으로 작성하라. 과장·추측 금지, 사실 기반으로."
      />

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-4 py-2 text-body text-text-secondary">
          취소
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-accent text-white rounded text-body disabled:opacity-50 inline-flex items-center gap-2"
        >
          {saving && <Loader2 size={16} className="animate-spin" />} 저장
        </button>
      </div>
    </Modal>
  );
}

function CellModal({
  pid,
  col,
  stu,
  cell,
  model,
  onClose,
  onSaved,
}: {
  pid: number;
  col: Column;
  stu: StudentRow;
  cell: Cell | undefined;
  model: { provider: string; model_id: string } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [raw, setRaw] = useState(cell?.raw_data ?? "");
  const [gen, setGen] = useState(cell?.generated_text ?? "");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [spelling, setSpelling] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/record-writer/cells`, {
        project_id: pid,
        column_id: col.id,
        student_id: stu.student_id,
        raw_data: raw,
        generated_text: gen,
      });
      onSaved();
    } catch (e: any) {
      alert(`저장 실패: ${e?.detail || e}`);
      setSaving(false);
    }
  };

  // 이 셀만 AI 생성 (저장 후 닫고 reload)
  const generateOne = async () => {
    if (!model) {
      alert("상단에서 AI 모델을 선택하세요.");
      return;
    }
    // 편집 중 raw를 먼저 저장해야 생성에 반영됨
    setGenerating(true);
    try {
      await api.put(`/api/record-writer/cells`, {
        project_id: pid,
        column_id: col.id,
        student_id: stu.student_id,
        raw_data: raw,
      });
      await api.post(`/api/record-writer/projects/${pid}/columns/${col.id}/generate`, {
        provider: model.provider,
        model_id: model.model_id,
        only_student_ids: [stu.student_id],
      });
      onSaved();
    } catch (e: any) {
      alert(`생성 실패: ${e?.detail || e}`);
      setGenerating(false);
    }
  };

  const spellcheck = async () => {
    if (!gen.trim()) return;
    setSpelling(true);
    try {
      const r = await api.post(`/api/record-writer/spellcheck`, {
        text: gen,
        provider: model?.provider,
        model_id: model?.model_id,
      });
      if (r.corrected) setGen(r.corrected);
    } catch (e: any) {
      alert(`맞춤법 교정 실패: ${e?.detail || e}`);
    } finally {
      setSpelling(false);
    }
  };

  return (
    <Modal title={`${stu.name} · ${col.name}`} onClose={onClose} wide>
      <label className={LBL}>원자료 (학생 제출물 — 항목 소스로 자동 수집됨)</label>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={6}
        className={`${INP} text-caption mb-1`}
        placeholder="학생의 과제·설문·활동 내용 등"
      />
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-text-tertiary">{raw.length}자</span>
        <button
          onClick={generateOne}
          disabled={generating}
          className="text-caption text-purple-600 inline-flex items-center gap-1 disabled:opacity-50"
        >
          {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} 이 셀 AI 생성
        </button>
      </div>

      <label className={LBL}>생성 결과</label>
      <textarea
        value={gen}
        onChange={(e) => setGen(e.target.value)}
        rows={5}
        className={`${INP} text-caption mb-1`}
        placeholder="생활기록부 문장 (AI 생성 또는 직접 입력)"
      />
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] text-text-tertiary">
          {gen.length}자
          {col.char_max ? ` / 최대 ${col.char_max}자` : ""}
          {col.char_max && gen.length > col.char_max ? (
            <span className="text-red-600 ml-1">초과</span>
          ) : null}
        </span>
        <button
          onClick={spellcheck}
          disabled={spelling || !gen.trim()}
          className="text-caption text-accent inline-flex items-center gap-1 disabled:opacity-50"
        >
          {spelling ? <Loader2 size={13} className="animate-spin" /> : <SpellCheck size={13} />} 맞춤법 교정
        </button>
      </div>

      <div className="flex justify-end gap-2 mt-2">
        <button onClick={onClose} className="px-4 py-2 text-body text-text-secondary">
          취소
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-accent text-white rounded text-body disabled:opacity-50 inline-flex items-center gap-2"
        >
          {saving && <Loader2 size={16} className="animate-spin" />} 저장
        </button>
      </div>
    </Modal>
  );
}
