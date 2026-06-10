"use client";

/**
 * 내 확인 — 학생 통합 '이상없음' 페이지.
 *
 * 생기부(공개분) / 수행평가(반환된 클래스룸 과제) / 성적(학기별 지필)을
 * 한 곳에서 검토하고 각각 [이상없음] 또는 [수정 요청(사유)]을 남긴다.
 * 수정 요청은 담당 교사에게 알림이 간다.
 */

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2, AlertTriangle, Loader2, ClipboardList, Award, BarChart3,
} from "lucide-react";
import { api } from "@/lib/api/client";

interface Conf {
  status: "confirmed" | "revision_requested";
  comment: string | null;
  updated_at: string | null;
}

interface RecordItem {
  project_id: number;
  project: string;
  final_text: string | null;
  items: { name: string; content: string; char_count: number }[];
}
interface SubmissionItem {
  submission_id: number;
  post_id: number;
  post_title: string;
  course_id: number;
  course_name: string;
  score: number | null;
  max_score: number | null;
  feedback: string | null;
  returned_at: string | null;
}
interface GradeGroup {
  ref_key: string;
  year: number;
  semester: number;
  grades: {
    subject: string; exam_type: string; score: number;
    max_score: number; grade_rank: number | null; average: number | null;
  }[];
}

