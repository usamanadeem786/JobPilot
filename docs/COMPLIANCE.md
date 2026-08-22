# Compliance design

This document records which parts of the original brief could not be built as
literally described without breaking a platform's terms of service or a
data-protection rule, and what was built instead. It is the reference for why
certain adapters ship disabled and why some buttons open a browser tab rather
than submitting a form for you.

Nothing here is legal advice. It is an engineering record of the constraints
the system was designed against. Before enabling any partner integration,
confirm the current terms with the platform.

---

## 1. Where the brief conflicts with platform rules

| Requested | Problem | What the system does instead |
| --- | --- | --- |
| "Find jobs from LinkedIn" | LinkedIn's User Agreement prohibits scraping, crawling and automated access to the site. There is no public jobs API. | A `PARTNER_API` adapter that stays disabled until a signed agreement and `LINKEDIN_PARTNER_API_TOKEN` exist. It never touches the consumer website. With no token, the UI says *"LinkedIn is not configured."* |
| "Find jobs from Indeed / Glassdoor" | Both restrict automated access and gate their data behind partner/publisher programmes. | Same pattern: disabled `PARTNER_API` adapters, no scraping fallback. |
| "Automatically apply to jobs" | Most job platforms prohibit programmatic submission, and doing it anyway means impersonating a human applicant. | Automated submission is available **only** through an `ApplicationAdapter` for a platform whose terms permit it. Everything else gets an *Apply manually* action that opens the employer's official application page, plus an assisted workflow that prepares the tailored CV and cover letter for you to paste. Two independent gates guard this: `SystemSetting: compliance.allowAutomatedApplications` and `JobSource.supportsAutoApply`. |
| "Identify recruiter email addresses" | Guessing `firstname.lastname@company.com` produces unverified personal data and, under GDPR, processing it has no lawful basis. It also generates bounces and spam complaints. | Contacts are only stored when a permitted source actually published them. Pattern guessing is not implemented. Every contact row carries `source`, `sourceUrl`, `confidence`, and separate `provenance` / `emailProvenance` markers. When nothing legitimate is found, the UI states *"No verified public contact found."* |
| "Send outreach to recruiters" | Unsolicited bulk email is spam, and in several jurisdictions it is unlawful. | Outreach is draft-first. The AI writes a message; a human must review it and explicitly approve it. `SystemSetting: outreach.requireManualApproval` cannot be bypassed by the API, and `OutreachDraft.approvedAt` must be set before a send is possible. There is no "send all" action. |
| "Get the latest 20–30 jobs" | Aggregators frequently omit a posting date, so "latest" would be a guess presented as a fact. | `Job.postedAtKnown` records whether the source actually supplied a date. The Latest Jobs view ranks only on known dates and labels the rest as *discovered* rather than *posted*. |
| "Scrape company career pages" | Whether this is permitted depends on the site, and robots.txt is the machine-readable statement of that. | The `CAREER_FEED` adapter reads machine-readable feeds (RSS/Atom/JSON) intended for syndication, checks `robots.txt` before every fetch, and skips disallowed paths. `SystemSetting: compliance.respectRobotsTxt` defaults to true and turning it off is not supported. |

---

## 2. Sources that work today, with no special access

These need no credentials and are documented by their vendors as public:

| Source | Kind | Why it is permitted |
| --- | --- | --- |
| Greenhouse Job Boards | `ATS_BOARD` | Greenhouse publishes a documented Job Board API so employers' listings can be syndicated. Read-only. |
| Lever Postings | `ATS_BOARD` | Lever publishes a postings API for the same purpose. Read-only. |
| Ashby Job Boards | `ATS_BOARD` | Ashby publishes a public job-posting API for hosted boards. Read-only. |

And these work with a free, official API key:

| Source | Kind | Credential |
| --- | --- | --- |
| Adzuna | `AGGREGATOR_API` | `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` |
| Jooble | `AGGREGATOR_API` | `JOOBLE_API_KEY` |

In every case the *application* itself happens on the employer's own page. None
of these permit programmatic submission, so all of them report
`ApplyMethod.EXTERNAL_URL`.

---

## 3. Rules the code enforces, not just documents

These are constraints in the schema and the service layer, so a future
contributor cannot quietly undo them by editing a config file.

**Provenance is mandatory.** The `Provenance` enum (`KNOWN`, `VERIFIED`,
`AI_INFERENCE`, `NOT_FOUND`) is attached to every value that could have been
inferred: contact details, salary parsed out of free text, and every AI
analysis. `JobAnalysis.provenance` defaults to `AI_INFERENCE` and the service
layer never writes `VERIFIED` from an LLM result. The UI renders a different
badge per state, so a guess cannot be mistaken for a fact.

**The AI may not invent CV content.** Tailoring reorganises, rewrites and
re-emphasises what the master CV already contains. Requirements the CV does not
cover are reported separately as *missing*, never written into the document.
Phase 6 adds a validation pass that rejects a generated CV containing an
employer, qualification, date or certification absent from the source, and
fails the generation rather than saving unverifiable content.

**Politeness is centralised.** Every outbound source request goes through one
HTTP client that applies a descriptive `User-Agent`, a per-source rate limit
(`JobSource.requestsPerMinute`), exponential backoff, and a robots.txt check.
An adapter cannot open its own socket and skip the policy.

**Personal data is minimised.** The system stores the user's own CV and profile,
plus professional contact details published by companies. It does not build
profiles of individuals, does not scrape social media, and does not join data
across sources to enrich a person's record. The phone number — the one
sensitive field held today — is encrypted at rest with AES-256-GCM.

**Everything is auditable.** `AuditLog` records who did what, when, from where,
with a request id that ties the entry to the server logs.

---

## 4. What an operator still has to do

The software cannot make these decisions for you:

1. **Confirm current terms** for any source before enabling it. Terms change;
   `JobSource.termsUrl` stores the link for each one.
2. **Obtain real partner agreements** before setting any `*_PARTNER_API_TOKEN`.
3. **Decide your lawful basis** for storing contact data in your jurisdiction,
   and honour deletion requests. Every `Contact` row is deletable and carries
   its source, so a request can be traced and actioned.
4. **Set a real `HTTP_USER_AGENT`** with a contact address, so a site owner who
   wants the traffic stopped can reach you.
