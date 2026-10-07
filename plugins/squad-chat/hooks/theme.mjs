// squad-chat's look: a warm "classic" palette (coral accent, amber, sky, leaf
// green on the terminal's own background), with grey card borders and meta
// text from the person's theme. Fixed hex colors, so the accents read the
// same in every theme.

export const theme = {
  accent: "#D97757",       // coral: title, active tab, you, focused input, "new"
  onAccent: "#1F1E1D",     // text drawn on the accent
  amber: "#E2B86B",        // secondary highlight: unread badges, the band's "new"
  sky: "#7FB6E2",          // informational dots
  online: "#6CC070",       // online, live
  border: "inactive",      // card borders
  muted: "subtle",         // meta text: times, counts, hints
  warn: "#E2B86B",
  error: "#E06C75",
};

// Warm, distinct name colors; coral is kept for "you".
const NAME_COLORS = ["#E2B86B", "#7FB6E2", "#6CC070", "#C8A2E0", "#E58FA8", "#6FC2B5", "#D9A877", "#9DB4F0"];

// The same person always gets the same color, in every pane.
export function nameColor(userId = "") {
  let h = 0;
  for (const ch of String(userId)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}

export const glyph = {
  brand: "◆",
  on: "●",
  off: "○",
  prompt: "›",
  rule: "─",
  bar: "│",
};
