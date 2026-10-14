// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://chrisluo5311.github.io",
  base: "/squad-chat",
  // Load the next page while the pointer is on its link, so clicks land instantly.
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  integrations: [
    starlight({
      title: "squad-chat",
      description: "The all-in-one Claude Code plugin. Talk with your squad, share code, and keep live rooms next to your session.",
      logo: { src: "./src/assets/logo.svg" },
      favicon: "/favicon.svg",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/chrisluo5311/squad-chat" },
      ],
      lastUpdated: true,
      // English at the root, Traditional Chinese under /zh-tw/. Starlight puts the
      // language picker in the header, and a page not yet translated shows the English.
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        "zh-tw": { label: "繁體中文", lang: "zh-TW" },
      },
      customCss: ["./src/styles/theme.css"],
      components: {
        Head: "./src/components/Head.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
        PageTitle: "./src/components/PageTitle.astro",
        Hero: "./src/components/Hero.astro",
        Pagination: "./src/components/Pagination.astro",
        LastUpdated: "./src/components/LastUpdated.astro",
      },
      expressiveCode: {
        themes: ["github-dark-default", "github-light-default"],
        styleOverrides: {
          borderRadius: "0.625rem",
          borderColor: "var(--sl-color-hairline-light)",
          codeFontFamily: "var(--__sl-font-mono)",
          codeFontSize: "0.8125rem",
          codeLineHeight: "1.75",
          frames: {
            editorBackground: "var(--sl-color-bg-code)",
            terminalBackground: "var(--sl-color-bg-code)",
            editorTabBarBackground: "var(--sl-color-bg-code-bar)",
            terminalTitlebarBackground: "var(--sl-color-bg-code-bar)",
            editorActiveTabBackground: "var(--sl-color-bg-code)",
            editorActiveTabIndicatorTopColor: "transparent",
            editorTabBarBorderBottomColor: "var(--sl-color-hairline-light)",
            terminalTitlebarBorderBottomColor: "var(--sl-color-hairline-light)",
            frameBoxShadowCssValue: "none",
          },
        },
      },
      head: [
        { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" } },
        { tag: "link", attrs: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" } },
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap",
          },
        },
      ],
      sidebar: [
        {
          label: "Start",
          translations: { "zh-TW": "開始" },
          items: [
            { label: "Overview", translations: { "zh-TW": "總覽" }, link: "/" },
            { slug: "start/install" },
            { slug: "start/connect" },
          ],
        },
        {
          label: "Use",
          translations: { "zh-TW": "使用" },
          items: [
            { slug: "use/first-run" },
            { slug: "use/commands" },
            { slug: "use/built-in-rooms" },
            { slug: "use/layouts" },
            { slug: "use/desktop" },
            { slug: "use/two-accounts" },
          ],
        },
        {
          label: "Rooms",
          translations: { "zh-TW": "房間" },
          items: [{ slug: "rooms/store" }, { slug: "rooms/write-a-room" }],
        },
        {
          label: "Host",
          translations: { "zh-TW": "架設" },
          items: [{ slug: "host/server" }, { slug: "host/email-sign-in" }],
        },
        {
          label: "Reference",
          translations: { "zh-TW": "參考" },
          items: [
            { slug: "reference/privacy" },
            { slug: "reference/architecture" },
            { slug: "reference/development" },
            { slug: "reference/roadmap" },
          ],
        },
      ],
    }),
  ],
});
