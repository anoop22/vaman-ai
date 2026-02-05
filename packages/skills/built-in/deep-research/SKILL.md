---
name: deep-research
description: Conduct deep research on a topic using web search and produce a structured report
---

# Deep Research Skill

When the user asks you to research a topic in depth, follow this process:

## Process

1. **Understand the query**: Clarify the topic, scope, and any specific angles the user wants
2. **Search**: Use the web_search tool to find relevant sources (aim for 5-10 high-quality sources)
3. **Read**: Use the web_fetch tool to read the most relevant pages in full
4. **Synthesize**: Combine findings into a structured report
5. **Save**: Write the report to `data/reports/YYYY-MM-DD-<topic-slug>.md`
6. **Deliver**: Send the report summary to the user via the originating channel

## Report Format

```markdown
# Research Report: <Topic>

**Date:** YYYY-MM-DD
**Requested by:** <channel/user>

## Executive Summary
<2-3 paragraph overview>

## Key Findings
<Numbered findings with evidence>

## Detailed Analysis
<In-depth sections with citations>

## Sources
<Numbered list of URLs with descriptions>

## Methodology
<Brief description of search strategy>
```

## Guidelines

- Always cite sources with URLs
- Distinguish between facts, analysis, and speculation
- Note any conflicting information between sources
- Include publication dates for time-sensitive information
- Flag if information may be outdated
