"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, GraduationCap, ChevronUp, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api/client";

export default function CohortPage() {
  const [graduates, setGraduates] = useState<any[]>([]);
  const [graduationYear, setGraduationYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(false);

  // 진급
  const [promoteFrom, setPromoteFrom] = useState(1);
  const [promoteResult, setPromoteResult] = useState<any>(null);

  // 졸업
  const [graduateYear, setGraduateYear] = useState(new Date().getFullYear());
  const [graduateResult, setGraduateResult] = useState<any>(null);

  const loadGraduates = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/users/_cohort/graduates${graduationYear ? `?graduation_year=${graduationYear}` : ""}`);
      setGraduates(data.items);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadGraduates(); }, []);

  const promote = async (dry: boolean) => {
    try {
      const res = await api.post("/api/users/_cohort/promote", {
        from_grade: promoteFrom, to_grade: promoteFrom + 1, dry_run: dry,
      });
      setPromoteResult(res);
      if (!dry) await loadGraduates();
    } catch (e: any) {
      alert(e?.detail || "실행 실패");
    }
  };

  const graduate = async (dry: boolean) => {
    if (!dry && !confirm(`${graduateYear}년 졸업으로 처리합니다. 학생 정보는 보존되며 status=graduated로 변경됩니다. 계속?`)) return;
    try {
      const res = await api.post("/api/users/_cohort/graduate", {
        graduation_year: graduateYear, from_grade: 3, dry_run: dry,
      });
      setGraduateResult(res);
      if (!dry) await loadGraduates();
    } catch (e: any) {
      alert(e?.detail || "실행 실패");
    }
  };

  return (
    <div className="max-w-5xl">
      <Link href="/students" className="flex items-center gap-1 text-caption text-text-secondary hover:text-accent mb-4">
        <ArrowLeft size={14} /> 학생 현황으로
      </Link>
      <h1 className="text-title text-text-primary mb-2">학년 진급 / 졸업 처리</h1>
      <p className="text-caption text-text-tertiary mb-6">
        학년말 일괄 진급/졸업 처리. 모든 포트폴리오 데이터는 보존됩니다.
        먼저 dry-run으로 영향받는 학생 수를 확인한 후 실행하세요.
      </p>

      {/* 경고 */}
      <div className="mb-6 p-4 bg-status-warning-light border border-status-warning rounded-lg">
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className="text-status-warning mt-0.5" />
          <div className="text-body">
            <div className="font-medium text-status-warning mb-1">실행 전 체크리스트</div>
            <ul className="text-caption text-text-secondary space-y-0.5 list-disc list-inside">
              <li>모든 성적/수상/생기부 등록이 완료되었는지 확인</li>
              <li>먼저 진급(1→2, 2→3) 후 졸업(3학년 → 졸업) 처리 권장</li>
              <li>진급 순서: 3학년부터 처리하면 안 됨 (3을 먼저 졸업시킨 뒤 2→3, 1→2)</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* 진급 */}
        <div className="bg-bg-primary border border-border-default rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <ChevronUp size={18} className="text-accent" />
            <h2 className="text-body font-semibold">학년 진급 (1→2 또는 2→3)</h2>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-caption text-text-secondary">현재 학년 → 다음 학년</label>
              <select value={promoteFrom} onChange={(e) => { setPromoteFrom(parseInt(e.target.value)); setPromoteResult(null); }}
                      className="w-full px-3 py-2 border border-border-default rounded text-body">
                <option value={1}>1학년 → 2학년</option>
                <option value={2}>2학년 → 3학년</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={() => promote(true)} className="flex-1 px-3 py-2 border border-border-default rounded text-body">
                미리보기 (dry-run)
              </button>
              <button onClick={() => promote(false)} className="flex-1 px-3 py-2 bg-accent text-white rounded text-body">
                실행
              </button>
            </div>
            {promoteResult && (
              <div className="p-2 bg-bg-secondary rounded text-body">
                {promoteResult.dry_run ? "예상" : "결과"}: <strong>{promoteResult.affected}</strong>명 진급
              </div>
            )}
          </div>
        </div>

        {/* 졸업 */}
        <div className="bg-bg-primary border border-border-default rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <GraduationCap size={18} className="text-accent" />
            <h2 className="text-body font-semibold">졸업 처리 (3학년 → 졸업)</h2>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-caption text-text-secondary">졸업 년도</label>
              <input type="number" value={graduateYear} onChange={(e) => { setGraduateYear(parseInt(e.target.value)); setGraduateResult(null); }}
                     className="w-full px-3 py-2 border border-border-default rounded text-body" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => graduate(true)} className="flex-1 px-3 py-2 border border-border-default rounded text-body">
                미리보기
              </button>
              <button onClick={() => graduate(false)} className="flex-1 px-3 py-2 bg-status-warning text-white rounded text-body">
                졸업 처리
              </button>
            </div>
            {graduateResult && (
              <div className="p-2 bg-bg-secondary rounded text-body">
                <div>{graduateResult.dry_run ? "예상" : "결과"}: <strong>{graduateResult.affected}</strong>명</div>
                {graduateResult.preview_names && (
                  <div className="text-caption text-text-tertiary mt-1">
                    {graduateResult.preview_names.join(", ")}{graduateResult.affected > 20 ? " ..." : ""}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 졸업생 목록 */}
      <div className="bg-bg-primary border border-border-default rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-body font-semibold">졸업생 목록</h2>
          <div className="flex items-center gap-2">
            <input type="number" value={graduationYear} onChange={(e) => setGraduationYear(parseInt(e.target.value))}
                   className="w-24 px-2 py-1 border border-border-default rounded text-body" />
            <button onClick={loadGraduates} className="px-3 py-1 bg-accent text-white rounded text-caption">조회</button>
          </div>
        </div>
        {loading ? (
          <div className="text-text-tertiary">로딩 중...</div>
        ) : graduates.length === 0 ? (
          <div className="text-text-tertiary text-center py-6">졸업생 없음</div>
        ) : (
          <table className="w-full text-body">
            <thead className="text-caption text-text-tertiary border-b border-border-default">
              <tr><th className="text-left p-1">이름</th><th className="text-left p-1">이메일</th><th className="text-left p-1">졸업년도</th><th className="text-left p-1">진학결과</th></tr>
            </thead>
            <tbody>
              {graduates.map((g) => (
                <tr key={g.id} className="border-t border-border-default">
                  <td className="p-1">{g.name}</td>
                  <td className="p-1 text-text-tertiary">{g.email}</td>
                  <td className="p-1">{g.graduation_year || "-"}</td>
                  <td className="p-1 text-caption">{g.results ? JSON.stringify(g.results).slice(0, 80) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
