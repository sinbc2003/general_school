"use client";

/**
 * 학생 선택 모달 — 등록된 전교생 명단에서 다중 선택.
 *
 * 학번 직접입력 대신 **명단 기반 선택**이 기본. 학년/반 필터 + 이름·아이디 검색 +
 * "현재 목록 전체 선택"으로 학급/학년 단위 일괄 등록을 지원한다.
 * (붙여넣기가 편한 사용자를 위해 학번 직접입력 보조 입력도 접어둔 형태로 제공)
 *
 * 데이터 소스: `GET /api/users/peers?role=student`
 *   — 모든 교사/관리자 호출 가능. `/api/users`(list_users)와 달리 `user.manage.view`
 *     권한이 없어도 동작하므로 권한 없는 교사도 본인 강좌에 학생을 붙일 수 있다.
 *
 * 재사용: 클래스룸 수강생 등록, 연구담당 매핑 등 "학생 명단 선택"이 필요한 모든 곳.
 *
 * onConfirm(userIds)        — 선택 확정 시 호출(부모가 실제 등록 API 처리). 성공 시 모달 자동 닫힘.
 * onConfirmNumbers(numbers) — (선택) 학번 붙여넣기 등록 지원 시. 미지정이면 붙여넣기 UI 숨김.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Loader2, Check, Users, ChevronDown } from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { api } from "@/lib/api/client";

interface StudentRow {
  id: number;
  name: string;
  username?: string | null;
  grade?: number | null;
  class_number?: number | null;
  student_number?: number | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 이미 등록된 학생 user_id — 목록에서 "등록됨"으로 비활성 표시 */
  excludedUserIds?: number[];
  /** 선택 확정 — 부모가 실제 등록 처리 후 resolve. resolve되면 모달 자동 닫힘 */
  onConfirm: (userIds: number[]) => Promise<void>;
  /** (선택) 학번 목록 붙여넣기 등록. 지정 시 하단에 접힌 보조 입력 노출 */
  onConfirmNumbers?: (studentNumbers: number[]) => Promise<void>;
  title?: string;
  confirmLabel?: string;
}

const PER_PAGE = 1000;

/** 5자리 학번 표기 (1학년 1반 1번 → 10101). 값 누락 시 빈 문자열. */
function fmtNo(g?: number | null, c?: number | null, n?: number | null): string {
  if (!g || !c || !n) return "";
  return `${g}${String(c).padStart(2, "0")}${String(n).padStart(2, "0")}`;
}

