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
} from "lucide-react";
import { api } from "@/lib/api/client";

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

const INP = "w-full px-3 py-2 border border-border-default rounded text-body bg-bg-primary";
const LBL = "block text-caption text-text-secondary mb-1";

export default function RecordProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const pid = params.id as string;
  const [data, setData] = useState<FullData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [cellEdit, setCellEdit] = useState<{ col: Column; stu: StudentRow } | null>(null);
  const [colEdit, setColEdit] = useState<Column | "new" | null>(null);

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
        <div className="flex gap-2">
          <button
            onClick={refresh}
            disabled={syncing}
            className="px-3 py-1.5 border border-border-default rounded text-caption inline-flex items-center gap-1 disabled:opacity-50"
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 학생 동기화
          </button>
          <button
            onClick={() => setColEdit("new")}
            className="px-3 py-1.5 bg-accent text-white rounded text-caption inline-flex items-center gap-1"
          >
            <Plus size={14} /> 항목 추가
          </button>
        </div>
      </div>

      {data.students.length === 0 ? (
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
                {data.columns.map((c) => (
                  <th
                    key={c.id}
                    className="border-b border-r border-border-default px-3 py-2 text-left min-w-[200px] max-w-[280px]"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-body text-text-primary truncate">
                        {c.name}
                        {c.kind === "summary" && (
                          <span className="ml-1 text-[10px] text-amber-700">(종합)</span>
                        )}
                      </span>
                      <span className="flex items-center gap-0.5 flex-shrink-0">
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
                    {(c.char_min || c.char_max) && (
                      <div className="text-[10px] text-text-tertiary mt-0.5">
                        {c.char_min || 0}~{c.char_max || "?"}자
                      </div>
                    )}
                  </th>
                ))}
                {data.columns.length === 0 && (
                  <th className="border-b border-border-default px-4 py-2 text-caption text-text-tertiary font-normal">
                    &quot;항목 추가&quot;로 첫 열을 만드세요
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {data.students.map((s) => (
                <tr key={s.id} className="hover:bg-bg-secondary/40">
                  <td className="sticky left-0 z-10 bg-bg-primary border-b border-r border-border-default px-3 py-2 text-body text-text-primary whitespace-nowrap">
                    {s.name}
                  </td>
                  {data.columns.map((c) => {
                    const cell = cellOf(c, s);
                    const text = cell?.generated_text || cell?.raw_data || "";
                    const isGen = !!cell?.generated_text;
                    return (
                      <td
                        key={c.id}
                        onClick={() => setCellEdit({ col: c, stu: s })}
                        className="border-b border-r border-border-default px-2 py-1.5 align-top cursor-pointer hover:bg-cream-100/50"
                      >
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
                            {cell.similarity_flag != null && cell.similarity_flag >= 0.6 && (
                              <span className="text-[9px] px-1 bg-red-100 text-red-700 rounded">
                                유사 {Math.round(cell.similarity_flag * 100)}%
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-caption text-text-tertiary mt-3">
        셀을 클릭해 내용을 편집합니다. 자동 수집 · AI 작성 · 맞춤법 · 유사도는 다음 단계에서 제공됩니다.
      </p>

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
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const body: any = {
      name: name.trim() || "새 항목",
      kind,
      system_prompt: prompt || null,
      char_min: charMin ? Number(charMin) : null,
      char_max: charMax ? Number(charMax) : null,
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

      <label className={LBL}>시스템 프롬프트 (AI 작성 지시 — 다음 단계에서 사용)</label>
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
  onClose,
  onSaved,
}: {
  pid: number;
  col: Column;
  stu: StudentRow;
  cell: Cell | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [raw, setRaw] = useState(cell?.raw_data ?? "");
  const [gen, setGen] = useState(cell?.generated_text ?? "");
  const [saving, setSaving] = useState(false);

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

  return (
    <Modal title={`${stu.name} · ${col.name}`} onClose={onClose} wide>
      <label className={LBL}>원자료 (학생 제출물 — 자동 수집은 다음 단계)</label>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={5}
        className={`${INP} text-caption mb-1`}
        placeholder="학생의 과제·설문·활동 내용 등"
      />
      <div className="text-[10px] text-text-tertiary mb-3">{raw.length}자</div>

      <label className={LBL}>생성 결과 (AI 작성은 다음 단계 — 지금은 수동 입력 가능)</label>
      <textarea
        value={gen}
        onChange={(e) => setGen(e.target.value)}
        rows={5}
        className={`${INP} text-caption mb-1`}
        placeholder="생활기록부 문장"
      />
      <div className="text-[10px] text-text-tertiary mb-3">
        {gen.length}자
        {col.char_max ? ` / 최대 ${col.char_max}자` : ""}
        {col.char_max && gen.length > col.char_max ? (
          <span className="text-red-600 ml-1">초과</span>
        ) : null}
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
