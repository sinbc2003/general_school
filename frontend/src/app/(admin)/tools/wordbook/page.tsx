"use client";

/**
 * 단어장 — 교사용 홈. 본인 덱 목록 + 새 덱 만들기.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookA, Plus, X, Loader2, ChevronLeft, Globe, Lock } from "lucide-react";
import { api } from "@/lib/api/client";

interface DeckItem {
  id: number;
  title: string;
  description?: string | null;
  lang_pair: string;
  is_public: boolean;
  card_count: number;
  updated_at: string | null;
}

export default function WordbookHomePage() {
  const router = useRouter();
  const [decks, setDecks] = useState<DeckItem[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ items: DeckItem[] }>("/api/tools/wordbook/decks");
      setDecks(res.items || []);
    } catch {
      setDecks([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            href="/tools"
            className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary mb-1"
          >
            <ChevronLeft size={14} /> 도구 모음
          </Link>
          <h1 className="text-title font-semibold flex items-center gap-2">
            <BookA size={22} className="text-sky-600" /> 단어장
          </h1>
          <p className="text-caption text-text-tertiary mt-1">
            단어 덱을 만들고 학생들이 플래시카드·4지선다·스펠 타이핑으로 학습합니다
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-body font-medium"
        >
          <Plus size={16} /> 새 단어장
        </button>
      </div>

      {decks === null && (
        <div className="flex items-center justify-center py-16 text-text-tertiary">
          <Loader2 size={18} className="animate-spin mr-2" /> 불러오는 중...
        </div>
      )}

      {decks && decks.length === 0 && (
        <div className="text-center py-16 border border-dashed border-border-default rounded-xl">
          <BookA size={40} className="mx-auto mb-3 text-text-tertiary opacity-40" />
          <div className="text-body text-text-secondary">아직 단어장이 없습니다.</div>
        </div>
      )}

      {decks && decks.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {decks.map((d) => (
            <button
              key={d.id}
              onClick={() => router.push(`/tools/wordbook/${d.id}`)}
              className="text-left border border-border-default rounded-xl p-4 bg-bg-primary hover:border-sky-300 hover:shadow-sm transition"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-body font-semibold truncate flex-1">{d.title}</span>
                {d.is_public
                  ? <Globe size={13} className="text-emerald-600 flex-shrink-0" />
                  : <Lock size={13} className="text-text-tertiary flex-shrink-0" />}
              </div>
              {d.description && (
                <div className="text-caption text-text-tertiary line-clamp-2 mb-2">{d.description}</div>
              )}
              <div className="text-caption text-text-secondary">
                {d.card_count}개 단어 · {d.lang_pair}
              </div>
            </button>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateDeckModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => router.push(`/tools/wordbook/${id}`)}
        />
      )}
    </div>
  );
}

function CreateDeckModal({
  onClose, onCreated,
}: { onClose: () => void; onCreated: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [langPair, setLangPair] = useState("en-ko");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const res = await api.post<{ id: number }>("/api/tools/wordbook/decks", {
        title: title.trim(),
        description: description.trim() || null,
        lang_pair: langPair,
      });
      onCreated(res.id);
    } catch (e: any) {
      alert(e?.detail || "생성 실패");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-bg-primary rounded-lg shadow-2xl w-full max-w-sm">
        <header className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <h2 className="text-body font-medium">새 단어장</h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-secondary rounded">
            <X size={16} />
          </button>
        </header>
        <div className="p-5 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="단어장 이름*"
            autoFocus
            className="w-full px-3 py-2 border border-border-default rounded text-body outline-none focus:border-sky-500"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="설명 (선택)"
            className="w-full px-3 py-2 border border-border-default rounded text-body outline-none focus:border-sky-500"
          />
          <select
            value={langPair}
            onChange={(e) => setLangPair(e.target.value)}
            className="w-full px-3 py-2 border border-border-default rounded text-body bg-bg-primary"
          >
            <option value="en-ko">영어 → 한국어</option>
            <option value="ko-en">한국어 → 영어</option>
            <option value="ja-ko">일본어 → 한국어</option>
            <option value="zh-ko">중국어 → 한국어</option>
            <option value="etc">기타</option>
          </select>
        </div>
        <footer className="px-5 py-3 border-t border-border-default flex justify-end">
          <button
            onClick={create}
            disabled={!title.trim() || saving}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white rounded-lg text-body font-medium"
          >
            {saving ? "생성 중..." : "만들기"}
          </button>
        </footer>
      </div>
    </div>
  );
}
