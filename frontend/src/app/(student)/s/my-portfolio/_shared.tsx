"use client";

/**
 * 학생 본인 포트폴리오 페이지 공유 타입 + 작은 UI helper.
 *
 * 4개 탭 (timeline/artifacts/assignments/clubs) + main page가 import.
 */

import { Folder } from "lucide-react";

export interface Artifact {
  id: number;
  title: string;
  description: string | null;
  category: string;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  external_link: string | null;
  tags: string[];
  is_public: boolean;
  created_at: string | null;
}

export interface AssignmentSubmission {
  id: number;
  assignment_id: number;
  assignment_title: string;
  subject: string;
  filename: string | null;
  file_size: number | null;
  status: string;
  submitted_at: string | null;
  review_comment: string | null;
  show_in_portfolio: boolean;
}

export interface ClubSubmission {
  id: number;
  club_id: number;
  club_name: string;
  title: string;
  submission_type: string;
  file_path: string | null;
  created_at: string | null;
}

export interface TimelineItem {
  type: "artifact" | "assignment_submission" | "club_submission";
  id: number;
  title: string;
  date: string | null;
  // 공통 외 분기 필드들
  category?: string;
  description?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  is_public?: boolean;
  subject?: string;
  filename?: string | null;
  status?: string;
  review_comment?: string | null;
  show_in_portfolio?: boolean;
  club_name?: string;
  submission_type?: string;
  file_path?: string | null;
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";


export function StatCard({ label, value, icon: Icon, accent = false }: any) {
  return (
    <div className={`bg-bg-primary border ${accent ? "border-accent" : "border-border-default"} rounded-lg p-3`}>
      <div className="flex items-center gap-2 text-caption text-text-tertiary mb-1">
        <Icon size={14} /> {label}
      </div>
      <div className={`text-title ${accent ? "text-accent" : "text-text-primary"}`}>{value}</div>
    </div>
  );
}


export function EmptyState({ text }: { text: string }) {
  return (
    <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg py-10 text-center">
      <Folder size={28} className="mx-auto text-text-tertiary mb-2" />
      <div className="text-body text-text-tertiary">{text}</div>
    </div>
  );
}
