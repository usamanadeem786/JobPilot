# @jobpilot/workers — Phase 3

Not implemented yet. A separate BullMQ process consuming the queues described
in [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#9-background-jobs-phase-3):
`job-search`, `job-analysis`, `cv-generation`, `contact-discovery`,
`outreach-send`.

It runs as its own process rather than inside the API so that a long search or
a batch of LLM calls cannot slow down request handling. It shares the API's
Docker image and the same `packages/*` libraries.
