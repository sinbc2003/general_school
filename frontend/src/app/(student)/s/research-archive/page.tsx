"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, FlaskConical, Users, Calendar, BookOpen } from "lucide-react";
import { api } from "@/lib/api/client";

interface Research {
  id: number;
  title: string;
  research_type: string;
  description: string;
  year: number;
  semester: number | null;
  status: string;
  advisor_name: string | null;
  members: string[];
  created_at: string | null;
}

export default function ResearchArchivePage() {
  const [items, setItems] = useState<Research[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [yearFilter, setYearFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [selected, setSelected] = useState<Research | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (keyword) params.set("keyword", keyword);
      if (yearFilter) params.set("year", yearFilter);
      if (typeFilter) params.set("research_type", typeFilter);
      const data = await api.get(`/api/me/research/browse?${params}`);
      setItems(data.items);
    } catch {} finally { setLoading(false); }
  }, [keyword, yearFilter, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const years = Array.from(new Set(items.map((r) => r.year))).sort((a, b) => b - a);
  const types = Array.from(new Set(items.map((r) => r.research_type)));

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setKeyword(searchInput);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-180px)]">
      {/* 좌측 목록 */}
      <aside className="lg:w-96 flex-shrink-0 flex flex-col">
        <h1 className="text-title text-text-primary mb-1">과거 연구 자료</h1>
        <p className="text-caption text-text-tertiary mb-3">
          졸업생·재학생의 완료된 연구를 열람하여 진로 탐색과 연구 주제 결정에 활용하세요.
        </p>

        {/* 검색 */}
        <form onSubmit={submitSearch} className="flex gap-1 mb-2">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="제목 검색"
            className="flex-1 px-3 py-1.5 border border-border-default rounded text-body"
          />
          <button type="submit" className="px-3 py-1.5 bg-accent text-white rounded text-caption">
            <Search size={14} />
          </button>
        </form>
        <div className="flex gap-1 mb-3">
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}
                  className="flex-1 px-2 py-1 border border-border-default rounded text-caption">
            <option value="">전체 연도</option>
            {years.map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
                  className="flex-1 px-2 py-1 border border-border-default rounded text-caption">
            <option value="">전체 유형</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto bg-bg-primary border border-border-default rounded-lg">
          {loading ? (
            <div className="p-4 text-text-tertiary">로딩 중...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-text-tertiary">
              <FlaskConical size={32} className="mx-auto mb-2 opacity-50" />
              <div className="text-body">조회된 연구가 없습니다</div>
            </div>
          ) : (
            items.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelected(r)}
                className={`w-full text-left px-4 py-3 border-b border-border-default hover:bg-bg-secondary ${
                  selected?.id === r.id ? "bg-accent-light" : ""
                }`}
              >
                <div className="text-body font-medium text-text-primary line-clamp-2">{r.title}</div>
                <div className="text-caption text-text-tertiary mt-1 flex items-center gap-2 flex-wrap">
                  <span className="px-1.5 py-0.5 bg-bg-secondary rounded text-[10px]">{r.research_type}</span>
                  <span><Calendar size={10} className="inline mr-1" />{r.year}년</span>
                  {r.advisor_name && <span>지도: {r.advisor_name}</span>}
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* 우측 상세 */}
      <main className="flex-1 min-w-0">
        {selected ? (
          <div className="bg-bg-primary border border-border-default rounded-lg p-6 h-full overflow-y-auto">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 bg-accent-light text-accent text-caption rounded">
                {selected.research_type}
              </span>
              <span className="text-caption text-text-tertiary">{selected.year}년</span>
              {selected.semester && <span className="text-caption text-text-tertiary">{selected.semester}학기</span>}
              <span className="ml-auto px-2 py-0.5 bg-status-success-light text-status-success text-caption rounded">
                {selected.status === "completed" ? "완료" : selected.status}
              </span>
            </div>
            <h2 className="text-title text-text-primary mb-3">{selected.title}</h2>

            <div className="space-y-4">
              {selected.advisor_name && (
                <DetailRow label="지도교사" value={selected.advisor_name} />
              )}
              {selected.members && selected.members.length > 0 && (
                <DetailRow label="연구원" value={(selected.members as any[]).map((m: any) =>
                  typeof m === "string" ? m : (m.name || m.username || "")
                ).filter(Boolean).join(", ")} />
              )}

              {selected.description && (
                <div>
                  <h3 className="text-body font-semibold text-text-primary mb-1 flex items-center gap-1">
                    <BookOpen size={14} className="text-accent" /> 연구 개요
                  </h3>
                  <p className="text-body text-text-secondary whitespace-pre-wrap leading-relaxed">
                    {selected.description}
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 pt-4 border-t border-border-default text-caption text-text-tertiary">
              ※ 과거 연구는 진로 탐색·연구 주제 참고용으로 제공됩니다. 무단 복제·표절은 금지됩니다.
            </div>
          </div>
        ) : (
          <div className="bg-bg-primary border-2 border-dashed border-border-default rounded-lg h-full flex items-center justify-center">
            <div className="text-center text-text-tertiary">
              <FlaskConical size={40} className="mx-auto mb-3 opacity-50" />
              <div className="text-body">좌측에서 연구를 선택하세요</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex">
      <div className="w-24 text-caption text-text-tertiary flex-shrink-0">{label}</div>
      <div className="text-body text-text-primary">{value}</div>
    </div>
  );
}
