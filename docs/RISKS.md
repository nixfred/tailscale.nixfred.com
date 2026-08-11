# Risk register. tailscale.nixfred.com

1. **Product velocity vs staleness.** Tailscale ships monthly; stale claims are worse than absent ones. Mitigation: sources ledger with review dates, rendered staleness flags, changelog pass every content phase.
2. **Trademark exposure.** The site uses the Tailscale name heavily. Mitigation: nominative use only, no logo or brand imitation, unofficial disclosure line sitewide, DECISIONS 0006.
3. **Tailnet privacy leak.** Lab writeups derive from a real tailnet. Mitigation: sanitize before commit (site rule 2), guardrail gate, full-history scan discipline.
4. **Depth debt.** 110+ page target with a solo author. Mitigation: phased releases, no placeholder routes, in-progress state authored honestly.
