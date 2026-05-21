"use client";

/**
 * @deprecated 응답은 빌더 페이지의 "응답" 탭으로 통합됨.
 * 이 페이지는 기존 링크/북마크 호환을 위해 자동 리다이렉트만 한다.
 */

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function SurveyResultsRedirect() {
  const params = useParams();
  const router = useRouter();
  const cid = Number(params.cid);
  const sid = Number(params.sid);

  useEffect(() => {
    router.replace(`/classroom/${cid}/surveys/${sid}?tab=responses`);
  }, [cid, sid, router]);

  return (
    <div className="text-text-tertiary p-6">응답 탭으로 이동 중...</div>
  );
}
