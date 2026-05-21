"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import {
  Plus, X, Award, FileText, MessageSquare, BarChart3, BookOpen,
  Notebook, Briefcase, Target, Eye, Globe, ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { DataTable } from "@/components/ui/DataTable";
import { downloadSecure } from "@/lib/api/download";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

export function CareerTab({ studentId }: { studentId: number }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get(`/api/students/${studentId}/career-plans`)
      .then((d) => setItems(d.items || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [studentId]);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (items.length === 0) {
    return (
      <div className="py-8 text-center text-text-tertiary border-2 border-dashed border-border-default rounded-lg">
        학생이 작성한 진로 설계가 없습니다
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map((p) => (
        <div key={p.id} className="bg-bg-primary border border-border-default rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Target size={16} className="text-accent" />
            <span className="text-body font-semibold">{p.year}년 진로 설계</span>
            {!p.is_active && <span className="text-caption text-text-tertiary">(비활성)</span>}
            <span className="ml-auto text-caption text-text-tertiary">
              최종 수정 {(p.updated_at || "").slice(0, 10)}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-body">
            <div>
              <div className="text-caption text-text-secondary mb-1">희망 진로 분야</div>
              <div>{p.desired_field || "-"}</div>
            </div>
            <div>
              <div className="text-caption text-text-secondary mb-1">장래 직업</div>
              <div>{p.career_goal || "-"}</div>
            </div>
          </div>
          {(p.target_universities || []).length > 0 && (
            <div className="mt-3">
              <div className="text-caption text-text-secondary mb-1">희망 대학</div>
              <div className="flex flex-wrap gap-1">
                {p.target_universities.map((u: any, i: number) => (
                  <span key={i} className="px-2 py-0.5 bg-accent-light text-accent text-caption rounded">
                    {u.university || u.name} {u.major ? `· ${u.major}` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}
          {p.academic_plan && (
            <div className="mt-3">
              <div className="text-caption text-text-secondary mb-1">학업 계획</div>
              <div className="whitespace-pre-wrap text-body">{p.academic_plan}</div>
            </div>
          )}
          {p.activity_plan && (
            <div className="mt-3">
              <div className="text-caption text-text-secondary mb-1">활동 계획</div>
              <div className="whitespace-pre-wrap text-body">{p.activity_plan}</div>
            </div>
          )}
          {p.motivation && (
            <div className="mt-3">
              <div className="text-caption text-text-secondary mb-1">진학 동기 / 자기소개 초안</div>
              <div className="whitespace-pre-wrap text-body">{p.motivation}</div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