export function StudentPickerModal({
  open, onClose, excludedUserIds = [], onConfirm, onConfirmNumbers,
  title = "학생 선택", confirmLabel = "추가",
}: Props) {
  const [grade, setGrade] = useState<number | "">("");
  const [classNumber, setClassNumber] = useState<number | "">("");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const excluded = useMemo(() => new Set(excludedUserIds), [excludedUserIds]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ role: "student", per_page: String(PER_PAGE) });
      if (grade !== "") p.set("grade", String(grade));
      if (classNumber !== "") p.set("class_number", String(classNumber));
      if (search.trim()) p.set("search", search.trim());
      const r = await api.get<{ items: StudentRow[] }>(`/api/users/peers?${p}`);
      // 학년·반·번호 순 정렬 (명단 순서대로 보이도록)
      const sorted = (r.items || []).slice().sort((a, b) =>
        (a.grade ?? 99) - (b.grade ?? 99) ||
        (a.class_number ?? 99) - (b.class_number ?? 99) ||
        (a.student_number ?? 9999) - (b.student_number ?? 9999) ||
        a.name.localeCompare(b.name, "ko"));
      setResults(sorted);
    } catch {
      setResults([]);
    } finally { setLoading(false); }
  }, [grade, classNumber, search]);

  // 열려있을 때만 로드. 필터 변경 즉시, 검색어는 250ms 디바운스.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
  }, [open, load]);

  // 닫히면 상태 초기화 (다음 오픈 시 깨끗하게)
  useEffect(() => {
    if (open) return;
    setSelected(new Set());
    setSearch(""); setGrade(""); setClassNumber("");
    setPasteOpen(false); setPasteText("");
  }, [open]);

  const selectable = useMemo(
    () => results.filter((u) => !excluded.has(u.id)),
    [results, excluded],
  );

  const allSelected = selectable.length > 0 && selectable.every((u) => selected.has(u.id));

  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const toggleAll = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allSelected) selectable.forEach((u) => next.delete(u.id));
    else selectable.forEach((u) => next.add(u.id));
    return next;
  });

  // onConfirm 성공 시 자동 닫힘. 실패 시 부모가 에러 토스트 책임 → 여기선 삼켜 모달 유지.
  const confirmSelection = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await onConfirm(Array.from(selected));
      onClose();
    } catch { /* 부모가 토스트 처리. 모달은 열린 채 재시도 가능 */ }
    finally { setSaving(false); }
  };

  const confirmPaste = async () => {
    if (!onConfirmNumbers) return;
    const numbers = pasteText
      .split(/[,\s\n]+/).map((s) => s.trim()).filter(Boolean)
      .map(Number).filter((n) => !isNaN(n));
    if (numbers.length === 0) return;
    setSaving(true);
    try {
      await onConfirmNumbers(numbers);
      onClose();
    } catch { /* 부모가 토스트 처리 */ }
    finally { setSaving(false); }
  };

  const selCls = "px-2 py-1.5 text-caption border border-border-default rounded bg-bg-primary";

  return (
    <Modal open={open} onClose={onClose} title={title} icon={<Users size={16} />} maxWidth="lg" dismissable={!saving}>
      {/* 필터 row */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <select value={grade} onChange={(e) => setGrade(e.target.value ? Number(e.target.value) : "")} className={selCls}>
          <option value="">전체 학년</option>
          {[1, 2, 3].map((g) => <option key={g} value={g}>{g}학년</option>)}
        </select>
        <select value={classNumber} onChange={(e) => setClassNumber(e.target.value ? Number(e.target.value) : "")} className={selCls}>
          <option value="">전체 반</option>
          {Array.from({ length: 15 }, (_, i) => i + 1).map((c) => <option key={c} value={c}>{c}반</option>)}
        </select>
        <div className="relative flex-1 min-w-[140px]">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·아이디 검색"
            className="w-full pl-7 pr-2 py-1.5 text-caption border border-border-default rounded bg-bg-primary outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* 전체 선택 / 선택 수 */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button" onClick={toggleAll} disabled={selectable.length === 0}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11.5px] bg-accent/10 text-accent border border-accent/30 rounded hover:bg-accent/20 disabled:opacity-40"
        >
          <Check size={12} /> {allSelected ? "전체 해제" : `현재 목록 전체 선택 (${selectable.length})`}
        </button>
        <span className="text-caption text-text-tertiary">선택 {selected.size}명</span>
      </div>

      {/* 명단 list */}
      <div className="border border-border-default rounded bg-bg-primary max-h-[360px] overflow-y-auto">
        {loading ? (
          <div className="px-3 py-8 text-caption text-text-tertiary inline-flex items-center gap-2">
            <Loader2 size={12} className="animate-spin" /> 불러오는 중...
          </div>
        ) : results.length === 0 ? (
          <div className="px-3 py-8 text-caption text-text-tertiary text-center">
            {search.trim() || grade !== "" || classNumber !== "" ? "조건에 맞는 학생이 없습니다" : "등록된 학생이 없습니다"}
          </div>
        ) : (
          results.map((u) => {
            const isExcluded = excluded.has(u.id);
            const isSel = selected.has(u.id);
            const no = fmtNo(u.grade, u.class_number, u.student_number);
            return (
              <button
                key={u.id} type="button"
                onClick={() => !isExcluded && toggle(u.id)}
                disabled={isExcluded || saving}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left border-b border-border-default last:border-b-0 ${
                  isExcluded ? "opacity-50 cursor-not-allowed" : "hover:bg-bg-secondary"
                }`}
              >
                <span className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                  isSel ? "bg-accent border-accent" : "border-border-default"
                }`}>
                  {isSel && <Check size={11} className="text-white" />}
                </span>
                <span className="min-w-0 flex-1 truncate text-body text-text-primary">
                  {u.name}
                  {no && <span className="text-[11px] text-text-tertiary ml-2">{no}</span>}
                  {u.username && <span className="text-[11px] text-text-tertiary ml-2">{u.username}</span>}
                </span>
                {isExcluded && <span className="flex-shrink-0 text-[11px] text-text-tertiary">등록됨</span>}
              </button>
            );
          })
        )}
      </div>
      {results.length >= PER_PAGE && (
        <p className="mt-1.5 text-[11px] text-text-tertiary">
          최대 {PER_PAGE}명까지 표시됩니다. 학년·반으로 범위를 좁혀 주세요.
        </p>
      )}

      {/* 학번 직접 붙여넣기 (보조) */}
      {onConfirmNumbers && (
        <div className="mt-3 border-t border-border-default pt-3">
          <button
            type="button" onClick={() => setPasteOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-caption text-text-secondary hover:text-text-primary"
          >
            <ChevronDown size={13} className={`transition-transform ${pasteOpen ? "" : "-rotate-90"}`} />
            학번 목록으로 추가 (붙여넣기)
          </button>
          {pasteOpen && (
            <div className="mt-2 space-y-2">
              <textarea
                value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={4}
                placeholder="5자리 학번을 쉼표·공백·줄바꿈으로 구분&#10;예: 20315, 20316, 20317"
                className="w-full px-3 py-2 border border-border-default rounded bg-bg-primary font-mono text-caption resize-y"
              />
              <button
                type="button" onClick={confirmPaste} disabled={saving || !pasteText.trim()}
                className="px-3 py-1.5 text-caption border border-border-default rounded hover:bg-bg-secondary disabled:opacity-50"
              >
                이 학번들 등록
              </button>
            </div>
          )}
        </div>
      )}

      <ModalFooter>
        <button onClick={onClose} disabled={saving} className="px-4 py-1.5 text-caption border border-border-default rounded">
          취소
        </button>
        <button
          onClick={confirmSelection} disabled={saving || selected.size === 0}
          className="inline-flex items-center gap-1 px-4 py-1.5 text-caption bg-accent text-white rounded disabled:opacity-50"
        >
          {saving ? "등록 중..." : `선택한 ${selected.size}명 ${confirmLabel}`}
        </button>
      </ModalFooter>
    </Modal>
  );
}
