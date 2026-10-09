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
      description: "Claude's cooking. Chat with your squad. Friends online, right beside your Claude Code session.",
      logo: { src: "./src/assets/logo.svg" },
      favicon: "/favicon.svg",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/chrisluo5311/squad-chat" },
      ],
      editLink: {
        baseUrl: "https://github.com/chrisluo5311/squad-chat/edit/main/site/",
      },
      lastUpdated: true,
      customCss: ["./src/styles/theme.css"],
      components: {
        Head: "./src/components/Head.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
        PageTitle: "./src/components/PageTitle.astro",
        Hero: "./src/components/Hero.astro",
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
          items: [
            { label: "Overview", link: "/" },
            { slug: "start/install" },
            { slug: "start/connect" },
          ],
        },
        {
          label: "Use",
          items: [
            { slug: "use/first-run" },
            { slug: "use/commands" },
            { slug: "use/built-in-rooms" },
            { slug: "use/layouts" },
            { slug: "use/two-accounts" },
          ],
        },
        {
          label: "Host",
          items: [{ slug: "host/server" }, { slug: "host/email-sign-in" }],
        },
        {
          label: "Reference",
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
