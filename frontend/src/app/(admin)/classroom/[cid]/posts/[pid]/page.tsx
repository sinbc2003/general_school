"use client";

/**
 * 과제·자료 상세 (관리자·교사).
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { PostDetailView, type PostDetail } from "@/components/classroom/PostDetailView";

export default function CoursePostDetailAdminPage() {
  const params = useParams();
  const router = useRouter();
  const cid = Number(params.cid);
  const pid = Number(params.pid);

  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = await api.get<PostDetail>(`/api/classroom/posts/${pid}`);
      setPost(p);
    } catch (e: any) {
      alert(e?.detail || "글 조회 실패");
      router.push(`/classroom/${cid}`);
    } finally {
      setLoading(false);
    }
  }, [cid, pid, router]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-text-tertiary">로딩 중...</div>;
  if (!post) return null;

  return <PostDetailView post={post} baseHref="/classroom" />;
}
