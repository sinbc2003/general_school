"use client";

/** 업무 도구 잡 제출 + 폴링 훅 (PDF→HWPX / 번역 공용). */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";

export interface ToolJob {
  id: number;
  tool: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  progress: number;
  stage: string | null;
  title: string | null;
  input_filename: string | null;
  error: string | null;
  output_ready: boolean;
  output_file_url: string | null;
  result_meta: Record<string, any>;
  created_at: string | null;
  finished_at: string | null;
}

export function useToolJob() {
  const [job, setJob] = useState<ToolJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(
    (id: number) => {
      stop();
      pollRef.current = setInterval(async () => {
        try {
          const j = await api.get<ToolJob>(`/api/tools/office/jobs/${id}`);
          setJob(j);
          if (j.status === "completed" || j.status === "failed") stop();
        } catch (e: any) {
          setError(e?.detail || "상태 조회 실패");
          stop();
        }
      }, 1500);
    },
    [stop],
  );

  const submit = useCallback(
    async (path: string, formData: FormData) => {
      setError(null);
      setSubmitting(true);
      setJob(null);
      try {
        const j = await api.post<ToolJob>(path, formData);
        setJob(j);
        poll(j.id);
      } catch (e: any) {
        setError(e?.detail || "요청 실패");
      } finally {
        setSubmitting(false);
      }
    },
    [poll],
  );

  const reset = useCallback(() => {
    stop();
    setJob(null);
    setError(null);
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { job, submitting, error, submit, reset };
}
