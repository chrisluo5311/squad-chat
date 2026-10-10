---
title: Write a room
description: A room is one JSON file. How to write one, try it, and put it in the store.
---

A room is one file, `room.json`: what it's called, which of squad-chat's providers feed it, the hosts they may reach, its settings, and how its cards look. There's no code in it, and there can't be. That's what lets anyone install a room without trusting whoever wrote it. If what you want needs a provider squad-chat doesn't have, open an issue or a pull request for the provider itself.

## A first room

```json
{
  "schema": 1,
  "id": "rust-blog",
  "version": "1.0.0",
  "minSquadChat": "0.15.0",
  "name": "Rust Blog",
  "icon": "⚙",
  "color": "sand",
  "description": "New posts from the Rust blog.",
  "author": "you",
  "permissions": { "hosts": ["blog.rust-lang.org"] },
  "settings": {
    "feeds": { "type": "list", "label": "Feeds", "item": "url", "max": 4, "default": ["https://blog.rust-lang.org/feed.xml"] }
  },
  "providers": [
    { "id": "feeds", "type": "rss", "params": { "feeds": "$settings.feeds" }, "interval": { "visible": "30m", "background": "2h" } }
  ],
  "layout": {
    "cards": [
      { "title": "POSTS", "meta": "{feeds.count}", "body": { "type": "list", "items": "feeds.items", "title": "title", "preview": "meta", "copy": "url", "share": "share" } }
    ],
    "band": "{feeds.items.0.title}"
  }
}
```

## Try it

1. Put it at `~/.config/squad-chat/rooms/<id>/room.json`. The folder's name must be the room's id.
2. Run `/reload-plugins` (or restart Claude Code), then `/chat rooms +<id>` and `/chat <id>`.
3. If it doesn't show, the reason is in the debug log (`claude --debug`), on a line that starts `squad-chat: room … skipped`.

## The fields

| Field | What it is |
| --- | --- |
| `schema` | Always `1`. |
| `id` | 2-24 lowercase letters, digits or `-`, starting with a letter. Not one squad-chat ships. |
| `version` | Like `1.0.0`. Raise it with each change, so `/chat update` offers it. |
| `minSquadChat` | The oldest squad-chat it works with: `0.15.0` or newer, the first with the store. |
| `name`, `icon`, `color` | Up to 20 characters, one character, and one of `sky`, `leaf`, `lilac`, `amber`, `coral`, `rose`, `teal`, `sand`. |
| `description`, `author` | What it is, in up to 200 characters, and who wrote it. |
| `permissions.hosts` | Every host its providers may reach, up to 10. A provider can't reach anything else, and installing shows this list. |
| `settings` | Up to 8 settings, changed with `/chat set <room> <setting> <value>`: `list` (`"item": "url"` for links, which must stay on the room's hosts), `enum` (`values`), `string`, `bool` or `int` (`min`, `max`), each with a `default`. |
| `providers` | Up to 4: an `id` (used in the layout's paths), a `type`, `params` (a setting as `"$settings.<key>"`), and an `interval` (`visible` while the room is on show, `background` otherwise, at least `1s`). |
| `layout` | `cards` (1-6), and optionally `inline`, `band`, `snapshot`, `hint`, `placeholder` and `keys`. |

## Providers

| Type | Params | What its data holds |
| --- | --- | --- |
| `rss` | `feeds`: feed URLs on the room's hosts | `items[]` (`title`, `url`, `source`, `meta`, `share`), `count`, `failed` |
| `hn` | `list` (`top`, `best`, `new`, `off`), `count` | `items[]` as `rss`, `count`, `list` |
| `open-meteo` | `cities`, `units` (`metric` or `imperial`) | `cities[]` (`name`, `icon`, `desc`, `tempText`, `range`, `rainText`, `aqiText`, …), `first`, `days[]`, `updated` |
| `quotes` | `watchlist`, `colors` (`market`, `red-up`, `green-up`), `move` | `quotes[]` (`symbol`, `name`, `priceText`, `pctText`, `arrow`, `color`, `spark`, `volText`, `when`), `markets`, `band`, `note`, `updated` |
| `local-list` | `max` | `items[]` (`id`, `name`, `lang`, `body`), `count` |
| `sysinfo` | `alerts`, `cpu_temp`, `memory` | `cpu`, `mem`, `gpu`, `net`, `disk`, `battery`, `band`, … (see the Monitor room's manifest) |
| `player` | `stations`, `volume` | `now`, `entries[]`, `band`, `share` (see the Lo-fi room's manifest) |

Each provider can reach only the hosts it knows about, and only where the manifest names them too. `rss` reads whatever feeds it's given, so for it the manifest's list alone decides. The rooms squad-chat ships, in [`plugins/squad-chat/rooms/`](https://github.com/chrisluo5311/squad-chat/tree/main/plugins/squad-chat/rooms), are full examples of each.

## Widgets

A card has a `title`, an optional `meta` and `when` (show the card only while that path has data), and a `body`: one widget, or a list of up to 6.

| Widget | Fields |
| --- | --- |
| `list` | `items` (a path to a list), `title`, and optionally `tag`, `preview`, `copy` (⧉), `share` (⇪), `act` (a button on each row: `label`, `action`, `field`), `max`, `empty` |
| `table` | `items`, `columns` (each a `field`, and optionally `label`, `width`, `right`, `color` or `colorFrom`), `max`, `empty` |
| `tiles` | `tiles`: up to 6, each a `value` and `sub` template |
| `meter` | `label`, `value` (a path to a percent), `right`, `color` |
| `text` | `text`, a template. A line whose holes all came out empty is left out. |
| `buttons` | `buttons`: up to 8, each a `label` and one of its provider's `action`s |

Paths are plain dots into the providers' data, starting with the provider's `id`: `feeds.items`, `wx.first.name`. Templates put paths in braces: `"{feeds.count} posts"`. `keys` maps single keys typed in the room to actions: `{ "p": "pause" }`.

## Put it in the store

1. Add it as `rooms/<id>/room.json` in a fork of [squad-chat](https://github.com/chrisluo5311/squad-chat).
2. Run `node rooms/build-index.mjs`. It checks the room as the bridge will, and adds it to `rooms/index.json`.
3. Open a pull request. CI runs the same check, and a review looks at what the room reaches. Once it's merged, `/chat store` lists it.
