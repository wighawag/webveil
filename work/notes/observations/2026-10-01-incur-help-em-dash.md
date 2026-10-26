# `webveil --help` first line has an em dash from incur (2026-10-01)

Noticed while building engine-neutral-no-em-dashes: the em dash in the first line of `webveil --help` (and of every `webveil <command> --help`) is not repo text. incur's formatter writes it (`node_modules/incur/dist/Help.js`, `` `${title} \u2014 ${description}` ``, and `formatFetchHelp` in `Cli.js`), and incur 0.4.10 has no option to change the separator. Removing it needs an upstream incur change (or a newer incur that makes the separator configurable); a local `pnpm patch` would not reach users, since the published `webveil` depends on the unpatched incur. Left as is.

## Update (2026-10-24)

incur 0.7.1 is now published (webveil still pins 0.4.10). Check whether it makes the separator configurable before taking this upstream.

## Update (2026-10-26)

Checked while building `upgrade-incur-0-7`: incur 0.7.1 still hardcodes the separator (`dist/Help.js`, `formatRoot` and `formatCommand`, `` `${title} \u2014 ${description}` ``) and has no option to change it; its changelog from 0.4.11 to 0.7.1 has no entry about it. Still open: it needs an upstream incur change (a separator option, or a colon).
