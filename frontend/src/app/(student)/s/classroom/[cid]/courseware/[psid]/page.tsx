"use client";

/**
 * 학생 문제 풀이 페이지.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { StudentSolveView } from "@/components/courseware/StudentSolveView";

export default function StudentSolvePage() {
  const params = useParams();
  const cid = Number(params.cid);
  const psid = Number(params.psid);

  return (
    <div className="space-y-3">
      <Link
        href={`/s/classroom/${cid}`}
        className="inline-flex items-center gap-1 text-caption text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft size={14} /> 강좌로 돌아가기
      </Link>
      <StudentSolveView psid={psid} />
    </div>
  );
}
