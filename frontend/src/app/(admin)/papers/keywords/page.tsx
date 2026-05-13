"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/client";
import { Plus, X, Tag } from "lucide-react";

interface Keyword {
  id: number;
  keyword: string;
  category: string;
  is_active: boolean;
  paper_count: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  math: "bg-blue-100 text-blue-700 border-blue-200",
  ai: "bg-purple-100 text-purple-700 border-purple-200",
  education: "bg-green-100 text-green-700 border-green-200",
  science: "bg-orange-100 text-orange-700 border-orange-200",
  default: "bg-gray-100 text-gray-700 border-gray-200",
};

export default function KeywordsPage() {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newKeyword, setNewKeyword] = useState("");
  const [newCategory, setNewCategory] = useState("");

  const fetchKeywords = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/papers/keywords");
      setKeywords(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeywords();
  }, [fetchKeywords]);

  const handleCreate = async () => {
    if (!newKeyword.trim() || !newCategory.trim()) return;
    try {
      await api.post("/api/papers/keywords", {
        keyword: newKeyword.trim(),
        category: newCategory.trim(),
      });
      setNewKeyword("");
      setNewCategory("");
      setShowForm(false);
      fetchKeywords();
    } catch (err: any) {
      alert(err?.detail || "키워드 추가 실패");
    }
  };

  const handleToggle = async (kw: Keyword) => {
    try {
      await api.put(`/api/papers/keywords/${kw.id}`, {
        is_active: !kw.is_active,
      });
      fetchKeywords();
    } catch (err: any) {
      alert(err?.detail || "상태 변경 실패");
    }
  };

  const handleDelete = async (kw: Keyword) => {
    if (!confirm(`"${kw.keyword}" 키워드를 삭제하시겠습니까?`)) return;
    try {
      await api.delete(`/api/papers/keywords/${kw.id}`);
      fetchKeywords();
    } catch (err: any) {
      alert(err?.detail || "삭제 실패");
    }
  };

  const getCategoryColor = (category: string) =>
    CATEGORY_COLORS[category] || CATEGORY_COLORS.default;

  const categories = Array.from(new Set(keywords.map((k) => k.category)));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-title text-text-primary">키워드 관리</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-1 px-3 py-1.5 text-caption bg-accent text-white rounded hover:opacity-90"
        >
          <Plus size={14} />
          키워드 추가
        </button>
      </div>

      {/* 추가 폼 */}
      {showForm && (
        <div className="mb-6 p-4 bg-bg-primary rounded-lg border border-border-default">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-caption text-text-tertiary mb-1">
                키워드
              </label>
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                placeholder="예: transformer, attention"
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div className="flex-1">
              <label className="block text-caption text-text-tertiary mb-1">
                카테고리
              </label>
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="예: ai, math, education"
                className="w-full px-3 py-1.5 text-body border border-border-default rounded bg-bg-primary focus:outline-none focus:border-accent"
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={!newKeyword.trim() || !newCategory.trim()}
              className="px-4 py-1.5 text-body bg-accent text-white rounded hover:opacity-90 disabled:opacity-40"
            >
              추가
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-body border border-border-default rounded hover:bg-bg-secondary"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 통계 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <div className="text-caption text-text-tertiary">전체 키워드</div>
          <div className="text-body font-semibold text-text-primary">
            {keywords.length}개
          </div>
        </div>
        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <div className="text-caption text-text-tertiary">활성 키워드</div>
          <div className="text-body font-semibold text-status-success">
            {keywords.filter((k) => k.is_active).length}개
          </div>
        </div>
        <div className="bg-bg-primary rounded-lg border border-border-default p-4">
          <div className="text-caption text-text-tertiary">카테고리</div>
          <div className="text-body font-semibold text-text-primary">
            {categories.length}개
          </div>
        </div>
      </div>

      {/* 카테고리별 키워드 칩 */}
      {loading ? (
        <div className="text-center py-8 text-body text-text-tertiary">
          로딩 중...
        </div>
      ) : keywords.length === 0 ? (
        <div className="text-center py-8 text-body text-text-tertiary">
          등록된 키워드가 없습니다
        </div>
      ) : (
        <div className="space-y-6">
          {categories.map((cat) => (
            <div key={cat}>
              <h2 className="text-body font-semibold text-text-primary mb-3 flex items-center gap-2">
                <Tag size={16} />
                {cat}
              </h2>
              <div className="flex flex-wrap gap-2">
                {keywords
                  .filter((k) => k.category === cat)
                  .map((kw) => (
                    <div
                      key={kw.id}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-caption ${
                        kw.is_active
                          ? getCategoryColor(cat)
                          : "bg-gray-50 text-gray-400 border-gray-200"
                      }`}
                    >
                      <span
                        className="cursor-pointer"
                        onClick={() => handleToggle(kw)}
                        title={
                          kw.is_active
                            ? "클릭하여 비활성화"
                            : "클릭하여 활성화"
                        }
                      >
                        {kw.keyword}
                      </span>
                      <span className="text-[10px] opacity-60">
                        {kw.paper_count}편
                      </span>
                      <button
                        onClick={() => handleDelete(kw)}
                        className="hover:text-status-error"
                        title="삭제"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
