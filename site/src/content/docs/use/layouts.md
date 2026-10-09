---
title: Layouts
description: Where the pane goes, depending on your terminal's width, and the status line.
---

Claude Code decides where the pane goes, not the mod. It depends on the layout and how wide your terminal is.

| Where | What you see |
| --- | --- |
| Docked (fullscreen, ≥ 110 columns) | Room tabs, a FRIENDS card, and the room's messages as bubbles: yours on the right, theirs on the left, grouped by sender, with date labels and a **new** line where you stopped reading |
| Above the prompt (narrower) | The room, who's online, the last five messages and the input box |
| Pane closed | One line: the room, who's online, unread count, the latest message and **Open** |
| Status line | Unread counts per room, such as `💬 #team 3`, or `🔕 #team 3` during do not disturb. The built-in rooms add `◔ 85%` when the context is nearly full and `✗ CI` when this branch's checks fail, and nothing otherwise. |

<figure class="shot">
  <img src="/squad-chat/media/band.png" alt="The one-line summary above the prompt while the pane is closed" />
  <figcaption>The one-line summary above the prompt while the pane is closed.</figcaption>
</figure>

## Getting the docked layout

1. Switch Claude Code to its fullscreen layout with `/tui fullscreen`.
2. Make the terminal at least 110 columns wide.
3. Open the pane with `/chat`.
