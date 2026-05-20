"use client";

import { useEffect, useState, useCallback } from "react";
import { Sparkles, Eye, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api/client";

interface Semester {
  id: number;
  name: string;
  is_current: boolean;
}

interface SeedTypeResult {
  created: number;
  skipped: number;
  errors: string[];
  preview: { status: string; name?: string; class?: string; grade?: number; owner?: string }[];
}

interface SeedResult {
  types: { grade_office?: SeedTypeResult; class_homeroom?: SeedTypeResult };
  total_created: number;
  total_skipped: number;
  dry_run: boolean;
}

export function Step7Courses() {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [semId, setSemId] = useState<number | null>(null);
  const [createGradeOffice, setCreateGradeOffice] = useState(true);
  const [createHomeroom, setCreateHomeroom] = useState(true);
  const [createSubject, setCreateSubject] = useState(false);
  const [preview, setPreview] = useState<SeedResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<any>("/api/timetable/semesters");
      const list = Array.isArray(r) ? r : r.items || [];
      setSemesters(list);
      const current = list.find((s: Semester) => s.is_current);
      if (current) setSemId(current.id);
      else if (list.length > 0) setSemId(list[0].id);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const doDryRun = async () => {
    if (!semId) return;
    setBusy(true);
    try {
      const r = await api.post<SeedResult>("/api/classroom/courses/_seed-auto", {
        semester_id: semId,
        grade_office: createGradeOffice,
        class_homeroom: createHomeroom,
        subject: createSubject,
        dry_run: true,
      });
      setPreview(r);
    } catch (e: any) {
      alert(e?.message || "미리보기 실패");
    } finally { setBusy(false); }
  };

  const doExecute = async () => {
    if (!semId) return;
    if (!preview) { await doDryRun(); return; }
    if (!confirm(`총 ${preview.total_created}개 강좌를 생성합니다. (이미 있는 것은 skip)\n진행하시겠습니까?`)) return;
    setBusy(true);
    try {
      const r = await api.post<SeedResult>("/api/classroom/courses/_seed-auto", {
        semester_id: semId,
        grade_office: createGradeOffice,
        class_homeroom: createHomeroom,
        subject: createSubject,
        dry_run: false,
      });
      alert(`✓ ${r.total_created}개 강좌 생성, ${r.total_skipped}개 skip`);
      setPreview(r);
    } catch (e: any) {
      alert(e?.message || "실행 실패");
    } finally { setBusy(false); }
  };

  const allSkip = preview &&
    (preview.types.grade_office?.preview.every((p) => p.status === "skip") ?? true) &&
    (preview.types.class_homeroom?.preview.every((p) => p.status === "skip") ?? true);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-body font-semibold text-text-primary">클래스룸 자동 생성</h2>
        <p className="text-caption text-text-tertiary mt-1">
          학기 enrollment·학년부장·담임 데이터를 기반으로 강좌를 자동 생성합니다.
        </p>
      </div>

      <div className="bg-bg-primary border border-border-default rounded-lg p-5 mb-4">
        <label className="block text-[12px] text-text-secondary mb-1">대상 학기</label>
        <select
          value={semId || 0}
          onChange={(e) => { setSemId(Number(e.target.value)); setPreview(null); }}
          className="w-full px-3 py-2 text-[13px] border border-border-default rounded bg-bg-primary mb-4"
        >
          <option value={0}>학기 선택...</option>
          {semesters.map((s) => (
            <option key={s.id} value={s.id}>{s.name} {s.is_current && "(현재)"}</option>
          ))}
        </select>

        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={createGradeOffice} onChange={(e) => { setCreateGradeOffice(e.target.checked); setPreview(null); }} className="mt-0.5" />
            <div className="flex-1">
              <div className="text-body font-medium text-text-primary">학년부 강좌</div>
              <div className="text-[12px] text-text-tertiary mt-0.5">
                학년부장(is_grade_lead=True) = owner, 같은 학년 담임 = 공동교사
              </div>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={createHomeroom} onChange={(e) => { setCreateHomeroom(e.target.checked); setPreview(null); }} className="mt-0.5" />
            <div className="flex-1">
              <div className="text-body font-medium text-text-primary">학급 강좌</div>
              <div className="text-[12px] text-text-tertiary mt-0.5">
                담임(homeroom) = owner, 해당 학급 학생 자동 등록
              </div>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer opacity-60">
            <input type="checkbox" checked={createSubject} onChange={(e) => { setCreateSubject(e.target.checked); setPreview(null); }} className="mt-0.5" disabled />
            <div className="flex-1">
              <div className="text-body font-medium text-text-primary">교과 강좌 <span className="text-[11px] text-text-tertiary">(비활성)</span></div>
              <div className="text-[12px] text-text-tertiary mt-0.5">
                시간표 등록 후 별도 페이지에서 생성 권장
              </div>
            </div>
          </label>
        </div>

        <div className="pt-4 border-t border-border-default mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={doDryRun}
            disabled={busy || !semId}
            className="px-4 py-2 text-[13px] border border-accent/30 text-accent rounded hover:bg-accent/5 disabled:opacity-40 flex items-center gap-1"
          >
            <Eye size={14} /> 미리보기
          </button>
          <button
            type="button"
            onClick={doExecute}
            disabled={busy || !semId || (preview && allSkip)}
            className="px-4 py-2 text-[13px] bg-accent text-white rounded hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
          >
            <Sparkles size={14} /> {preview && !preview.dry_run ? "재실행" : "강좌 생성"}
          </button>
        </div>
      </div>

      {/* 미리보기 결과 */}
      {preview && (
        <div className="bg-bg-secondary/40 border border-border-default rounded-lg p-4">
          {preview.dry_run ? (
            <div className="flex items-start gap-2 mb-3">
              <AlertTriangle size={14} className="text-amber-600 mt-0.5" />
              <div className="text-[12px] text-text-secondary">
                <strong>미리보기 모드</strong> — 아직 생성 안 됨. 확인 후 "강좌 생성" 클릭.
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 mb-3">
              <CheckCircle2 size={14} className="text-emerald-600 mt-0.5" />
              <div className="text-[12px] text-text-secondary">
                <strong>실행 완료</strong> — {preview.total_created}개 신규, {preview.total_skipped}개 skip.
              </div>
            </div>
          )}

          {(["grade_office", "class_homeroom"] as const).map((t) => {
            const r = preview.types[t];
            if (!r || r.preview.length === 0) return null;
            return (
              <div key={t} className="mb-2">
                <div className="text-[12px] font-semibold text-text-primary mb-1">
                  {t === "grade_office" ? "학년부" : "학급"} ({r.preview.length}개)
                </div>
                <div className="space-y-0.5 max-h-32 overflow-y-auto">
                  {r.preview.map((p, i) => (
                    <div key={i} className="text-[11px] flex items-center gap-2 px-2 py-0.5">
                      <span className={p.status === "skip" ? "text-text-tertiary" : "text-emerald-600"}>
                        {p.status === "skip" ? "—" : "+"}
                      </span>
                      <span className="text-text-secondary">{p.name}</span>
                      {p.owner && <span className="text-text-tertiary">· owner: {p.owner}</span>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 text-[12px] text-text-tertiary text-center">
        💡 추가 강좌는 마법사 후 <code className="text-accent">클래스룸</code> 페이지에서 직접 만들 수 있습니다.
      </div>
    </div>
  );
}
