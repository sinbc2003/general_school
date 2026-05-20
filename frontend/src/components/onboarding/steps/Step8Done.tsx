"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { api } from "@/lib/api/client";

export function Step8Done() {
  const [counts, setCounts] = useState<{
    departments: number;
    semesters: number;
    teachers: number;
    students: number;
  }>({ departments: 0, semesters: 0, teachers: 0, students: 0 });

  useEffect(() => {
    (async () => {
      try {
        const [d, s, t, st] = await Promise.all([
          api.get<any>("/api/departments"),
          api.get<any>("/api/timetable/semesters"),
          api.get<any>("/api/users?role=teacher,staff&limit=1"),
          api.get<any>("/api/users?role=student&limit=1"),
        ]);
        const departments = (d.items || []).length;
        const semesters = Array.isArray(s) ? s.length : (s.items || []).length;
        const teachers = t.total ?? t.count ?? (t.items || t.users || []).length;
        const students = st.total ?? st.count ?? (st.items || st.users || []).length;
        setCounts({ departments, semesters, teachers, students });
      } catch {}
    })();
  }, []);

  return (
    <div>
      <div className="text-center py-6 mb-6">
        <CheckCircle2 size={64} className="mx-auto text-emerald-500 mb-3" />
        <h2 className="text-[24px] font-bold text-text-primary mb-2">
          기본 셋업이 끝났습니다!
        </h2>
        <p className="text-body text-text-tertiary">
          이제 학교 플랫폼을 운영할 준비가 되었습니다.
        </p>
      </div>

      <div className="bg-bg-primary border border-border-default rounded-lg p-5 mb-5">
        <h3 className="text-body font-semibold text-text-primary mb-3">등록 현황</h3>
        <div className="grid grid-cols-2 gap-3">
          <SummaryCard label="부서" value={counts.departments} path="/system/departments" />
          <SummaryCard label="학기" value={counts.semesters} path="/system/semesters" />
          <SummaryCard label="교사·직원" value={counts.teachers} path="/users" />
          <SummaryCard label="학생" value={counts.students} path="/users" />
        </div>
      </div>

      <div className="bg-cream-100 border border-cream-200 rounded-lg p-4">
        <h3 className="text-body font-semibold text-text-primary mb-2">다음 단계</h3>
        <ul className="text-[13px] text-text-secondary space-y-1.5 ml-4 list-disc">
          <li>교사·학생에게 <strong>로그인 정보 안내</strong> (초기 비밀번호 = 연락처 또는 기본값, 첫 로그인 시 변경 강제)</li>
          <li><code className="text-accent">클래스룸</code>에서 수업 강좌를 만들고 자료·과제를 공유</li>
          <li><code className="text-accent">시간표</code>에서 학기별 시간표 등록 (선택)</li>
          <li><code className="text-accent">시스템 → AI 챗봇</code>에서 LLM API 키 설정 (선택)</li>
          <li>잘못 등록한 내용은 <strong>언제든 마법사 다시 보기</strong> 또는 해당 관리 페이지에서 수정 가능</li>
        </ul>
      </div>

      <div className="mt-5 text-[12px] text-text-tertiary text-center">
        <span className="text-accent">완료</span> 버튼을 누르면 마법사가 닫힙니다.
        대시보드 우상단 <strong>🧙</strong> 버튼으로 언제든 재실행 가능합니다.
      </div>
    </div>
  );
}

function SummaryCard({ label, value, path }: { label: string; value: number; path: string }) {
  return (
    <a
      href={path}
      target="_blank"
      rel="noopener"
      className="block bg-bg-secondary/40 border border-border-default rounded-md px-4 py-3 hover:bg-bg-secondary"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] text-text-tertiary">{label}</span>
        <ExternalLink size={11} className="text-text-tertiary" />
      </div>
      <div className="text-[24px] font-bold text-text-primary mt-1">{value}</div>
    </a>
  );
}
