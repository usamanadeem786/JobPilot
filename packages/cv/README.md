# @jobpilot/cv — Phases 2 and 6

Not implemented yet. This package will hold CV text extraction, the
`CvDocument` schema, tailoring, and DOCX/PDF rendering.

Planned:

```
extract/     pdf-parse and mammoth behind one interface
schema/      CvDocument — shared by master CVs, tailored CVs and the editor
tailor/      diff and change-summary generation
render/      DOCX and PDF renderers for the five seeded templates
```

The five templates (Modern ATS, Professional, Minimal, Software Engineer,
Executive) are already seeded in `cv_templates` with their layout options.
