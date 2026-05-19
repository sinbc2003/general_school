"use client";

/**
 * 단축 링크 해석 + redirect.
 *
 * - 익명 OK — /q/{slug}/resolve가 인증 없이 target_type+id 반환
 * - 인증 안 된 상태면 로그인 후 다시 오게 ?next= 보존
 * - 인증된 상태면 role/target에 맞는 페이지로 redirect
 *   · survey: /classroom/{cid}/surveys/{sid} (admin/teacher)
 *            /s/classroom/{cid}/surveys/{sid} (student)
 *   · document: 협업 문서 페이지로 (마찬가지)
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, AlertCircle, LogIn } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

interface ResolveResult {
  slug: string;
  target_type: "survey" | "document";
  target_id: number;
}

export default function ShortLinkPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: isLoading } = useAuth();
  const slug = String(params.slug || "");

  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<ResolveResult | null>(null);

  useEffect(() => {
    // resolve는 익명 OK — Authorization 없이 호출
    fetch(`${API_URL}/q/${encodeURIComponent(slug)}/resolve`)
      .then(async (res) => {
        if (res.status === 404) {
          setError("이 단축 링크를 찾을 수 없습니다. 잘못된 주소이거나 삭제된 링크입니다.");
          return null;
        }
        if (res.status === 410) {
          setError("만료된 단축 링크입니다.");
          return null;
        }
        if (!res.ok) {
          setError(`서버 오류 (${res.status})`);
          return null;
        }
        return (await res.json()) as ResolveResult;
      })
      .then((data) => {
        if (data) setTarget(data);
      })
      .catch((e) => setError(`연결 실패: ${e?.message || e}`));
  }, [slug]);

  useEffect(() => {
    if (!target || isLoading) return;
    if (!user) return; // 로그인 안 됨 — 아래 안내 화면

    const courseSurveyOrDoc = async () => {
      try {
        const isStudent = user.role === "student";
        if (target.target_type === "survey") {
          const surveyApi = `${API_URL}/api/classroom/surveys/${target.target_id}`;
          const token = localStorage.getItem("access_token");
          const res = await fetch(surveyApi, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) {
            setError(`설문 조회 실패 (${res.status}) — 접근 권한이 없을 수 있습니다.`);
            return;
          }
          const s = await res.json();
          const cid = s.course_id;
          if (cid) {
            const path = isStudent
              ? `/s/classroom/${cid}/surveys/${target.target_id}`
              : `/classroom/${cid}/surveys/${target.target_id}`;
            router.replace(path);
            return;
          }
          // 단독 설문 (course_id 없음) — 현재 단독 페이지 미구현. 일단 admin path 시도.
          router.replace(`/classroom/0/surveys/${target.target_id}`);
        } else if (target.target_type === "document") {
          const docApi = `${API_URL}/api/classroom/docs/${target.target_id}`;
          const token = localStorage.getItem("access_token");
          const res = await fetch(docApi, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) {
            setError(`문서 조회 실패 (${res.status})`);
            return;
          }
          const d = await res.json();
          const cid = d.course_id;
          if (cid) {
            const path = isStudent
              ? `/s/classroom/${cid}/docs/${target.target_id}`
              : `/classroom/${cid}/docs/${target.target_id}`;
            router.replace(path);
            return;
          }
          setError("강좌 외 문서는 현재 단축 링크로 접근할 수 없습니다.");
        }
      } catch (e: any) {
        setError(`처리 중 오류: ${e?.message || e}`);
      }
    };
    courseSurveyOrDoc();
  }, [target, user, isLoading, router]);

  // ─── UI ─────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <AlertCircle size={48} className="text-status-error mx-auto mb-4" />
          <h1 className="text-title font-semibold mb-2">접근할 수 없습니다</h1>
          <p className="text-body text-text-secondary mb-4">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-2 text-caption bg-accent text-white rounded hover:bg-accent-hover"
          >
            홈으로
          </button>
        </div>
      </div>
    );
  }

  if (!target) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={32} className="text-accent mx-auto mb-3 animate-spin" />
          <div className="text-caption text-text-secondary">단축 링크 확인 중...</div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={32} className="text-accent animate-spin" />
      </div>
    );
  }

  if (!user) {
    // 로그인 안 됨 — 로그인 페이지로 보내고, 끝나면 다시 여기로
    const next = encodeURIComponent(`/q/${slug}`);
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <LogIn size={48} className="text-accent mx-auto mb-4" />
          <h1 className="text-title font-semibold mb-2">로그인이 필요합니다</h1>
          <p className="text-body text-text-secondary mb-4">
            이 링크의 콘텐츠를 보려면 학교 계정으로 로그인하세요.
          </p>
          <button
            onClick={() => router.push(`/auth/login?next=${next}`)}
            className="px-6 py-2 text-body bg-accent text-white rounded hover:bg-accent-hover inline-flex items-center gap-1"
          >
            <LogIn size={14} /> 로그인
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <Loader2 size={32} className="text-accent mx-auto mb-3 animate-spin" />
        <div className="text-caption text-text-secondary">이동 중...</div>
      </div>
    </div>
  );
}
