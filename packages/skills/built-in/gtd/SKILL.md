---
name: gtd
description: Use when organizing tasks, managing projects, processing inbox, reviewing progress, or when user mentions areas like career/social/family/health/AI
---

# GTD — Living Productivity System

A living Getting Things Done workspace. You actively maintain state files that track the user's areas, projects, next actions, and commitments. The heartbeat references these files every 30 minutes with time-aware nudges.

**This is not a static reference — it's an interactive system you operate.**

---

## User Guide

### Quick Start

The user interacts with GTD naturally through conversation. You handle all file operations behind the scenes.

**Capture anything:**
> "Add 'review PR from team' to my inbox"
> "I need to call the dentist"
> "Remind me about the quarterly planning meeting"

You write it to `data/gtd/inbox.md` immediately. Acknowledge briefly.

**Process inbox:**
> "Process my inbox"
> "What's in my inbox?"

Read `inbox.md`, walk through each item with the user:
1. Is it actionable? No → trash it or move to someday-maybe
2. Takes less than 2 minutes? → Do it now, mark done
3. Should someone else do it? → Move to waiting-for with who/date
4. Multiple steps? → Create a project under the right area in `areas.md`, add next action to `next-actions.md`
5. Single action? → Add to `next-actions.md` under the right context

**Check next actions:**
> "What should I work on?"
> "What are my next actions for career?"
> "What's on my @computer list?"

Read `next-actions.md` and `areas.md`. Surface the most relevant items based on context and time of day.

**Manage projects:**
> "Show me my career projects"
> "Add a new project under AI: build RAG evaluation suite"
> "What's the status of the vaman-ai deployment?"

Read/update `areas.md`. Each project lives under an area with its own next actions and reference notes.

**Weekly review:**
> "Start weekly review"
> "Time for my review"

Walk through the checklist in `weekly-review.md` step by step. Update all files as you go. Record the review date when complete.

**Waiting-for:**
> "I'm waiting on John for the design doc"
> "Check my waiting-for list"

Track in `waiting-for.md` with who, what, and since-date.

**Someday/maybe:**
> "Park the home renovation idea for later"
> "What's on my someday list?"

Store in `someday-maybe.md`. Reviewed during weekly review to see if anything should be promoted.

**Routines:**
> "Did I exercise today?"
> "Show my morning routine"
> "Check off calling parents"
> "Add 'stretch for 10 min' to my daily routine"

Read/update `routines.md`. Routines are recurring commitments (daily, weekly, as-needed) that reset on their cycle. The agent resets daily checkboxes each morning and weekly checkboxes each Monday. During heartbeat, check if time-appropriate routines are done.

**Completing things:**
> "I finished the auth module project"
> "The design doc from John came through"
> "Done with the RAG evaluation suite"

When a project is completed, move it from `areas.md` to `completed.md` with the completion date. Same for resolved waiting-for items, finished someday/maybe items, or retired areas. This keeps active lists clean and builds a record of accomplishment.

### Example Interactions

| User says | You do |
|-----------|--------|
| "Add X to inbox" | Append to `inbox.md`, confirm |
| "Process inbox" | Read `inbox.md`, walk through each item |
| "What's next?" | Read `next-actions.md`, suggest top items by context/time |
| "Show career projects" | Read `areas.md` career section |
| "Weekly review" | Follow `weekly-review.md` checklist |
| "I'm waiting on X" | Add to `waiting-for.md` with date |
| "Park X for later" | Add to `someday-maybe.md` |
| "Move X to career" | Update `areas.md` and `next-actions.md` |
| "Did I exercise?" | Read `routines.md`, check exercise item |
| "Morning routine" | Read `routines.md` morning section, show status |
| "Add X to routine" | Append to appropriate section in `routines.md` |
| "Finished project X" | Move from `areas.md` to `completed.md` with date |
| "What have I accomplished?" | Read `completed.md`, summarize |

---

## State Files

All live state is stored in `data/gtd/`. You read and write these files using your file tools.

