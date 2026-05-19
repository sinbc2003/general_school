/**
 * TipTap v3 FontSize 확장 — TextStyle mark에 fontSize 속성을 추가.
 *
 * 공식 v3 deps에는 FontSize extension이 없어 community 패턴으로 직접 구현.
 * TextStyle.extend로 fontSize attribute 정의 + setFontSize/unsetFontSize commands.
 *
 * 사용:
 *   editor.chain().focus().setFontSize("16px").run();
 *   editor.chain().focus().unsetFontSize().run();
 */

import { TextStyle } from "@tiptap/extension-text-style";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

/**
 * NOTE: name을 그대로 두는 게 중요 — TextStyle("textStyle") mark의 attr 확장임.
 * name을 바꾸면 별개 mark로 등록되어 fontFamily/color/fontSize가 분리됨.
 */
export const TextStyleWithSize = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) =>
          el.style.fontSize?.replace(/['"]+/g, "") || null,
        renderHTML: (attrs: { fontSize?: string | null }) => {
          if (!attrs.fontSize) return {};
          return { style: `font-size: ${attrs.fontSize}` };
        },
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setFontSize:
        (size: string) =>
        ({ chain }: any) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }: any) =>
          chain()
            .setMark("textStyle", { fontSize: null })
            .removeEmptyTextStyle()
            .run(),
    };
  },
});