export default function MyChecksPage() {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [subs, setSubs] = useState<SubmissionItem[]>([]);
  const [grades, setGrades] = useState<GradeGroup[]>([]);
  const [confs, setConfs] = useState<Record<string, Conf>>({});
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s, g, c] = await Promise.all([
        api.get<{ records: RecordItem[] } | RecordItem[]>(`/api/record-writer/me/records`).catch(() => ({ records: [] })),
        api.get<{ items: SubmissionItem[] }>(`/api/me/returned-submissions`).catch(() => ({ items: [] })),
        api.get<{ items: GradeGroup[] }>(`/api/me/grades-summary`).catch(() => ({ items: [] })),
        api.get<{ items: Record<string, Conf> }>(`/api/me/confirmations`).catch(() => ({ items: {} })),
      ]);
      const recs: RecordItem[] = Array.isArray(r) ? r : (r as any).records || (r as any).items || [];
      setRecords(recs);
      setSubs(s.items || []);
      setGrades(g.items || []);
      setConfs(c.items || {});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const confirm_ = async (kind: string, refKey: string, status: Conf["status"]) => {
    let comment: string | null = null;
    if (status === "revision_requested") {
      comment = window.prompt("수정 요청 사유를 입력하세요 (담당 교사에게 전달됩니다):");
      if (comment === null) return;
      if (!comment.trim()) {
        alert("사유를 입력해야 합니다.");
        return;
      }
    } else if (!window.confirm("내용을 확인했고 이상이 없습니까?")) {
      return;
    }
    const key = `${kind}:${refKey}`;
    setBusyKey(key);
    try {
      const r = await api.post<Conf>(`/api/me/confirmations`, {
        kind, ref_key: refKey, status, comment,
      });
      setConfs((prev) => ({ ...prev, [key]: r }));
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
    } finally {
      setBusyKey(null);
    }
  };

  const AckBar = ({ kind, refKey }: { kind: string; refKey: string }) => {
    const key = `${kind}:${refKey}`;
    const conf = confs[key];
    const busy = busyKey === key;
    return (
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border-default flex-wrap">
        {conf?.status === "confirmed" ? (
          <span className="inline-flex items-center gap-1 text-caption text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded">
            <CheckCircle2 size={13} /> 이상없음 확인함
            {conf.updated_at && (
              <span className="text-emerald-600/70 text-[10.5px]">
                {new Date(conf.updated_at).toLocaleDateString("ko-KR")}
              </span>
            )}
          </span>
        ) : conf?.status === "revision_requested" ? (
          <span className="inline-flex items-center gap-1 text-caption text-amber-700 bg-amber-50 px-2.5 py-1 rounded" title={conf.comment || ""}>
            <AlertTriangle size={13} /> 수정 요청함{conf.comment ? ` — ${conf.comment.slice(0, 40)}` : ""}
          </span>
        ) : (
          <span className="text-caption text-text-tertiary">아직 확인하지 않음</span>
        )}
        <span className="flex-1" />
        <button
          onClick={() => confirm_(kind, refKey, "confirmed")}
          disabled={busy}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-caption bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} 이상없음
        </button>
        <button
          onClick={() => confirm_(kind, refKey, "revision_requested")}
          disabled={busy}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-caption border border-amber-300 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50"
        >
          <AlertTriangle size={12} /> 수정 요청
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-12 text-center">
        <Loader2 size={20} className="animate-spin mx-auto text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-title text-text-primary mb-1">내 확인</h1>
      <p className="text-caption text-text-tertiary mb-6">
        생활기록부·수행평가·성적을 검토하고 이상 여부를 확인합니다. 수정 요청은 담당 선생님께 전달됩니다.
      </p>

      {/* ── 생활기록부 ── */}
      <SectionTitle icon={<ClipboardList size={15} />} title="생활기록부" count={records.length} />
      {records.length === 0 ? (
        <Empty text="공개된 생활기록부가 없습니다." />
      ) : (
        records.map((r) => (
          <div key={r.project_id} className="bg-bg-primary border border-border-default rounded-xl p-4 mb-3">
            <div className="text-body font-medium text-text-primary mb-2">{r.project}</div>
            {r.items.map((it, i) => (
              <div key={i} className="mb-2">
                <div className="text-[11px] text-text-tertiary mb-0.5">{it.name} ({it.char_count}자)</div>
                <div className="text-caption text-text-primary whitespace-pre-wrap leading-relaxed">{it.content}</div>
              </div>
            ))}
            {r.final_text && (
              <div className="mb-1">
                <div className="text-[11px] text-purple-600 mb-0.5">최종 종합</div>
                <div className="text-caption text-text-primary whitespace-pre-wrap leading-relaxed">{r.final_text}</div>
              </div>
            )}
            <AckBar kind="record" refKey={String(r.project_id)} />
          </div>
        ))
      )}

      {/* ── 수행평가 (반환된 과제) ── */}
      <SectionTitle icon={<Award size={15} />} title="수행평가 (채점 반환)" count={subs.length} />
      {subs.length === 0 ? (
        <Empty text="반환(채점)된 과제가 없습니다." />
      ) : (
        subs.map((s) => (
          <div key={s.submission_id} className="bg-bg-primary border border-border-default rounded-xl p-4 mb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-body font-medium text-text-primary">
                {s.post_title}
                <span className="text-caption text-text-tertiary ml-2">{s.course_name}</span>
              </div>
              <div className="text-body text-violet-700 font-medium">
                {s.score != null ? `${s.score}${s.max_score != null ? ` / ${s.max_score}` : ""}점` : "점수 없음"}
              </div>
            </div>
            {s.feedback && (
              <div className="text-caption text-text-secondary mt-1.5 whitespace-pre-wrap">
                [피드백] {s.feedback}
              </div>
            )}
            <AckBar kind="submission" refKey={String(s.submission_id)} />
          </div>
        ))
      )}

      {/* ── 성적 (지필) ── */}
      <SectionTitle icon={<BarChart3 size={15} />} title="성적 (지필평가)" count={grades.length} />
      {grades.length === 0 ? (
        <Empty text="등록된 성적이 없습니다." />
      ) : (
        grades.map((g) => (
          <div key={g.ref_key} className="bg-bg-primary border border-border-default rounded-xl p-4 mb-3">
            <div className="text-body font-medium text-text-primary mb-2">
              {g.year}학년도 {g.semester}학기
            </div>
            <table className="w-full text-caption">
              <thead>
                <tr className="text-text-tertiary text-[11px] border-b border-border-default">
                  <th className="text-left py-1 font-normal">과목</th>
                  <th className="text-left py-1 font-normal">구분</th>
                  <th className="text-right py-1 font-normal">점수</th>
                  <th className="text-right py-1 font-normal">등급</th>
                  <th className="text-right py-1 font-normal">평균</th>
                </tr>
              </thead>
              <tbody>
                {g.grades.map((row, i) => (
                  <tr key={i} className="border-b border-border-default/50 last:border-0">
                    <td className="py-1 text-text-primary">{row.subject}</td>
                    <td className="py-1 text-text-tertiary">
                      {row.exam_type === "midterm" ? "중간" : row.exam_type === "final" ? "기말" : row.exam_type}
                    </td>
                    <td className="py-1 text-right">{row.score}{row.max_score !== 100 ? `/${row.max_score}` : ""}</td>
                    <td className="py-1 text-right">{row.grade_rank ?? "-"}</td>
                    <td className="py-1 text-right text-text-tertiary">{row.average ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <AckBar kind="grades" refKey={g.ref_key} />
          </div>
        ))
      )}
    </div>
  );
}

function SectionTitle({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 text-text-secondary mt-6 mb-2 first:mt-0">
      {icon}
      <span className="text-body font-medium">{title}</span>
      <span className="text-caption text-text-tertiary">{count}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="text-caption text-text-tertiary border border-dashed border-border-default rounded-lg p-5 text-center mb-3">
      {text}
    </div>
  );
}
