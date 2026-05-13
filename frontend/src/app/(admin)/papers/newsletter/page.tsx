"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { Mail, FileText, Calendar } from "lucide-react";

export default function NewsletterPage() {
  const [approvedCount, setApprovedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .get("/api/papers?status=approved&page=1&page_size=1")
      .then((data) => {
        setApprovedCount(data.total);
      })
      .catch(() => {
        setApprovedCount(0);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">뉴스레터</h1>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <div className="flex items-center gap-3">
            <div className="text-status-success">
              <FileText size={24} />
            </div>
            <div>
              <div className="text-caption text-text-tertiary">승인된 논문</div>
              <div className="text-body font-semibold text-text-primary">
                {loading ? "-" : `${approvedCount ?? 0}편`}
              </div>
            </div>
          </div>
        </div>
        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <div className="flex items-center gap-3">
            <div className="text-accent">
              <Mail size={24} />
            </div>
            <div>
              <div className="text-caption text-text-tertiary">발행 횟수</div>
              <div className="text-body font-semibold text-text-primary">
                0회
              </div>
            </div>
          </div>
        </div>
        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <div className="flex items-center gap-3">
            <div className="text-status-warning">
              <Calendar size={24} />
            </div>
            <div>
              <div className="text-caption text-text-tertiary">다음 발행</div>
              <div className="text-body font-semibold text-text-primary">
                미정
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 안내 */}
      <div className="bg-bg-primary rounded-lg border border-border-default p-6">
        <h2 className="text-body font-semibold text-text-primary mb-3">
          뉴스레터 기능 안내
        </h2>
        <p className="text-body text-text-secondary mb-4">
          승인된 논문을 선별하여 주간/월간 뉴스레터를 발행할 수 있습니다.
        </p>
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 bg-bg-secondary rounded">
            <span className="text-accent font-semibold text-caption mt-0.5">
              1
            </span>
            <div>
              <div className="text-body text-text-primary font-medium">
                논문 승인
              </div>
              <div className="text-caption text-text-tertiary">
                수집 논문 페이지에서 뉴스레터에 포함할 논문을 승인합니다.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-bg-secondary rounded">
            <span className="text-accent font-semibold text-caption mt-0.5">
              2
            </span>
            <div>
              <div className="text-body text-text-primary font-medium">
                뉴스레터 구성
              </div>
              <div className="text-caption text-text-tertiary">
                승인된 논문 중 발행할 논문을 선택하고 요약을 편집합니다.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-bg-secondary rounded">
            <span className="text-accent font-semibold text-caption mt-0.5">
              3
            </span>
            <div>
              <div className="text-body text-text-primary font-medium">
                발행
              </div>
              <div className="text-caption text-text-tertiary">
                구성된 뉴스레터를 확인 후 발행합니다.
              </div>
            </div>
          </div>
        </div>
        <p className="text-caption text-text-tertiary mt-4">
          뉴스레터 자동 생성 및 발행 기능은 추후 업데이트 예정입니다.
        </p>
      </div>
    </div>
  );
}