| File | Purpose |
|------|---------|
| `data/gtd/inbox.md` | Unprocessed capture — items land here first |
| `data/gtd/areas.md` | Areas of focus with projects and reference notes |
| `data/gtd/next-actions.md` | Concrete next actions organized by context |
| `data/gtd/waiting-for.md` | Items delegated or waiting on others |
| `data/gtd/someday-maybe.md` | Parked ideas for future consideration |
| `data/gtd/routines.md` | Recurring daily/weekly commitments with checkboxes |
| `data/gtd/completed.md` | Archive of finished projects, resolved items, retired areas |
| `data/gtd/weekly-review.md` | Review checklist and last review notes |

### File Formats

**inbox.md:**
```
# Inbox
- [ ] Item description (captured: 2026-02-07 16:00)
- [ ] Another item (captured: 2026-02-07 09:30)
```

**areas.md:**
```
# Areas of Focus

## Career
### Active Projects
- **Project Name** — Brief description (created: 2026-02-01 10:00)
  - Next action: specific next step
  - Status: in progress / waiting / planning
### Reference Notes
- Key decisions, context, links

## Social
(same structure)
```

**next-actions.md:**
```
# Next Actions

## @computer
- [ ] Draft the API spec for auth module (Career > Auth Project) (added: 2026-02-05 14:00)
- [x] Review PR #42 (Career > Vaman-AI) (added: 2026-02-06 09:00, done: 2026-02-07 11:30)

## @phone
- [ ] Call dentist to schedule cleaning (Health) (added: 2026-02-07 08:00)

## @errands
- [ ] Pick up package from post office (Family) (added: 2026-02-06 16:00)

## @home
- [ ] Fix the kitchen faucet (Family > Home Maintenance) (added: 2026-02-03 10:00)

## @anywhere
- [ ] Brainstorm podcast topics (AI > Podcast Project) (added: 2026-02-04 13:00)
```

**waiting-for.md:**
```
# Waiting For
- [ ] Design doc from John — waiting on: John (since: 2026-02-01 14:00)
- [ ] API access approval — waiting on: IT team (since: 2026-02-03 09:00)
```

**someday-maybe.md:**
```
# Someday / Maybe
- Learn Rust for systems programming
- Build a home automation dashboard
- Write a blog series on AI agents
```

**routines.md:**
```
# Routines

## Daily
### Morning
- [ ] Wake up routine (meditation, journaling)
- [ ] Review today's next actions
- [ ] Exercise

### Evening
- [ ] Capture anything from today into inbox
- [ ] Night routine (wind-down)

## Weekly
- [ ] Call parents (Family)
- [ ] Weekly review (Sunday)

## As-Needed
- [ ] Grocery run (Health > Eating Healthy)
```

Checkboxes reset: daily items reset each morning, weekly items reset each Monday.
Agent checks items off when user reports completion. During heartbeat, nudge unchecked time-appropriate routines.

**completed.md:**
```
# Completed

## Projects
- **Auth Module** (Career) — created: 2026-01-15 09:00, completed: 2026-02-07 16:30 (23 days)
- **RAG Evaluation Suite** (AI) — created: 2026-01-10 11:00, completed: 2026-01-28 14:00 (18 days)

## Next Actions (Done)
- Review PR #42 (Career > Vaman-AI) — added: 2026-02-06 09:00, done: 2026-02-07 11:30
- Draft meeting agenda (Career) — added: 2026-02-07 08:00, done: 2026-02-07 08:15

## Waiting-For (Resolved)
- Design doc from John — since: 2026-02-01 14:00, resolved: 2026-02-05 10:00 (4 days)

## Someday/Maybe (Done)
- Blog series on AI agents — parked: 2026-01-05, completed: 2026-02-01 17:00

## Retired Areas
- **Freelance Consulting** — retired: 2026-01-15 12:00, reason: focused full-time on career
```

When completing items, remove from the active file and append to completed.md with timestamps. For projects, calculate duration (days between created and completed).

**weekly-review.md:**
```
# Weekly Review

## Checklist
1. Process inbox to zero
2. Review next actions — still relevant? Remove completed.
3. Review waiting-for — follow up needed? Any stale items?
4. Review each area — new projects? Missing next actions?
5. Review someday/maybe — promote anything to active?
6. Review calendar (next 2 weeks) — any prep needed?
7. Capture any new items that came to mind

## Last Review
**Date**: 2026-02-06
**Notes**: Processed 5 inbox items. Promoted "RAG eval" from someday to AI project.
Followed up with John on design doc. Added 3 new next actions.
```

---

## Processing Rules

When processing an inbox item, follow this decision tree:

