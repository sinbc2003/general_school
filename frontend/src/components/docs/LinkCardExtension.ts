/**
 * TipTap custom Node — 일반 링크의 OG 미리보기 카드.
 *
 * 사용:
 *   editor.chain().focus().setLinkCard({
 *     url, title, description, image, site_name,
 *   }).run();
 *
 * 직렬화: <a class="link-card" href="..." data-title="..." data-image="...">
 *           ...inline 본문 (제목 + 도메인 등)
 *         </a>
 * — Yjs sync 그대로 JSON으로 broadcast.
 *
 * 발표 모드(read-only)에서도 동일 클래스 → CSS로 렌더.
 */

import { mergeAttributes, Node } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    linkCard: {
      setLinkCard: (attrs: LinkCardAttrs) => ReturnType;
    };
  }
}

export interface LinkCardAttrs {
  url: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  site_name?: string | null;
}

export const LinkCard = Node.create({
  name: "linkCard",
  group: "block",
  atom: true,        // 안에 편집 X — 한 덩어리
  draggable: true,
  selectable: true,
  inline: false,

  addAttributes() {
    return {
      url: { default: "" },
      title: { default: "" },
      description: { default: "" },
      image: { default: "" },
      site_name: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[data-link-card="1"]',
        getAttrs: (el) => {
          const a = el as HTMLElement;
          return {
            url: a.getAttribute("href") || "",
            title: a.getAttribute("data-title") || "",
            description: a.getAttribute("data-description") || "",
            image: a.getAttribute("data-image") || "",
            site_name: a.getAttribute("data-site-name") || "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const url = HTMLAttributes.url || "#";
    const title = HTMLAttributes.title || url;
    const description = HTMLAttributes.description || "";
    const image = HTMLAttributes.image || "";
    const siteName = HTMLAttributes.site_name || "";

    // a 태그 — atom block. 본문은 단순 div 구조.
    const wrap = [
      "a",
      mergeAttributes(
        {
          "data-link-card": "1",
          href: url,
          target: "_blank",
          rel: "noopener noreferrer",
          class: "link-card",
          "data-title": title,
          "data-description": description,
          "data-image": image,
          "data-site-name": siteName,
        },
      ),
      // 본문 구조
      ["div", { class: "link-card__body" },
        image
          ? ["div", { class: "link-card__thumb", style: `background-image: url('${image}')` }]
          : ["div", { class: "link-card__thumb link-card__thumb--empty" }, "🔗"],
        ["div", { class: "link-card__text" },
          siteName ? ["div", { class: "link-card__site" }, siteName] : "",
          ["div", { class: "link-card__title" }, title],
          description ? ["div", { class: "link-card__desc" }, description] : "",
          ["div", { class: "link-card__url" }, url],
        ],
      ],
    ] as any;
    return wrap;
  },

  addCommands() {
    return {
      setLinkCard:
        (attrs: LinkCardAttrs) =>
        ({ chain }: any) =>
          chain().insertContent({ type: this.name, attrs }).run(),
    };
  },
});
