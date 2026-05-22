"use client";

/**
 * 강좌 Stream(게시판) 탭 — Google Classroom 식 좌측 위젯 + 우측 main grid.
 *
 * composer key remount는 부모(page.tsx)에서 관리 — `composerKey`/`postFormInitType`를
 * props로 받아 PostComposer가 새 instance로 마운트되도록 (drafting 초기화).
 */

import { MessageSquare } from "lucide-react";
import { PostComposer, type PostType } from "@/components/classroom/PostComposer";
import { CourseInfoWidget } from "@/components/classroom/CourseInfoWidget";
import { PostStreamCard } from "@/components/classroom/PostStreamCard";
import type { Post } from "./types";

interface Props {
  cid: number;
  posts: Post[];
  canEdit: boolean;
  // 좌측 위젯용 강좌 메타
  subject: string;
  className: string | null;
  teacherName: string | undefined;
  studentCount: number;
  // composer
  userName?: string;
  userId?: number;
  composerKey: number;
  postFormInitType: PostType;
  onComposerSubmit: (body: any) => Promise<void>;
  // post 액션
  onDeletePost: (pid: number) => void;
  onEditPost: (p: Post) => void;
  onDuplicatePost: (p: Post) => void;
}

export function StreamTab({
  cid, posts, canEdit,
  subject, className, teacherName, studentCount,
  userName, userId, composerKey, postFormInitType, onComposerSubmit,
  onDeletePost, onEditPost, onDuplicatePost,
}: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <aside className="lg:col-span-1 order-2 lg:order-1">
        <CourseInfoWidget
          cid={cid}
          subject={subject}
          className={className}
          teacherName={teacherName}
          studentCount={studentCount}
          baseHref="/classroom"
          showTeacher={true}
        />
      </aside>

      <main className="lg:col-span-2 space-y-3 order-1 lg:order-2">
        {canEdit && (
          <PostComposer
            key={`composer-${composerKey}`}
            userName={userName}
            userId={userId}
            initType={postFormInitType}
            initOpen={composerKey > 0}
            onSubmit={onComposerSubmit}
          />
        )}

        {posts.length === 0 ? (
          <div className="bg-bg-primary border border-dashed border-border-default rounded-lg py-12 text-center text-caption text-text-tertiary">
            <MessageSquare size={28} className="mx-auto mb-2 opacity-30" />
            아직 작성된 글이 없습니다
          </div>
        ) : (
          <div className="space-y-2">
            {posts.map((p) => (
              <PostStreamCard
                key={p.id}
                post={p}
                baseHref="/classroom"
                canEdit={canEdit}
                onDelete={(pid) => onDeletePost(pid)}
                onEdit={(pid) => {
                  const post = posts.find((x) => x.id === pid);
                  if (post) onEditPost(post);
                }}
                onDuplicate={(pid) => {
                  const post = posts.find((x) => x.id === pid);
                  if (post) onDuplicatePost(post);
                }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
