"use client";

/**
 * 클래스룸 과제 제출 — Google Classroom '내 과제' (Turn in).
 *
 * MySubmissionCard (학생): 첨부 모으기(파일 업로드 + 내 드라이브) + 사본 표시
 *   + 제출 / 제출 취소. returned면 점수·피드백 표시 + 수정·재제출 가능.
 * SubmissionsSection (교사): 학생별 제출 현황 + 점수·피드백 입력 + 돌려주기.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2, Clock, FileUp, HardDrive, Loader2, Paperclip,
  RotateCcw, Send, Trash2, Award,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { downloadSecure } from "@/lib/api/download";
import { DrivePicker } from "./DrivePicker";
import type { Attachment, PostDetail } from "./PostDetailView";

interface CopyItem {
  copy_type: string;
  copy_id: number;
  title: string;
  url: string | null;
}

interface SubmissionData {
  id: number | null;
  status: "assigned" | "turned_in" | "returned";
  attachments: Attachment[];
  turned_in_at: string | null;
  returned_at: string | null;
  score: number | null;
  feedback: string | null;
  is_late: boolean;
  copies?: CopyItem[];
}

const EMOJI: Record<string, string> = {
  doc: "📄", sheet: "📊", deck: "🖼️", survey: "📋", hwp: "📝",
};

const STATUS_META = {
  assigned: { label: "할당됨", cls: "bg-gray-100 text-gray-600" },
  turned_in: { label: "제출함", cls: "bg-emerald-100 text-emerald-700" },
  returned: { label: "돌려줌", cls: "bg-violet-100 text-violet-700" },
} as const;

/** 학생용 드라이브 자료 열람 경로 */
function studentHref(a: Attachment, cid: number): string | null {
  if (a.type === "doc" && a.doc_id) return `/s/classroom/${cid}/docs/${a.doc_id}`;
  if (a.type === "sheet" && a.sheet_id) return `/s/sheets/${a.sheet_id}`;
  if (a.type === "deck" && a.deck_id) return `/s/classroom/${cid}/decks/${a.deck_id}`;
  if (a.type === "hwp" && a.hwp_id) return `/s/hwps/${a.hwp_id}`;
  return null;
}

/** 교사용 드라이브 자료 열람 경로 */
function teacherHref(a: Attachment): string | null {
  if (a.type === "doc" && a.doc_id) return `/docs/${a.doc_id}`;
  if (a.type === "sheet" && a.sheet_id) return `/sheets/${a.sheet_id}`;
  if (a.type === "deck" && a.deck_id) return `/docs/decks/${a.deck_id}`;
  if (a.type === "hwp" && a.hwp_id) return `/hwps/${a.hwp_id}`;
  return null;
}

