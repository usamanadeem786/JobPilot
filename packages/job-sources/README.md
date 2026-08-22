# @jobpilot/job-sources — Phase 3

Not implemented yet. This package will hold the `JobSourceAdapter` interface,
the adapter registry, and the shared HTTP client that enforces rate limits,
backoff, `User-Agent` and robots.txt for every outbound request.

Planned adapters:

| Adapter | Kind | Credentials |
| --- | --- | --- |
| greenhouse, lever, ashby | `ATS_BOARD` | none — public APIs |
| adzuna, jooble | `AGGREGATOR_API` | free official API keys |
| career-feed | `CAREER_FEED` | none — permitted feeds only |
| linkedin, indeed, glassdoor | `PARTNER_API` | **disabled** without a signed partner agreement |

The registry rows are already seeded in the database, with each source's terms
URL and what it permits. Interface and pipeline are in
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#5-job-source-adapter-architecture-phase-3);
the reasoning behind the disabled adapters is in
[docs/COMPLIANCE.md](../../docs/COMPLIANCE.md).
