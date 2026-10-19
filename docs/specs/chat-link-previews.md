# Review — Chat link previews: setting and rich cards (L-119)

Created 2026-10-19 22:17 IST. Tier: Medium. Builds on L-118 (hover card with title and icon).

## Goal

Links that automations post into chats (products, tools, UI/UX, open source) read as plain URLs. Show a small, good-looking
preview with the page's image, title and description, and let the user choose how eager that is.

## Behaviour

- Setting **Chat → Link previews**: `Off` · `On hover` (default, today's behaviour) · `Always`.
  - Off: no card and no request.
  - On hover: the card opens after the hover delay; nothing is fetched until then.
  - Always: up to 3 cards under a finished reply (never while it streams), one per distinct web link, fetched only once the
    card scrolls near the screen.
- The card shows `og:image` (or `twitter:image`), title, `og:description` and site name with the favicon. A page with no
  image gets a text-only card. X/Twitter gets no special handling: whatever the page publishes is shown.
- Sizes: hover card 320 px wide, image 16:9 at most 168 px tall. Inline card at most 520 px wide, about 88 px tall, with a
  128 × 72 image on the right. Images are `object-cover`, rounded, with a quiet outline.
- Clicking an inline card opens the link in the browser, like the link itself.

## Storage and cost

- Nothing is written to disk. Pages are fetched by the native host (`fetch_link_preview`, private and local addresses
  refused), the image capped at 1 MiB and only PNG/JPEG/GIF/WebP accepted.
- The webview redraws the image to a JPEG thumbnail of at most 480 px wide before keeping it, so a cached preview costs
  tens of KB. The cache holds the last 100 links in memory and is gone on restart.
- The user message chip (UserLinkPreview) keeps its title-and-icon fetch and never downloads the page image.

## Plan / files

- `src-tauri/src/link_preview.rs`: `include_image` argument; `description`, `site_name`, `image_data_url` fields;
  shared `meta_content` helper; tests.
- `src/features/sessions/model/linkPreview.ts`: rich fetch with a bounded cache and thumbnailing; `collectWebLinks`.
- `src/features/settings/model/linkPreviewSettings.ts`: mode store. Settings search row and Segmented in `SettingsView.tsx`.
- `src/features/sessions/ui/ChatHoverPreviews.tsx`: rich hover card, inline cards.
- `src/features/sessions/ui/AgentMarkdown.tsx`: respect the mode; render inline cards after the reply.

## Risks

- `link_preview.rs` is upstream's file: keep the change additive so upstream merges stay simple.
- Some sites block non-browser fetches or publish no tags; those get the text-only or "no preview" card.

## Checklist

- [x] Rust tests for description, site name and image tag parsing.
- [x] Vitest for link collection and the mode store.
- [x] tsc, vitest, cargo tests.
- [ ] Desktop check (manual): each mode, a page with and without an image, a long title, scrolling a long chat.