function fmtNo(g?: number | null, c?: number | null, n?: number | null): string {
  if (!g || !c || !n) return "";
  return `${g}${String(c).padStart(2, "0")}${String(n).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────
// 학생 — 내 과제
// ─────────────────────────────────────────────────────────────────────────

export function MySubmissionCard({ post }: { post: PostDetail }) {
  const [sub, setSub] = useState<SubmissionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showDrive, setShowDrive] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<SubmissionData>(`/api/classroom/posts/${post.id}/my-submission`);
      setSub(r);
    } catch { setSub(null); }
    finally { setLoading(false); }
  }, [post.id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="bg-bg-primary border border-border-default rounded-xl p-5 mt-4 text-caption text-text-tertiary inline-flex items-center gap-2 w-full">
        <Loader2 size={13} className="animate-spin" /> 내 과제 불러오는 중...
      </div>
    );
  }
  if (!sub) return null;

  const locked = sub.status === "turned_in";
  const meta = STATUS_META[sub.status];

  const putAttachments = async (next: Attachment[]) => {
    setBusy(true);
    try {
      const r = await api.put<SubmissionData>(`/api/classroom/posts/${post.id}/my-submission`, {
        attachments: next,
      });
      setSub((prev) => prev ? { ...r, copies: prev.copies } : r);
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
    } finally { setBusy(false); }
  };

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        await api.upload(`/api/classroom/posts/${post.id}/my-submission/files`, files[i]);
      }
      await load();
    } catch (err: any) {
      alert(err?.detail || "업로드 실패");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const addFromDrive = (picked: Array<{ type: string; source_id: number; title: string }>) => {
    const existing = sub.attachments;
    const next = [...existing];
    for (const p of picked) {
      const idKey = `${p.type}_id`;
      const dup = existing.some((a) => a.type === (p.type as any) && (a as any)[idKey] === p.source_id);
      if (dup) continue;
      next.push({ type: p.type as any, title: p.title, [idKey]: p.source_id } as any);
    }
    putAttachments(next);
  };

  const turnIn = async () => {
    const empty = sub.attachments.length === 0 && (sub.copies?.length || 0) === 0;
    if (!confirm(empty ? "첨부 없이 과제를 제출할까요?" : "과제를 제출할까요?")) return;
    setBusy(true);
    try {
      await api.post(`/api/classroom/posts/${post.id}/my-submission/turn-in`, {});
      await load();
    } catch (e: any) {
      alert(e?.detail || "제출 실패");
    } finally { setBusy(false); }
  };

  const unsubmit = async () => {
    if (!confirm("제출을 취소할까요? 다시 수정 후 제출할 수 있습니다.")) return;
    setBusy(true);
    try {
      await api.post(`/api/classroom/posts/${post.id}/my-submission/unsubmit`, {});
      await load();
    } catch (e: any) {
      alert(e?.detail || "취소 실패");
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-bg-primary border-2 border-accent/30 rounded-xl p-5 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-semibold text-text-primary">내 과제</div>
        <div className="flex items-center gap-1.5">
          {sub.is_late && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600">늦음</span>
          )}
          <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${meta.cls}`}>
            {meta.label}
          </span>
        </div>
      </div>

      {/* 채점 결과 (returned) */}
      {sub.status === "returned" && (
        <div className="mb-3 px-3 py-2.5 bg-violet-50 border border-violet-200 rounded">
          <div className="flex items-center gap-2 text-caption text-violet-800">
            <Award size={13} />
            {sub.score != null
              ? <>점수 <b>{sub.score}</b>{post.max_score != null && ` / ${post.max_score}`}점</>
              : "점수 없이 돌려줌"}
          </div>
          {sub.feedback && (
            <div className="text-caption text-violet-700 mt-1 whitespace-pre-wrap">{sub.feedback}</div>
          )}
        </div>
      )}

      {/* 내 사본 (share_mode=copy) */}
      {(sub.copies?.length || 0) > 0 && (
        <div className="space-y-1.5 mb-2">
          {sub.copies!.map((c, i) => (
            <a
              key={`copy-${i}`}
              href={c.url || "#"}
              className="flex items-center gap-2 px-3 py-2 border border-violet-200 bg-violet-50 rounded hover:bg-violet-100"
            >
              <span className="text-[14px]">{EMOJI[c.copy_type] || "📄"}</span>
              <span className="text-caption text-violet-800 flex-1 truncate">{c.title}</span>
              <span className="text-[10px] text-violet-600 flex-shrink-0">내 사본</span>
            </a>
          ))}
        </div>
      )}

      {/* 제출 첨부 */}
      {sub.attachments.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {sub.attachments.map((a, i) => {
            const href = studentHref(a, post.course_id);
            return (
              <div key={i} className="flex items-center gap-2 px-3 py-2 border border-border-default rounded group hover:bg-bg-secondary">
                {EMOJI[a.type]
                  ? <span className="text-[14px] flex-shrink-0">{EMOJI[a.type]}</span>
                  : <Paperclip size={13} className="text-text-tertiary flex-shrink-0" />}
                {a.type === "file" && a.file_url ? (
                  <button
                    type="button"
                    onClick={() => downloadSecure(a.file_url!, a.file_name || a.title)}
                    className="text-caption text-accent hover:underline flex-1 truncate text-left"
                  >
                    {a.title}
                  </button>
                ) : href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-caption text-accent hover:underline flex-1 truncate">
                    {a.title}
                  </a>
                ) : (
                  <span className="text-caption flex-1 truncate">{a.title}</span>
                )}
                {!locked && (
                  <button
                    type="button"
                    onClick={() => putAttachments(sub.attachments.filter((_, x) => x !== i))}
                    disabled={busy}
                    className="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-status-error"
                    title="제거"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 추가 버튼들 (제출 전) */}
      {!locked && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
          >
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <FileUp size={12} />}
            {uploading ? "업로드 중..." : "파일 업로드"}
          </button>
          <button
            type="button"
            onClick={() => setShowDrive(true)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
          >
            <HardDrive size={12} /> 내 드라이브
          </button>
          <input
            ref={fileRef} type="file" multiple onChange={onFiles} className="hidden"
            accept=".pdf,.hwp,.hwpx,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.zip"
          />
        </div>
      )}

      {/* 제출 / 제출 취소 */}
      {locked ? (
        <button
          type="button"
          onClick={unsubmit}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-1.5 py-2 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
        >
          <RotateCcw size={13} /> 제출 취소
        </button>
      ) : (
        <button
          type="button"
          onClick={turnIn}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-1.5 py-2 text-caption font-medium bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
        >
          <Send size={13} /> {sub.status === "returned" ? "다시 제출" : "제출"}
        </button>
      )}
      {sub.turned_in_at && (
        <div className="text-[10.5px] text-text-tertiary mt-1.5 text-center">
          제출 {new Date(sub.turned_in_at).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}
        </div>
      )}

      {showDrive && (
        <DrivePicker
          onClose={() => setShowDrive(false)}
          onSelect={addFromDrive}
          allowedTypes={["docs", "sheets", "decks", "hwps"]}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 교사 — 제출 현황 + 돌려주기
// ─────────────────────────────────────────────────────────────────────────

interface SubmissionRow {
  student_id: number;
  name: string;
  grade: number | null;
  class_number: number | null;
  student_number: number | null;
  status: "assigned" | "turned_in" | "returned";
  turned_in_at: string | null;
  is_late: boolean;
  score: number | null;
  feedback: string | null;
  attachments: Attachment[];
}

export function SubmissionsSection({ post }: { post: PostDetail }) {
  const [rows, setRows] = useState<SubmissionRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: SubmissionRow[]; counts: Record<string, number> }>(
        `/api/classroom/posts/${post.id}/submissions`,
      );
      setRows(r.items);
      setCounts(r.counts || {});
    } catch {
      setRows(null); // 권한 없음(학생/비담당) → 섹션 숨김
    }
  }, [post.id]);

  useEffect(() => { load(); }, [load]);

  if (!rows) return null;

  const turnedIn = (counts.turned_in || 0) + (counts.returned || 0);

  return (
    <div className="bg-bg-primary border border-border-default rounded-xl p-5 mt-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between"
      >
        <div className="text-[11.5px] font-semibold text-text-tertiary uppercase tracking-wide">
          제출 현황
        </div>
        <div className="flex items-center gap-4 text-center">
          <div>
            <span className="text-[20px] font-light text-text-primary">{turnedIn}</span>
            <span className="text-[11px] text-text-tertiary ml-1">제출함</span>
          </div>
          <div>
            <span className="text-[20px] font-light text-text-primary">{rows.length}</span>
            <span className="text-[11px] text-text-tertiary ml-1">할당됨</span>
          </div>
          {(counts.returned || 0) > 0 && (
            <div>
              <span className="text-[20px] font-light text-text-primary">{counts.returned}</span>
              <span className="text-[11px] text-text-tertiary ml-1">돌려줌</span>
            </div>
          )}
        </div>
      </button>

      {open && (
        <div className="mt-3 divide-y divide-border-default">
          {rows.map((r) => (
            <SubmissionTeacherRow key={r.student_id} row={r} post={post} onChanged={load} />
          ))}
          {rows.length === 0 && (
            <div className="text-caption text-text-tertiary py-6 text-center">
              이 강좌에 학생이 없습니다
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SubmissionTeacherRow({
  row, post, onChanged,
}: { row: SubmissionRow; post: PostDetail; onChanged: () => void }) {
  const [score, setScore] = useState<string>(row.score != null ? String(row.score) : "");
  const [feedback, setFeedback] = useState<string>(row.feedback || "");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const meta = STATUS_META[row.status];
  const no = fmtNo(row.grade, row.class_number, row.student_number);

  const ret = async () => {
    setBusy(true);
    try {
      await api.post(`/api/classroom/posts/${post.id}/submissions/${row.student_id}/return`, {
        score: score.trim() === "" ? null : Math.max(0, parseInt(score, 10) || 0),
        feedback: feedback.trim() || null,
      });
      onChanged();
    } catch (e: any) {
      alert(e?.detail || "반환 실패");
    } finally { setBusy(false); }
  };

  return (
    <div className="py-2.5">
      <div
        className="flex items-center gap-2.5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-caption font-medium text-text-primary">
          {row.name}
          {no && <span className="text-text-tertiary font-normal ml-1.5 text-[11px]">{no}</span>}
        </span>
        <span className={`text-[10.5px] px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
        {row.is_late && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 inline-flex items-center gap-0.5">
            <Clock size={9} /> 늦음
          </span>
        )}
        {row.attachments.length > 0 && (
          <span className="text-[10.5px] text-text-tertiary inline-flex items-center gap-0.5">
            <Paperclip size={10} /> {row.attachments.length}
          </span>
        )}
        {row.score != null && (
          <span className="text-[10.5px] text-violet-700 inline-flex items-center gap-0.5">
            <Award size={10} /> {row.score}점
          </span>
        )}
        <span className="flex-1" />
        {row.turned_in_at && (
          <span className="text-[10.5px] text-text-tertiary">
            {new Date(row.turned_in_at).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}
          </span>
        )}
      </div>

      {expanded && (
        <div className="mt-2 pl-1">
          {/* 제출 첨부 */}
          {row.attachments.length > 0 ? (
            <div className="space-y-1 mb-2">
              {row.attachments.map((a, i) => {
                const href = teacherHref(a);
                return (
                  <div key={i} className="flex items-center gap-2 text-caption">
                    {EMOJI[a.type]
                      ? <span className="text-[13px]">{EMOJI[a.type]}</span>
                      : <Paperclip size={11} className="text-text-tertiary" />}
                    {a.type === "file" && a.file_url ? (
                      <button
                        type="button"
                        onClick={() => downloadSecure(a.file_url!, a.file_name || a.title)}
                        className="text-accent hover:underline truncate"
                      >
                        {a.title}
                      </button>
                    ) : href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline truncate">
                        {a.title}
                      </a>
                    ) : (
                      <span className="truncate">{a.title}</span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[11px] text-text-tertiary mb-2">제출 첨부 없음</div>
          )}

          {/* 점수 + 피드백 + 돌려주기 */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="number"
              min={0}
              max={post.max_score ?? 10000}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              placeholder={post.max_score != null ? `/${post.max_score}` : "점수"}
              className="w-20 px-2 py-1 text-caption border border-border-default rounded bg-bg-primary"
            />
            <input
              type="text"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="피드백 (선택)"
              className="flex-1 min-w-[160px] px-2 py-1 text-caption border border-border-default rounded bg-bg-primary"
            />
            <button
              type="button"
              onClick={ret}
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1 text-caption bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
              돌려주기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
