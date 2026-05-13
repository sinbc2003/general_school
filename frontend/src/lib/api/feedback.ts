import { api } from "./client";

export interface FeedbackItem {
  id: number;
  feedback_type: string;
  content: string;
  status: string;
  admin_note: string | null;
  created_at: string;
}

export function createFeedback(body: {
  feedback_type: string;
  content: string;
  page_url?: string;
}) {
  return api.post("/api/feedback", body);
}

export async function getMyFeedback(): Promise<{ items: FeedbackItem[] }> {
  return api.get("/api/feedback/mine");
}
