"use client";

/**
 * 단어장 — 교사용 덱 편집 페이지.
 *
 * 탭 2개: [단어 편집] (카드 인라인 CRUD + CSV 가져오기 + 공개 토글)
 *        [학습] (StudyView — 학생과 동일 화면 미리보기 + 교사 본인 학습)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  BookA, ChevronLeft, Loader2, Plus, Trash2, Upload, Download,
  Globe, Lock, GraduationCap, Pencil, Check, X,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { StudyView } from "@/components/wordbook/StudyView";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8002";

interface Card { id: number; term: string; meaning: string; example?: string | null }
interface DeckDetail {
  id: number;
  title: string;
  description?: string | null;
  lang_pair: string;
  is_public: boolean;
  cards: Card[];
}

export default function WordbookEditPage() {
  const params = useParams<{ did: string }>();
  const router = useRouter();
  const did = Number(params.did);

  const [deck, setDeck] = useState<DeckDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"edit" | "study">("edit");

  // 새 카드 입력
  const [nTerm, setNTerm] = useState("");
  const [nMeaning, setNMeaning] = useState("");
  const [nExample, setNExample] = useState("");
  const [adding, setAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<DeckDetail>(`/api/tools/wordbook/decks/${did}`);
      setDeck(res);
    } catch (e: any) {
      setError(e?.detail || "단어장을 불러올 수 없습니다");
    }
  }, [did]);

  useEffect(() => { load(); }, [load]);

  const addCard = async () => {
    if (!nTerm.trim() || !nMeaning.trim() || adding) return;
    setAdding(true);
    try {
      await api.post(`/api/tools/wordbook/decks/${did}/cards`, {
        term: nTerm.trim(), meaning: nMeaning.trim(),
        example: nExample.trim() || null,
      });
      setNTerm(""); setNMeaning(""); setNExample("");
      await load();
    } catch (e: any) {
      alert(e?.detail || "추가 실패");
    } finally {
      setAdding(false);
    }
  };

  const deleteCard = async (cid: number) => {
    try {
      await api.delete(`/api/tools/wordbook/cards/${cid}`);
      await load();
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  const togglePublic = async () => {
    if (!deck) return;
    try {
      await api.put(`/api/tools/wordbook/decks/${did}`, { is_public: !deck.is_public });
      await load();
    } catch (e: any) {
      alert(e?.detail || "변경 실패");
    }
  };

  const deleteDeck = async () => {
    if (!confirm("단어장을 삭제할까요? 학생 학습 기록도 함께 삭제됩니다.")) return;
    try {
      await api.delete(`/api/tools/wordbook/decks/${did}`);
      router.push("/tools/wordbook");
    } catch (e: any) {
      alert(e?.detail || "삭제 실패");
    }
  };

  const importCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImporting(true);
    try {
      const res = await api.upload<{ added: number; skipped: number }>(
        `/api/tools/wordbook/decks/${did}/cards/_import`, f,
      );
      alert(`${res.added}개 추가${res.skipped ? `, ${res.skipped}행 건너뜀` : ""}`);
      await load();
    } catch (err: any) {
      alert(err?.detail || "가져오기 실패");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const downloadTemplate = async () => {
    try {
      const token = localStorage.getItem("access_token");
      const r = await fetch(`${API_URL}/api/tools/wordbook/csv-template`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "wordbook_template.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* */ }
  };

  if (error) {
    return (
      <div className="p-10 text-center">
        <div className="text-body text-status-error mb-3">{error}</div>
        <Link href="/tools/wordbook" className="text-caption underline">목록으로</Link>
      </div>
    );
  }
  if (!deck) {
    return (
      <div className="flex items-center justify-center py-24 text-text-tertiary">
        <Loader2 size={20} className="animate-spin mr-2" /> 불러오는 중...
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="min-w-0">
          <Link
            href="/tools/wordbook"
            className="inline-flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary mb-1"
          >
            <ChevronLeft size={14} /> 단어장 목록
          </Link>
          <h1 className="text-title font-semibold flex items-center gap-2">
            <BookA size={20} className="text-sky-600" /> {deck.title}
            <span className="text-caption font-normal text-text-tertiary">
              {deck.cards.length}개
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={togglePublic}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-caption border transition ${
              deck.is_public
                ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                : "bg-bg-primary border-border-default text-text-secondary hover:bg-bg-secondary"
            }`}
            title="공개하면 모든 학생이 단어장 홈에서 학습할 수 있습니다"
          >
            {deck.is_public ? <Globe size={14} /> : <Lock size={14} />}
            {deck.is_public ? "공개" : "비공개"}
          </button>
          <button
            onClick={deleteDeck}
            className="inline-flex items-center gap-1 px-3 py-1.5 border border-border-default rounded-lg text-caption text-text-secondary hover:bg-red-50 hover:text-red-600 hover:border-red-300"
          >
            <Trash2 size={13} /> 삭제
          </button>
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 border-b border-border-default mb-5">
        {([["edit", "단어 편집", Pencil], ["study", "학습", GraduationCap]] as const).map(
          ([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-body border-b-2 -mb-px transition ${
                tab === key
                  ? "border-sky-600 text-sky-700 font-medium"
                  : "border-transparent text-text-tertiary hover:text-text-primary"
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          ),
        )}
      </div>

      {tab === "study" ? (
        <StudyView deckId={did} />
      ) : (
        <div>
          {/* CSV */}
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border-default rounded-lg text-caption hover:bg-bg-secondary disabled:opacity-50"
            >
              {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              CSV 가져오기
            </button>
            <button
              onClick={downloadTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border-default rounded-lg text-caption hover:bg-bg-secondary"
            >
              <Download size={13} /> 양식 받기
            </button>
            <span className="text-[11px] text-text-tertiary">열: 단어, 뜻, 예문(선택)</span>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={importCsv} className="hidden" />
          </div>

          {/* 새 카드 추가 행 */}
          <div className="grid grid-cols-[1fr_1fr_1.2fr_auto] gap-2 mb-3">
            <input
              value={nTerm}
              onChange={(e) => setNTerm(e.target.value)}
              placeholder="단어"
              className="px-3 py-2 border border-border-default rounded text-body outline-none focus:border-sky-500"
            />
            <input
              value={nMeaning}
              onChange={(e) => setNMeaning(e.target.value)}
              placeholder="뜻"
              className="px-3 py-2 border border-border-default rounded text-body outline-none focus:border-sky-500"
            />
            <input
              value={nExample}
              onChange={(e) => setNExample(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addCard(); }}
              placeholder="예문 (선택)"
              className="px-3 py-2 border border-border-default rounded text-body outline-none focus:border-sky-500"
            />
            <button
              onClick={addCard}
              disabled={!nTerm.trim() || !nMeaning.trim() || adding}
              className="px-3 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white rounded inline-flex items-center gap-1 text-caption font-medium"
            >
              <Plus size={14} /> 추가
            </button>
          </div>

          {/* 카드 목록 */}
          {deck.cards.length === 0 ? (
            <div className="text-center py-12 text-text-tertiary text-caption border border-dashed border-border-default rounded-xl">
              위에서 단어를 추가하거나 CSV로 가져오세요.
            </div>
          ) : (
            <ul className="border border-border-default rounded-xl divide-y divide-border-default bg-bg-primary">
              {deck.cards.map((c, i) => (
                <CardRow key={c.id} card={c} index={i} onChanged={load} onDelete={() => deleteCard(c.id)} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CardRow({
  card, index, onChanged, onDelete,
}: { card: Card; index: number; onChanged: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [term, setTerm] = useState(card.term);
  const [meaning, setMeaning] = useState(card.meaning);
  const [example, setExample] = useState(card.example || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!term.trim() || !meaning.trim() || saving) return;
    setSaving(true);
    try {
      await api.put(`/api/tools/wordbook/cards/${card.id}`, {
        term: term.trim(), meaning: meaning.trim(), example: example.trim() || null,
      });
      setEditing(false);
      onChanged();
    } catch (e: any) {
      alert(e?.detail || "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <li className="grid grid-cols-[2rem_1fr_1fr_1.2fr_auto] gap-2 items-center px-3 py-2">
        <span className="text-caption text-text-tertiary font-mono">{index + 1}</span>
        <input value={term} onChange={(e) => setTerm(e.target.value)} className="px-2 py-1 border border-sky-400 rounded text-body outline-none" autoFocus />
        <input value={meaning} onChange={(e) => setMeaning(e.target.value)} className="px-2 py-1 border border-sky-400 rounded text-body outline-none" />
        <input value={example} onChange={(e) => setExample(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }} className="px-2 py-1 border border-sky-400 rounded text-body outline-none" />
        <div className="flex items-center gap-1">
          <button onClick={save} disabled={saving} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded"><Check size={15} /></button>
          <button onClick={() => setEditing(false)} className="p-1.5 text-text-tertiary hover:bg-bg-secondary rounded"><X size={15} /></button>
        </div>
      </li>
    );
  }

  return (
    <li className="grid grid-cols-[2rem_1fr_1fr_1.2fr_auto] gap-2 items-center px-3 py-2 group hover:bg-bg-secondary">
      <span className="text-caption text-text-tertiary font-mono">{index + 1}</span>
      <span className="text-body font-medium truncate">{card.term}</span>
      <span className="text-body text-text-secondary truncate">{card.meaning}</span>
      <span className="text-caption text-text-tertiary truncate italic">{card.example || ""}</span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
        <button onClick={() => setEditing(true)} className="p-1.5 text-text-tertiary hover:bg-bg-primary rounded" title="수정"><Pencil size={14} /></button>
        <button onClick={onDelete} className="p-1.5 text-text-tertiary hover:text-red-600 hover:bg-bg-primary rounded" title="삭제"><Trash2 size={14} /></button>
      </div>
    </li>
  );
}
