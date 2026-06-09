"use client";

import { useEffect, useState } from "react";
import { Loader2, ClipboardList } from "lucide-react";
import { api } from "@/lib/api/client";

interface RecItem {
  name: string;
  content: string;
  char_count: number;
}
interface Rec {
  project_id: number;
  project: string;
  final_text: string | null;
  items: RecItem[];
}

export default function MyRecordsPage() {
  const [records, setRecords] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/api/record-writer/me/records")
      .then((d) => setRecords(Array.isArray(d) ? d : []))
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-12 text-center">
        <Loader2 size={20} className="animate-spin mx-auto text-text-tertiary" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-title text-text-primary mb-1">내 생활기록부</h1>
      <p className="text-caption text-text-tertiary mb-4">
        선생님이 공개한 생활기록부 초안입니다. 사실과 다른 내용이 있으면 담당 선생님께 알려주세요.
      </p>
      {records.length === 0 ? (
        <div className="p-12 text-center text-text-tertiary border border-dashed border-border-default rounded-lg">
          <ClipboardList size={32} className="mx-auto mb-2 opacity-50" />
          <div className="text-body">아직 공개된 생활기록부가 없습니다.</div>
        </div>
      ) : (
        <div className="space-y-5">
          {records.map((r) => (
            <div
              key={r.project_id}
              className="bg-bg-primary border border-border-default rounded-lg overflow-hidden"
            >
              <div className="px-4 py-2 bg-bg-secondary border-b border-border-default text-body font-semibold text-text-primary">
                {r.project}
              </div>
              <div className="divide-y divide-border-default">
                {r.items.map((it, i) => (
                  <div key={i} className="px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-caption font-medium text-accent">{it.name}</span>
                      <span className="text-[10px] text-text-tertiary">{it.char_count}자</span>
                    </div>
                    <p className="text-body text-text-primary whitespace-pre-wrap leading-relaxed">
                      {it.content}
                    </p>
                  </div>
                ))}
                {r.final_text && (
                  <div className="px-4 py-3 bg-cream-100/40">
                    <div className="text-caption font-medium text-amber-700 mb-1">종합의견</div>
                    <p className="text-body text-text-primary whitespace-pre-wrap leading-relaxed">
                      {r.final_text}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
