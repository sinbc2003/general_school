"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api/client";
import {
  ClipboardList,
  ArrowLeft,
  Calendar,
  Upload,
  CheckCircle,
  FileText,
} from "lucide-react";

interface Assignment {
  id: number;
  title: string;
  description?: string;
  due_date?: string;
  status?: string;
  subject?: string;
  created_at?: string;
}

interface AssignmentDetail extends Assignment {
  content?: string;
  max_score?: number;
  attachments?: string[];
}

export default function AssignmentPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedAssignment, setSelectedAssignment] =
    useState<AssignmentDetail | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pageSize = 10;

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(
        `/api/assignment?page=${page}&page_size=${pageSize}`
      );
      setAssignments(data.items || data || []);
      setTotal(data.total || 0);
    } catch {
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  const openAssignment = async (id: number) => {
    try {
      const data = await api.get(`/api/assignment/${id}`);
      setSelectedAssignment(data);
      setUploadSuccess(false);
    } catch {
      alert("과제 정보를 불러올 수 없습니다.");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedAssignment) return;
    setUploading(true);
    try {
      await api.upload(`/api/assignment/${selectedAssignment.id}/submit`, file);
      setUploadSuccess(true);
    } catch {
      alert("파일 업로드에 실패했습니다.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const getStatusStyle = (status?: string) => {
    switch (status) {
      case "pending":
      case "active":
        return "bg-blue-50 text-blue-600";
      case "submitted":
        return "bg-green-50 text-green-600";
      case "graded":
        return "bg-purple-50 text-purple-600";
      case "overdue":
        return "bg-red-50 text-red-600";
      default:
        return "bg-gray-100 text-gray-500";
    }
  };

  const getStatusLabel = (status?: string) => {
    switch (status) {
      case "pending":
        return "대기";
      case "active":
        return "진행중";
      case "submitted":
        return "제출완료";
      case "graded":
        return "채점완료";
      case "overdue":
        return "기한초과";
      default:
        return status || "-";
    }
  };

  const isDueSoon = (dueDate?: string) => {
    if (!dueDate) return false;
    const diff = new Date(dueDate).getTime() - Date.now();
    return diff > 0 && diff < 3 * 24 * 60 * 60 * 1000; // 3 days
  };

  const totalPages = Math.ceil(total / pageSize);

  // Detail view
  if (selectedAssignment) {
    return (
      <div>
        <button
          onClick={() => setSelectedAssignment(null)}
          className="flex items-center gap-1 text-caption text-accent mb-4"
        >
          <ArrowLeft size={16} />
          돌아가기
        </button>

        <div className="bg-bg-primary rounded-lg border border-border-default p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            {selectedAssignment.subject && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                {selectedAssignment.subject}
              </span>
            )}
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full ${getStatusStyle(
                selectedAssignment.status
              )}`}
            >
              {getStatusLabel(selectedAssignment.status)}
            </span>
          </div>
          <h1 className="text-title text-text-primary mb-2">
            {selectedAssignment.title}
          </h1>
          {selectedAssignment.description && (
            <p className="text-body text-text-secondary mb-3">
              {selectedAssignment.description}
            </p>
          )}
          {selectedAssignment.content && (
            <div className="text-body text-text-primary whitespace-pre-wrap mb-3 pt-3 border-t border-border-default">
              {selectedAssignment.content}
            </div>
          )}
          <div className="flex items-center gap-4 text-caption text-text-tertiary">
            {selectedAssignment.due_date && (
              <span
                className={`flex items-center gap-1 ${
                  isDueSoon(selectedAssignment.due_date) ? "text-red-500" : ""
                }`}
              >
                <Calendar size={12} />
                마감:{" "}
                {new Date(selectedAssignment.due_date).toLocaleString("ko-KR")}
              </span>
            )}
            {selectedAssignment.max_score && (
              <span>배점: {selectedAssignment.max_score}점</span>
            )}
          </div>
        </div>

        {/* File Upload */}
        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <h3 className="text-body font-semibold text-text-primary mb-3">
            과제 제출
          </h3>
          {uploadSuccess ? (
            <div className="text-center py-4">
              <CheckCircle size={32} className="mx-auto text-green-500 mb-2" />
              <p className="text-body text-text-primary font-medium">
                제출 완료!
              </p>
              <p className="text-caption text-text-tertiary">
                과제가 성공적으로 제출되었습니다.
              </p>
              <button
                onClick={() => setUploadSuccess(false)}
                className="mt-3 text-caption text-accent"
              >
                다시 제출하기
              </button>
            </div>
          ) : (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileUpload}
                className="hidden"
                id="assignment-upload"
              />
              <label
                htmlFor="assignment-upload"
                className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 cursor-pointer transition ${
                  uploading
                    ? "border-accent bg-accent/5"
                    : "border-border-default hover:border-accent"
                }`}
              >
                {uploading ? (
                  <>
                    <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mb-2" />
                    <span className="text-body text-text-secondary">
                      업로드 중...
                    </span>
                  </>
                ) : (
                  <>
                    <Upload size={32} className="text-text-tertiary mb-2" />
                    <span className="text-body text-text-secondary">
                      파일을 선택하세요
                    </span>
                    <span className="text-caption text-text-tertiary mt-1">
                      클릭하여 파일 업로드
                    </span>
                  </>
                )}
              </label>
            </div>
          )}
        </div>
      </div>
    );
  }

  // List view
  return (
    <div>
      <h1 className="text-title text-text-primary mb-4">과제</h1>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-bg-primary rounded-lg border border-border-default p-4 animate-pulse"
            >
              <div className="h-5 bg-bg-secondary rounded w-2/3 mb-2" />
              <div className="h-3 bg-bg-secondary rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : assignments.length === 0 ? (
        <div className="bg-bg-primary rounded-lg border border-border-default p-8 text-center">
          <ClipboardList size={32} className="mx-auto text-text-tertiary mb-2" />
          <p className="text-body text-text-tertiary">등록된 과제가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {assignments.map((a) => (
            <button
              key={a.id}
              onClick={() => openAssignment(a.id)}
              className="w-full text-left bg-bg-primary rounded-lg border border-border-default p-4 hover:border-accent transition"
            >
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-accent flex-shrink-0" />
                  <h3 className="text-body font-medium text-text-primary">
                    {a.title}
                  </h3>
                </div>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full flex-shrink-0 ml-2 ${getStatusStyle(
                    a.status
                  )}`}
                >
                  {getStatusLabel(a.status)}
                </span>
              </div>
              {a.description && (
                <p className="text-caption text-text-secondary line-clamp-1 ml-6 mb-1">
                  {a.description}
                </p>
              )}
              {a.due_date && (
                <div
                  className={`flex items-center gap-1 ml-6 text-caption ${
                    isDueSoon(a.due_date)
                      ? "text-red-500"
                      : "text-text-tertiary"
                  }`}
                >
                  <Calendar size={11} />
                  마감: {new Date(a.due_date).toLocaleDateString("ko-KR")}
                  {isDueSoon(a.due_date) && " (마감 임박)"}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 rounded border border-border-default text-caption text-text-secondary disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-caption text-text-secondary">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 rounded border border-border-default text-caption text-text-secondary disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
