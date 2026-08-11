# Factory Compliance Matrix. tailscale.nixfred.com

> Stage 0 audit per PRD_HARDENING.md, completed 2026-08-10. Statuses: PASS, MISSING, CONFLICT, DEFERRED, NOT APPLICABLE. No unresolved MISSING or CONFLICT items remain. Readiness: READY TO BUILD.

| # | Requirement (governing file) | PRD section | Status | Resolution |
|---|------------------------------|-------------|--------|------------|
| 1 | Mission and audience defined (PRD_HARDENING 7.1) | PRD Mission, Audience | PASS | Field guide plus lab notebook, two reading modes. |
| 2 | Primary site class recorded (OPERATIONS 1) | PRD Stack | PASS | Static publication. No live data, no backend. |
| 3 | Scope and release boundary (PRD_HARDENING 7.3) | PRD Acceptance criteria | PASS | Current release: Phase 0 foundation plus Phase 1 core. Later phases DEFERRED. |
| 4 | Information architecture (7.4) | PRD Content architecture | PASS | Four tracks plus labs; routes listed. |
| 5 | Numeric depth target with named sibling (LAWS 12) | PRD Depth target | PASS | 110+ pages, benchmark haeb.org (105). |
| 6 | Factual sourcing and claim ledger (LAWS 9, STANDARDS 2) | PRD Source validation | PASS | Sources ledger with checked dates, staleness flags, qumulo pattern. |
| 7 | Design law and motion model (STANDARDS 5) | CLAUDE.md Design law | PASS | Recorded in CLAUDE.md at bootstrap fill-in; dark only, functional motion, reduced motion honored. |
| 8 | Accessibility (STANDARDS 5.8) | CLAUDE.md | PASS | Seed baseline: skip link, AA contrast, keyboard reachable, 44px targets. |
| 9 | Stack, hosting, deployment (STACK, DEPLOY) | PRD Stack | PASS | CONFLICT resolved 2026-08-10: original draft said Next.js; factory default ladder governs; Fred ruled Astro via factory seed. See DECISIONS 0002. |
| 10 | Data provenance (OPERATIONS 2) | n/a | NOT APPLICABLE | No live or generated data. |
| 11 | Integrations, secrets, quotas (7.11) | PRD Stack | PASS | Single secret: CLOUDFLARE_API_TOKEN as Actions repo secret, set by bootstrap. |
| 12 | User input, privacy, retention (7.12) | PRD Stack 4 | PASS | No user input. Browser state local only. |
| 13 | Freshness and stale behavior (7.13) | PRD Source validation 4 | PASS | Review dates plus rendered staleness flags. |
| 14 | SEO, metadata, fleet presence (STANDARDS 3, 6) | Ship checklist | PASS | Seed Base contract; Law 4 ritual; apex path /tailscale confirmed FREE 2026-08-10. |
| 15 | Testing and browser verification (LAWS 13, STANDARDS 7) | PRD Acceptance criteria | PASS | Seed gates plus check-guardrail.sh, browser pass at 390/820/1440 with screenshots. |
| 16 | Ownership, scheduled jobs, monitoring (7.16) | n/a | NOT APPLICABLE | Static site, no jobs. |
| 17 | Acceptance criteria and Definition of Done (7.17) | PRD Acceptance criteria | PASS | Measurable, phase-scoped. |
| 18 | Deferred work named (7.18) | PRD Deferred | PASS | Phases 2 through 7 with re-entry via Stage 0. |
| 19 | Public repo full-history privacy scan (NEWSITE, STANDARDS 7.7) | Site rules | PASS | Build pack authored sanitized before first commit; guardrail gate enforces ongoing. |
| 20 | Repo visibility ruling (NEWSITE) | Site facts | PASS | PUBLIC by Fred's explicit call, 2026-08-10. See DECISIONS 0003. |
