# @jobpilot/ai — Phase 5

Not implemented yet. This package will hold the LLM abstraction layer, the
versioned prompt modules and the response validators.

Planned structure:

```
providers/    OpenAiProvider · AnthropicProvider · MockProvider
prompts/      jobAnalysis · cvTailoring · coverLetter · outreach
schemas/      one Zod schema per prompt — the response contract
validators/   anti-fabrication checks against the source CV
llm.service.ts
```

Design is in [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#6-ai-architecture-phase-5).
The environment slots (`LLM_PROVIDER`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)
already exist and are validated at boot.
