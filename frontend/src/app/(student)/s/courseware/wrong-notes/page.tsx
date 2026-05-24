"use client";

/**
 * 학생 오답 노트 — 본인이 풀어본 문제 중 틀린 것 모아 보기.
 *
 * 같은 (set, problem)의 여러 시도 중 최신만. 자동채점 False만 (수동 대기·정답 제외).
 * 마감 지난 ProblemSet에서 show_solution_after_due=true면 정답·해설 표시.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileQuestion, BookOpen } from "lucide-react";
import { api } from "@/lib/api/client";
import { ProblemContent, InlineMathText } from "@/components/courseware/ProblemContent";

interface WrongItem {
  attempt_id: number;
  attempt_number: number;
  problem_set_id: number;
  problem_set_title: string;
  course_id: number;
  course_name: string;
  problem_id: number;
  problem_type: string;
  subject: string | null;
  difficulty: string;
  content: string;
  answer_data_view: { choices?: string[] | null };
  your_answer: Record<string, any> | null;
  submitted_at: string | null;
  answer: string | null;
  solution: string | null;
  revealed: boolean;
}

function formatYourAnswer(type: string, ans: Record<string, any> | null): string {
  if (!ans) return "(무응답)";
  if (type === "multiple_choice") {
    const sel = ans.selected || [];
    return Array.isArray(sel) && sel.length ? sel.join(", ") : "(무응답)";
  }
  if (type === "numeric") {
    return ans.value !== undefined && ans.value !== "" ? String(ans.value) : "(무응답)";
  }
  return (ans.text || "").toString().trim() || "(무응답)";
}

export default function WrongNotesPage() {
  const [items, setItems] = useState<WrongItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCourse, setFilterCourse] = useState<number | "all">("all");
  const [filterSubject, setFilterSubject] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: WrongItem[] }>(
        `/api/courseware/me/wrong-attempts?limit=100`,
      );
      setItems(res.items);
    } catch {
      // 권한 없거나 데이터 없음 — 빈 상태로 표시
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const courses = useMemo(() => {
    const m = new Map<number, string>();
    items.forEach((it) => m.set(it.course_id, it.course_name));
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const subjects = useMemo(() => {
    const s = new Set<string>();
    items.forEach((it) => it.subject && s.add(it.subject));
    return Array.from(s).sort();
  }, [items]);

  const filtered = useMemo(
    () =>
      items.filter((it) => {
        if (filterCourse !== "all" && it.course_id !== filterCourse) return false;
        if (filterSubject !== "all" && (it.subject || "") !== filterSubject) return false;
        return true;
      }),
    [items, filterCourse, filterSubject],
  );

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-h2 flex items-center gap-2">
          <BookOpen size={22} /> 오답 노트
        </h1>
        <p className="text-caption text-text-tertiary mt-1">
          본인이 풀어본 문제 중 자동채점에서 틀린 것 모아보기. 같은 문제를 다시
          맞히면 목록에서 사라집니다.
        </p>
      </div>

      {/* 필터 */}
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-caption">
          <select
            value={filterCourse}
            onChange={(e) =>
              setFilterCourse(e.target.value === "all" ? "all" : Number(e.target.value))
            }
            className="px-2 py-1.5 border border-border-default rounded text-body"
          >
            <option value="all">강좌 전체</option>
            {courses.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select
            value={filterSubject}
            onChange={(e) => setFilterSubject(e.target.value)}
            className="px-2 py-1.5 border border-border-default rounded text-body"
          >
            <option value="all">과목 전체</option>
            {subjects.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <span className="text-text-tertiary">
            {filtered.length}개 / 전체 {items.length}개
          </span>
        </div>
      )}

      {loading ? (
        <div className="text-text-tertiary text-center py-8">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-12 text-center">
          <FileQuestion size={28} className="mx-auto text-text-tertiary opacity-30 mb-2" />
          <div className="text-body text-text-secondary mb-1">
            {items.length === 0 ? "틀린 문제가 없습니다" : "필터 결과 없음"}
          </div>
          <div className="text-caption text-text-tertiary">
            {items.length === 0
              ? "강좌의 '문제' 탭에서 문제를 풀어보세요"
              : "다른 필터를 선택해 보세요"}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((it) => (
            <div
              key={`${it.problem_set_id}-${it.problem_id}`}
              className="bg-bg-primary border border-border-default rounded-lg p-4"
            >
              <div className="flex items-center justify-between gap-2 mb-2 text-caption text-text-tertiary">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold">{it.course_name}</span>
                  <span>·</span>
                  <span>{it.problem_set_title}</span>
                  <span className="px-1.5 py-0.5 bg-bg-secondary rounded text-[10px]">
                    {it.problem_type}
                  </span>
                  {it.subject && (
                    <span className="px-1.5 py-0.5 bg-bg-secondary rounded text-[10px]">
                      {it.subject}
                    </span>
                  )}
                </div>
                <Link
                  href={`/s/classroom/${it.course_id}/courseware/${it.problem_set_id}`}
                  className="text-caption text-accent-default hover:underline inline-flex items-center gap-0.5"
                >
                  다시 풀기 <ArrowRight size={12} />
                </Link>
              </div>

              <ProblemContent content={it.content} className="text-body mb-3" />

              {/* 객관식이면 보기 표시 */}
              {it.problem_type === "multiple_choice" && it.answer_data_view.choices && (
                <div className="bg-bg-secondary rounded p-2 mb-2 space-y-0.5">
                  {it.answer_data_view.choices.map((c, idx) => {
                    const letter = String.fromCharCode(65 + idx);
                    const youPicked = (it.your_answer?.selected || []).includes(letter);
                    return (
                      <div
                        key={idx}
                        className={`text-caption flex items-start gap-2 ${
                          youPicked ? "text-red-700 font-semibold" : "text-text-secondary"
                        }`}
                      >
                        <span className="font-mono w-5">{letter}</span>
                        <span><InlineMathText text={c} /></span>
                        {youPicked && <span className="text-[10px]">← 내 답</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-caption mb-2">
                <div>
                  <span className="text-text-tertiary font-semibold">내 답:</span>{" "}
                  <span className="text-red-700">
                    <InlineMathText text={formatYourAnswer(it.problem_type, it.your_answer)} />
                  </span>
                </div>
                {it.revealed && it.answer && (
                  <div>
                    <span className="text-text-tertiary font-semibold">정답:</span>{" "}
                    <span className="text-emerald-700 font-semibold">
                      <InlineMathText text={it.answer} />
                    </span>
                  </div>
                )}
              </div>

              {it.revealed && it.solution && (
                <div className="border-t border-border-default pt-2 mt-2">
                  <div className="text-caption text-text-tertiary font-semibold mb-1">해설</div>
                  <ProblemContent
                    content={it.solution}
                    className="text-caption text-text-secondary whitespace-pre-wrap"
                  />
                </div>
              )}

              {!it.revealed && (
                <div className="text-[11px] text-text-tertiary italic mt-1">
                  정답·해설은 마감 후 (또는 교사 설정) 공개됩니다.
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
