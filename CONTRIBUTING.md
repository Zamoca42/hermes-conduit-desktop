# Contributing to Conduit for desktop

Conduit for desktop is the Windows and Mac client for Hermes Agent. The
iPhone app is [hermes-conduit](https://github.com/kaishi00/hermes-conduit),
and its plugin and push relay are
[hermes-conduit-notifier](https://github.com/kaishi00/hermes-conduit-notifier).
This app follows the phone: logic both apps need goes in the plugin, and
this app draws what it sends.

## Connected features

The same feature lives on the phone and here, so a change to one may need
the other. hermes-conduit's
[docs/FEATURE_MAP.md](https://github.com/kaishi00/hermes-conduit/blob/main/docs/FEATURE_MAP.md)
lists each feature with its siblings, its rulings and its gaps, and each
entry's Desktop app line says whether this app has it: has it or partly
(naming where, a `desktop/` path or a desktop PR), not applicable (the Watch,
CarPlay, widgets and other phone-only features), gap (what's missing) or
unchecked.

1. Before changing a feature, read its entry: the phone's behavior and its
   rulings are the reference.
2. In the PR's Feature map section, name the entries the PR changes. When it
   changes an entry's Desktop app line (a gap closed, a feature added), open
   the hermes-conduit PR that updates the line and link it; that line is left
   out of the map's Checked rule, so the PR changes only that. A change with
   no siblings on the phone (packaging, CI, a desktop-only fix) says "No
   mapped feature" and why.
3. CI fails a PR whose Feature map section names no entry and gives no reason
   (`scripts/check-pr-feature-map.mjs`, run by
   `.github/workflows/pr-feature-map.yml`, again when the description is
   edited).
4. The phone's PRs and the plugin's have a Desktop section that says whether
   this app needs their change: Done (the desktop PR), Not needed (why) or
   Follow-up (an issue here, or the entry whose Desktop app line records the
   gap). A follow-up lands here as its own PR, naming that entry.

Keep this app compatible with the phone where it's cheap, but a Conduit
feature is never held or narrowed for it (Eric, 2026-11-11).

## Checks

    pnpm typecheck
    pnpm test
    pnpm build
