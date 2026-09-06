# Changelog

## [0.24.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.23.1...v0.24.0) (2026-09-06)


### Features

* **privacy:** presence is opt-in, and an audited actor can be deleted ([#125](https://github.com/Mahmoud-walid/Chemlab/issues/125)) ([8e9ee9c](https://github.com/Mahmoud-walid/Chemlab/commit/8e9ee9cf27653d806eaf71d05053c4cc7b9bc412))

## [0.23.1](https://github.com/Mahmoud-walid/Chemlab/compare/v0.23.0...v0.23.1) (2026-09-06)


### Performance

* **tests:** six times faster unit suite, and stop the one silence in coverage ([#122](https://github.com/Mahmoud-walid/Chemlab/issues/122)) ([aa4f648](https://github.com/Mahmoud-walid/Chemlab/commit/aa4f6484f8c316bd55cf694a1813edd54a15dbbd))

## [0.23.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.22.0...v0.23.0) (2026-09-06)


### Features

* **admin:** bulk actions and hard delete for quizzes, the second resource ([#118](https://github.com/Mahmoud-walid/Chemlab/issues/118)) ([8892ef6](https://github.com/Mahmoud-walid/Chemlab/commit/8892ef611f96bc03e2646380cd52207835d22b6f)), closes [#116](https://github.com/Mahmoud-walid/Chemlab/issues/116)
* **admin:** translate a quiz, answer options included ([#119](https://github.com/Mahmoud-walid/Chemlab/issues/119)) ([787f5c0](https://github.com/Mahmoud-walid/Chemlab/commit/787f5c023bf883fa26bc766726a71825c1761056))


### Bug Fixes

* **env:** report Web Push status under the name the app reads, and diagnose Neon ([#114](https://github.com/Mahmoud-walid/Chemlab/issues/114)) ([99820da](https://github.com/Mahmoud-walid/Chemlab/commit/99820daf6eef188928535398856395ecfc7a297d))

## [0.22.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.21.0...v0.22.0) (2026-09-06)


### Features

* **admin:** erase a draft created by mistake, behind its own permission ([#111](https://github.com/Mahmoud-walid/Chemlab/issues/111)) ([e8d7bc4](https://github.com/Mahmoud-walid/Chemlab/commit/e8d7bc49ea71898bfce0274ce8d3d2ee33110de5))
* **admin:** row selection, and a bulk action that is all or nothing ([#109](https://github.com/Mahmoud-walid/Chemlab/issues/109)) ([339ba76](https://github.com/Mahmoud-walid/Chemlab/commit/339ba76f01627f805921e2de176e8f6b37702e83))

## [0.21.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.20.0...v0.21.0) (2026-09-06)


### Features

* **admin:** debounced search, column visibility and a loading skeleton ([#108](https://github.com/Mahmoud-walid/Chemlab/issues/108)) ([fc0c2d7](https://github.com/Mahmoud-walid/Chemlab/commit/fc0c2d7aa2b6c11b5241dc946a969ae2f96a58ba))

## [0.20.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.19.0...v0.20.0) (2026-09-05)


### Features

* **admin:** show and filter how translated each lesson and quiz is ([#105](https://github.com/Mahmoud-walid/Chemlab/issues/105)) ([f56ba6d](https://github.com/Mahmoud-walid/Chemlab/commit/f56ba6dabe64d4a6ac1510afd322636ef044d1fe))
* **admin:** the translation editor, behind write and review permissions ([#106](https://github.com/Mahmoud-walid/Chemlab/issues/106)) ([783bdcd](https://github.com/Mahmoud-walid/Chemlab/commit/783bdcde8b892ccf1503c0a33ec43ae7a39237e6))

## [0.19.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.18.0...v0.19.0) (2026-09-05)


### Features

* **i18n:** decide what a stale or unreviewed translation shows a reader ([#103](https://github.com/Mahmoud-walid/Chemlab/issues/103)) ([290f6ff](https://github.com/Mahmoud-walid/Chemlab/commit/290f6ff959647559c3e274344d7ea96c811e419d))
* **i18n:** translation status, ownership and staleness by generated hash ([#102](https://github.com/Mahmoud-walid/Chemlab/issues/102)) ([c60dcf4](https://github.com/Mahmoud-walid/Chemlab/commit/c60dcf40f157bc9aa083a7b87b25be035ae22ea1))

## [0.18.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.17.0...v0.18.0) (2026-09-05)


### Features

* **comments:** conditional windowing and the moderation queue ([#98](https://github.com/Mahmoud-walid/Chemlab/issues/98)) ([67bd727](https://github.com/Mahmoud-walid/Chemlab/commit/67bd72743dba9c900b3765f9ded8667808956555))
* **db:** bound admin analytics to their own client, pool and timeout ([#101](https://github.com/Mahmoud-walid/Chemlab/issues/101)) ([01472f6](https://github.com/Mahmoud-walid/Chemlab/commit/01472f6a5e9255691f5f64c292ca3ad63230240b))
* **presence:** a polled heartbeat, derived state, and a switch to turn it off ([#100](https://github.com/Mahmoud-walid/Chemlab/issues/100)) ([45b326e](https://github.com/Mahmoud-walid/Chemlab/commit/45b326e83c6716d64e3fb773228eadcfe935ca6d))

## [0.17.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.16.0...v0.17.0) (2026-09-05)


### Features

* **comments:** the data layer and the API — threading, reactions, moderation ([#93](https://github.com/Mahmoud-walid/Chemlab/issues/93)) ([9bc545e](https://github.com/Mahmoud-walid/Chemlab/commit/9bc545e4e3aa43eec0fe80da7d81672710808172))
* **comments:** the discussion UI — optimistic reactions, buffered arrivals ([#94](https://github.com/Mahmoud-walid/Chemlab/issues/94)) ([aca40da](https://github.com/Mahmoud-walid/Chemlab/commit/aca40da567fd8b68effe92a421fa78995fae6d21))


### Bug Fixes

* **comments:** page on the row id, not a timestamp that loses microseconds ([#97](https://github.com/Mahmoud-walid/Chemlab/issues/97)) ([f2835ed](https://github.com/Mahmoud-walid/Chemlab/commit/f2835ed16ca3d333f4d237615d475aa2baa3fe4e))

## [0.16.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.15.0...v0.16.0) (2026-09-05)


### Features

* **ci:** a red main that reaches a phone, not one that waits to be noticed ([#90](https://github.com/Mahmoud-walid/Chemlab/issues/90)) ([054da84](https://github.com/Mahmoud-walid/Chemlab/commit/054da842777095bd50ac399e4d3c12dbcdfd64e2))

## [0.15.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.14.0...v0.15.0) (2026-09-05)


### Features

* **notifications:** the event catalogue, the fan-out and the inbox ([#87](https://github.com/Mahmoud-walid/Chemlab/issues/87)) ([b57a592](https://github.com/Mahmoud-walid/Chemlab/commit/b57a592799b44b0dcad25ac49ce522e6f7e52474))
* **push:** the service worker, the manifest and an honest permission prompt ([#86](https://github.com/Mahmoud-walid/Chemlab/issues/86)) ([d37f0da](https://github.com/Mahmoud-walid/Chemlab/commit/d37f0daf01842f4be9ac0396a8820b50da8f0f7f))

## [0.14.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.13.0...v0.14.0) (2026-09-05)


### Features

* **push:** self-hosted web push — keys, subscriptions and a send queue ([#84](https://github.com/Mahmoud-walid/Chemlab/issues/84)) ([8339f83](https://github.com/Mahmoud-walid/Chemlab/commit/8339f83792c292ed5539987f0873852885e5116f))

## [0.13.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.12.0...v0.13.0) (2026-09-05)


### Features

* **lessons:** the TipTap editor, autosave and a preview that cannot lie ([#82](https://github.com/Mahmoud-walid/Chemlab/issues/82)) ([041bb20](https://github.com/Mahmoud-walid/Chemlab/commit/041bb20a790c0025631cfbf5f0ae1293a0083cb8))

## [0.12.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.11.0...v0.12.0) (2026-09-05)


### Features

* **lessons:** likes, saves and shares that only count what happened ([#80](https://github.com/Mahmoud-walid/Chemlab/issues/80)) ([b837a04](https://github.com/Mahmoud-walid/Chemlab/commit/b837a044a426356ed2c9014f3ddba228b1cb1b70))

## [0.11.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.10.0...v0.11.0) (2026-09-05)


### Features

* **lessons:** typed content blocks and a database-driven lesson page ([#78](https://github.com/Mahmoud-walid/Chemlab/issues/78)) ([604b8b4](https://github.com/Mahmoud-walid/Chemlab/commit/604b8b4b293ff42047b5e74b7e92a4a191b865ae))

## [0.10.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.9.0...v0.10.0) (2026-09-05)


### Features

* **admin:** streaming CSV exports and the activity retention job ([#75](https://github.com/Mahmoud-walid/Chemlab/issues/75)) ([c069480](https://github.com/Mahmoud-walid/Chemlab/commit/c069480e0a37b99e4434abce798cbc3d26c8771e))

## [0.9.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.8.0...v0.9.0) (2026-09-05)


### Features

* **activity:** the activity stream, its recorder, and the admin screen ([#67](https://github.com/Mahmoud-walid/Chemlab/issues/67)) ([85ab7ba](https://github.com/Mahmoud-walid/Chemlab/commit/85ab7ba5abf7735d56ed66aaeec6df296ddf749d))
* **admin:** dashboards, the engagement funnel, and daily rollups ([#74](https://github.com/Mahmoud-walid/Chemlab/issues/74)) ([ae8ed12](https://github.com/Mahmoud-walid/Chemlab/commit/ae8ed12951a5c08e9578b1b8e26e20e03e371152))
* **admin:** page open/close switch, and migrate middleware to proxy ([#63](https://github.com/Mahmoud-walid/Chemlab/issues/63)) ([54881b2](https://github.com/Mahmoud-walid/Chemlab/commit/54881b2e4633f84484e31bf6b2c0718fb59db54b)), closes [#16](https://github.com/Mahmoud-walid/Chemlab/issues/16)
* **admin:** settings registry, read path, and the General and Features sections ([#68](https://github.com/Mahmoud-walid/Chemlab/issues/68)) ([f580c8e](https://github.com/Mahmoud-walid/Chemlab/commit/f580c8e1834332e86b87fce26ae103527d18dc01))
* **admin:** the Content, Notifications, Security and Localisation settings ([#69](https://github.com/Mahmoud-walid/Chemlab/issues/69)) ([31714ae](https://github.com/Mahmoud-walid/Chemlab/commit/31714ae497195e1a88e3f99c907a0447b39cac2d))
* **admin:** the people section, and one person's whole record ([#73](https://github.com/Mahmoud-walid/Chemlab/issues/73)) ([e0f70f0](https://github.com/Mahmoud-walid/Chemlab/commit/e0f70f0ac8d852670e424c0d15a99c80362b9c45))
* **exams:** sitting a quiz, resuming it, and reviewing the answers ([#71](https://github.com/Mahmoud-walid/Chemlab/issues/71)) ([817e9a5](https://github.com/Mahmoud-walid/Chemlab/commit/817e9a58599efa0bdbd3222ad192019dca97109f))
* **exams:** the admin view of sittings, and voiding one with a reason ([#72](https://github.com/Mahmoud-walid/Chemlab/issues/72)) ([24239ce](https://github.com/Mahmoud-walid/Chemlab/commit/24239ce1fc207f3caf5f36dd0879f7d493ccbe41))
* **exams:** the server-authoritative attempt engine ([#70](https://github.com/Mahmoud-walid/Chemlab/issues/70)) ([48d2064](https://github.com/Mahmoud-walid/Chemlab/commit/48d20644ae5fe8a9d8f1155302ba0245583ebb03))


### Bug Fixes

* **proxy:** forward x-pathname again, and close [#12](https://github.com/Mahmoud-walid/Chemlab/issues/12)'s remaining gaps ([#66](https://github.com/Mahmoud-walid/Chemlab/issues/66)) ([eaf6e8b](https://github.com/Mahmoud-walid/Chemlab/commit/eaf6e8b3d97759a318c74f5b26da82ae9f6166b0))

## [0.8.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.7.0...v0.8.0) (2026-09-05)


### Features

* **admin:** quiz lifecycle, sitting rules and a question editor ([#60](https://github.com/Mahmoud-walid/Chemlab/issues/60)) ([d78aa94](https://github.com/Mahmoud-walid/Chemlab/commit/d78aa94a32a6f9f67d49fd97b5776ee9d5a95629))

## [0.7.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.6.0...v0.7.0) (2026-09-05)


### Features

* **admin:** lesson metadata and publication lifecycle ([#58](https://github.com/Mahmoud-walid/Chemlab/issues/58)) ([6a8184c](https://github.com/Mahmoud-walid/Chemlab/commit/6a8184ce31525b0f7a554e638b21e2abca7c88c3))

## [0.6.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.5.0...v0.6.0) (2026-09-05)


### Features

* **admin:** element management with a reusable server-side data table ([#56](https://github.com/Mahmoud-walid/Chemlab/issues/56)) ([afe18fe](https://github.com/Mahmoud-walid/Chemlab/commit/afe18fec8a82894f241a49ac0512cf477d3fce4e))

## [0.5.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.4.0...v0.5.0) (2026-09-05)


### Features

* **admin:** admin panel shell with a server-side gate and filtered navigation ([#54](https://github.com/Mahmoud-walid/Chemlab/issues/54)) ([fef3450](https://github.com/Mahmoud-walid/Chemlab/commit/fef3450a8e7656a458e469cf4b70af6b58f60d80))

## [0.4.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.3.0...v0.4.0) (2026-09-05)


### Features

* **auth:** user accounts with Better Auth, sessions and profiles ([#51](https://github.com/Mahmoud-walid/Chemlab/issues/51)) ([63683ee](https://github.com/Mahmoud-walid/Chemlab/commit/63683ee82dfdedf0aa1a55d31b7f176348f2d6c0))
* **authz:** dynamic RBAC with roles, permissions and an audit trail ([#52](https://github.com/Mahmoud-walid/Chemlab/issues/52)) ([b961724](https://github.com/Mahmoud-walid/Chemlab/commit/b961724c24aaddaf81a755a0d4a99f4f20f01afc))
* **content:** read elements, lessons and quizzes from Postgres ([#50](https://github.com/Mahmoud-walid/Chemlab/issues/50)) ([e8b4c55](https://github.com/Mahmoud-walid/Chemlab/commit/e8b4c5556fa2946fe8df08ecf1387a77d64541ee)), closes [#10](https://github.com/Mahmoud-walid/Chemlab/issues/10)
* **db:** run against a local PostgreSQL cluster, and validate env ([#48](https://github.com/Mahmoud-walid/Chemlab/issues/48)) ([9562936](https://github.com/Mahmoud-walid/Chemlab/commit/95629365b98b1912eb85337b0b4ab4fb65eab821))


### Bug Fixes

* **app:** restore static rendering, and split public chrome into a route group ([#53](https://github.com/Mahmoud-walid/Chemlab/issues/53)) ([a9c52be](https://github.com/Mahmoud-walid/Chemlab/commit/a9c52beb60f9641bdf56f7f87681bdf603c7460a))

## [0.3.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.2.0...v0.3.0) (2026-09-04)


### Features

* **db:** add the Neon Postgres and Drizzle foundation ([#45](https://github.com/Mahmoud-walid/Chemlab/issues/45)) ([2247362](https://github.com/Mahmoud-walid/Chemlab/commit/2247362a9904e5fe8421c0d30a7b5a61e9fc09f7))
* **db:** model the content and add an idempotent seed ([#47](https://github.com/Mahmoud-walid/Chemlab/issues/47)) ([ef77ee0](https://github.com/Mahmoud-walid/Chemlab/commit/ef77ee0139e3b2e778ee43c364e5a42003dedd47))

## [0.2.0](https://github.com/Mahmoud-walid/Chemlab/compare/v0.1.0...v0.2.0) (2026-09-04)


### Features

* **i18n:** add Arabic and English with next-intl and full RTL ([#32](https://github.com/Mahmoud-walid/Chemlab/issues/32)) ([37a2729](https://github.com/Mahmoud-walid/Chemlab/commit/37a2729e1b0ad658f2d92edac942f4c142c40f87))
* **release:** add semantic versioning, GitHub Releases and a changelog ([#31](https://github.com/Mahmoud-walid/Chemlab/issues/31)) ([7793f39](https://github.com/Mahmoud-walid/Chemlab/commit/7793f398ddce77afa048abae13071d7ec6d2bab9)), closes [#11](https://github.com/Mahmoud-walid/Chemlab/issues/11)


### Bug Fixes

* **a11y:** meet WCAG AA contrast in light and dark themes ([#35](https://github.com/Mahmoud-walid/Chemlab/issues/35)) ([f23e4be](https://github.com/Mahmoud-walid/Chemlab/commit/f23e4be75a8a83ba60e5ce48c7dff2bf105ca2c8)), closes [#33](https://github.com/Mahmoud-walid/Chemlab/issues/33)
* **ci:** unbreak main after the first release, and tidy the changelog ([#37](https://github.com/Mahmoud-walid/Chemlab/issues/37)) ([1b93992](https://github.com/Mahmoud-walid/Chemlab/commit/1b93992ad8b3936ebca40299bcd516a67945da12))
* **release:** make the release PR title parseable so releases are tagged ([#43](https://github.com/Mahmoud-walid/Chemlab/issues/43)) ([d9c8145](https://github.com/Mahmoud-walid/Chemlab/commit/d9c814574e63758bf71d359c061d462ac1db70b7)), closes [#42](https://github.com/Mahmoud-walid/Chemlab/issues/42)
* **release:** put the version in the release PR title so releases can be tagged ([#40](https://github.com/Mahmoud-walid/Chemlab/issues/40)) ([a3c2da1](https://github.com/Mahmoud-walid/Chemlab/commit/a3c2da1fd6765b789b2bfeb78b6b51a70682e8db))
* **release:** re-cut v0.2.0 after a rewritten squash title broke the tag ([#38](https://github.com/Mahmoud-walid/Chemlab/issues/38)) ([44a2db5](https://github.com/Mahmoud-walid/Chemlab/commit/44a2db59be2ab329edd26eec58b5f473b4f64c19))

## Changelog