```
Item from inbox
├── Is it actionable?
│   ├── NO → Is it reference? → Add to areas.md Reference Notes
│   │        Is it someday? → Add to someday-maybe.md
│   │        Neither? → Delete it
│   └── YES → Can it be done in < 2 minutes?
│       ├── YES → Do it now. Mark done.
│       └── NO → Is it a multi-step project?
│           ├── YES → Create project in areas.md under right area
│           │         Add next action to next-actions.md
│           └── NO → Should someone else do it?
│               ├── YES → Add to waiting-for.md
│               └── NO → Add to next-actions.md under right context
```

Always ask the user to clarify if the area or context isn't obvious.

### Timestamp Rule

**Every mutation gets a timestamp** in `YYYY-MM-DD HH:MM` format (user's local timezone):
- Creating an item → `(captured: ...)`, `(created: ...)`, `(added: ...)`
- Completing an item → `(done: ...)`, `(completed: ...)`, `(resolved: ...)`
- Moving to completed.md → include both created and completed timestamps, plus duration in days for projects

This enables analytics: how long projects take, when items were added, completion velocity, time-in-waiting-for, etc.

---

## Areas of Focus

The user's life is organized into 5 areas. Every project and action belongs to one.

| Area | Scope |
|------|-------|
| **Career** | Work, professional development, side projects generating income |
| **Social** | Friendships, community, networking, social events |
| **Family** | Family relationships, home, household responsibilities |
| **Health** | Physical health, mental health, fitness, medical |
| **AI** | AI/ML projects, research, tools, learning — the user's primary technical passion |

When the user mentions a task, map it to an area. If unclear, ask.

---

## Heartbeat Integration

During heartbeat runs (every ~30 minutes), you receive the heartbeat prompt. When activated:

1. **Read state files**: `data/gtd/inbox.md`, `data/gtd/next-actions.md`, `data/gtd/areas.md`, `data/gtd/waiting-for.md`, `data/gtd/routines.md`
2. **Read world model**: `data/state/world-model.md` for user context
3. **Check time of day** and adjust tone:
   - **Morning (6-9am)**: Daily planning — reset daily routine checkboxes, surface top 3 next actions, nudge morning routine items
   - **Mid-morning (9am-12pm)**: Focus check — current priority project, any blocked items, check if morning routine completed
   - **Afternoon (12-3pm)**: Progress check — what's done, what's next, waiting-for follow-ups, nudge exercise if not done
   - **Late afternoon (3-6pm)**: Wind-down — capture today's items, preview tomorrow, flag overdue, nudge evening routine
   - **Evening (6-10pm)**: Light touch — only urgent items, nudge evening routine if not done, check weekly routines
4. **Output 2-5 actionable bullet points** referencing specific items from state files
5. If inbox has unprocessed items, nudge to process
6. If weekly review is overdue (>7 days since last), suggest scheduling one
7. If nothing needs attention, respond with "all clear"

**Never be generic.** Always reference actual items from the state files.

---

## GTD Methodology (Condensed)

**Core principle**: Your mind is for having ideas, not holding them. Capture everything externally, process systematically, review regularly.

**The 5 stages**:
1. **Capture** — Collect everything into inbox. Don't organize yet.
2. **Clarify** — Process each item: what is it? Is it actionable? What's the next action?
3. **Organize** — Put items where they belong: next actions (by context), projects (by area), waiting-for, someday/maybe, or reference.
4. **Reflect** — Weekly review keeps the system current and trusted.
5. **Engage** — Choose actions based on context, time available, energy, and priority.

**Key concepts**:
- **Next action**: The very next physical, visible thing you can do. Not "plan the project" but "draft the outline in Google Docs."
- **Project**: Any outcome requiring more than one action step. Always has a next action.
- **Context**: Where/how you can do the action (@computer, @phone, @errands, @home, @anywhere).
- **Areas of focus**: Ongoing responsibilities that generate projects. Never "done."
- **Weekly review**: The critical habit. Process inbox to zero, review all lists, get current.
- **Two-minute rule**: If it takes less than 2 minutes, do it immediately during processing.
- **Waiting-for**: Track what you've delegated. Review weekly. Follow up proactively.

**The system only works if you trust it.** That means: capture everything, process regularly, review weekly. The agent maintains the system — you just interact naturally.
