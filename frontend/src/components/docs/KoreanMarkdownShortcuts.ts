/**
 * 한국어 IME 대응 마크다운 단축어.
 *
 * TipTap StarterKit의 기본 inputRules는 일반 영문 입력에선 동작하지만,
 * 한국어 IME composition 후 confirmed text에는 trigger되지 않을 때가 있다.
 * 그래서 keydown space를 직접 가로채 cursor 앞 텍스트가 마크다운 prefix
 * 인지 확인하고 변환한다.
 *
 * 지원:
 *   # ___  → h1
 *   ## __  → h2
 *   ### _  → h3
 *   > ___  → blockquote
 *   - / *  → bullet list
 *   1.     → ordered list
 *   ```    → code block (lang 옵션 미적용)
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";


// 인라인 패턴 — 한국어 IME composition 종료 후 closing 마커가 들어오면 trigger.
// lookbehind로 marker 중복 충돌 회피 (** vs *).
const INLINE_RULES: Array<{ re: RegExp; mark: string; markerLen: number }> = [
  { re: /\*\*([^*\n]{1,200})\*\*$/, mark: "bold", markerLen: 2 },
  { re: /__([^_\n]{1,200})__$/, mark: "bold", markerLen: 2 },
  { re: /~~([^~\n]{1,200})~~$/, mark: "strike", markerLen: 2 },
  { re: /`([^`\n]{1,200})`$/, mark: "code", markerLen: 1 },
  { re: /(?<!\*)\*([^*\n]{1,200})\*$/, mark: "italic", markerLen: 1 },
  { re: /(?<!_)_([^_\n]{1,200})_$/, mark: "italic", markerLen: 1 },
];


export const KoreanMarkdownShortcuts = Extension.create({
  name: "koreanMarkdownShortcuts",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("koreanMarkdownShortcuts"),

        // 인라인 마크다운 — 텍스트 변경 후 cursor 앞 패턴 검사 + mark 적용
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const { $from, empty } = newState.selection;
          if (!empty) return null;
          if (!$from.parent.isTextblock) return null;
          if ($from.parent.type.name === "codeBlock") return null;

          const blockStart = $from.start();
          const end = $from.pos;
          const limit = Math.min(end - blockStart, 220);
          const text = newState.doc.textBetween(end - limit, end, "\n", "\n");

          for (const { re, mark, markerLen } of INLINE_RULES) {
            const m = text.match(re);
            if (!m) continue;
            const markType = newState.schema.marks[mark];
            if (!markType) continue;
            const inner = m[1];
            const fullLen = inner.length + 2 * markerLen;
            const matchStart = end - fullLen;
            if (matchStart < blockStart) continue;

            const tr = newState.tr;
            tr.delete(matchStart, end);
            tr.insertText(inner, matchStart);
            tr.addMark(matchStart, matchStart + inner.length, markType.create());
            // 다음 입력에 mark 누적 안 되게 stored mark 제거
            tr.removeStoredMark(markType);
            return tr;
          }
          return null;
        },

        props: {
          handleKeyDown(view, event) {
            // Space 또는 Enter 키 트리거
            if (event.key !== " " && event.key !== "Enter") return false;

            const { state } = view;
            const { $from, empty } = state.selection;
            if (!empty) return false;
            if (!$from.parent.isTextblock) return false;
            // 이미 heading/list/blockquote 등이면 그냥 통과
            const parentType = $from.parent.type.name;
            if (parentType !== "paragraph") return false;

            const start = $from.start();
            const text = state.doc.textBetween(start, $from.pos, "\n", "\n");

            // space 키 — heading / blockquote / list 변환
            if (event.key === " ") {
              // # ## ### → h1/h2/h3
              const hm = text.match(/^(#{1,3})$/);
              if (hm) {
                const level = hm[1].length;
                const headingType = state.schema.nodes.heading;
                if (!headingType) return false;
                const tr = state.tr
                  .delete(start, $from.pos)
                  .setBlockType(start, start, headingType, { level });
                view.dispatch(tr);
                event.preventDefault();
                return true;
              }
              // > → blockquote
              if (text === ">") {
                const bq = state.schema.nodes.blockquote;
                if (bq) {
                  const tr = state.tr.delete(start, $from.pos);
                  view.dispatch(tr);
                  // wrap 현재 paragraph in blockquote
                  const range = view.state.selection.$from.blockRange();
                  if (range) {
                    const wrapTr = view.state.tr.wrap(range, [{ type: bq }]);
                    view.dispatch(wrapTr);
                  }
                  event.preventDefault();
                  return true;
                }
              }
              // - 또는 * → bullet list
              if (text === "-" || text === "*") {
                const bl = state.schema.nodes.bulletList;
                const li = state.schema.nodes.listItem;
                if (bl && li) {
                  view.dispatch(state.tr.delete(start, $from.pos));
                  const range = view.state.selection.$from.blockRange();
                  if (range) {
                    const wrapTr = view.state.tr.wrap(range, [
                      { type: bl }, { type: li },
                    ]);
                    view.dispatch(wrapTr);
                  }
                  event.preventDefault();
                  return true;
                }
              }
              // 1. → ordered list
              if (text === "1.") {
                const ol = state.schema.nodes.orderedList;
                const li = state.schema.nodes.listItem;
                if (ol && li) {
                  view.dispatch(state.tr.delete(start, $from.pos));
                  const range = view.state.selection.$from.blockRange();
                  if (range) {
                    const wrapTr = view.state.tr.wrap(range, [
                      { type: ol }, { type: li },
                    ]);
                    view.dispatch(wrapTr);
                  }
                  event.preventDefault();
                  return true;
                }
              }
            }

            // Enter — ``` 후 enter → code block
            if (event.key === "Enter" && text === "```") {
              const cb = state.schema.nodes.codeBlock;
              if (cb) {
                const tr = state.tr
                  .delete(start, $from.pos)
                  .setBlockType(start, start, cb);
                view.dispatch(tr);
                event.preventDefault();
                return true;
              }
            }

            return false;
          },
        },
      }),
    ];
  },
});
