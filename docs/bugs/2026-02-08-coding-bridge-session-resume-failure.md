# Bug: Coding Bridge Session Resume Failure

**Date**: 2026-02-08
**Component**: Coding Bridge (CLI client → Claude Code backend)
**Status**: Fixed (Option A implemented)

## Problem

The bridge client spawns `claude -p --resume {session}` but Claude Code returns:
```
No conversation found with session ID: <uuid>
```

## Root Cause Analysis

### Issue 1: Bridge generates random UUIDs, not real Claude Code session IDs

The `AgentBridge` module generates a random UUID via `randomUUID()` when activated. This UUID is used as `{session}` in the command template:
```
claude -p --resume {session} --permission-mode bypassPermissions --output-format json {message}
```

But `claude --resume` expects a session ID from its own session store (`~/.claude/projects/<project-key>/<uuid>.jsonl`). A random UUID doesn't match any existing session.

### Issue 2: Auto-detect picks up empty stub sessions

The `findLatestClaudeSession()` function sorts `.jsonl` files by modification time and picks the newest. But each failed `claude -p` invocation creates a new 139-byte stub session file, which then becomes the "latest" — creating a cascading failure where each retry picks up the previous failure's empty stub.

### Issue 3: Session project path mismatch

Claude Code stores sessions per-project based on the working directory:
- Bridge client runs from `~/Desktop/vaman-ai/` → sessions at `~/.claude/projects/-Users-anoopsharma-Desktop-vaman-ai/`
- User's actual Claude Code session runs from `~/ralph-personal-TUI/` → sessions at `~/.claude/projects/-Users-anoopsharma-ralph-personal-TUI/`

The auto-detect looks in the wrong project directory.

### Issue 4: Unknown — can `--resume` resume an active session?

It's unclear whether `claude --resume <id>` can resume a session that is currently in use by another Claude Code process. The session file may be locked or only resumable after the original process exits.

## Attempted Fixes

1. **Random UUID** → fails because UUID doesn't exist in Claude Code's session store
2. **Auto-detect latest session** → picks up empty stubs from failed attempts, wrong project dir
3. **`--session` flag** → would work if user provides the correct ID, but untested due to issue 4

## Proposed Solutions

### Option A: Use `--session-id` for first message, `--resume` for subsequent
- First invocation: `claude -p --session-id <new-uuid> ...` (creates a new session with known ID)
- Subsequent: `claude -p --resume <that-uuid> ...` (resumes it)
- Bridge client tracks whether session has been initialized

### Option B: Don't use `--resume` at all
- Each message is independent: `claude -p --output-format json {message}`
- No session continuity, but simplest and most reliable
- Could pass context via system prompt instead

### Option C: Parse session ID from first invocation's output
- First: `claude -p --output-format json {message}` → parse session_id from JSON output
- Subsequent: `claude -p --resume <parsed-id> --output-format json {message}`
- Requires understanding Claude Code's JSON output format

### Option D: Use `--continue` flag instead of `--resume`
- `claude --continue` resumes the most recent conversation automatically
- May not work with `-p` (print mode) — needs testing

## Files Involved

- `packages/cli/src/commands/coding.ts` — bridge client, session detection
- `packages/gateway/src/agent-bridge.ts` — bridge module, session ID generation
- `packages/shared/src/config.ts` — `CODING_BRIDGE_COMMAND` template

## Environment

- Claude Code CLI version: latest (2026-02-08)
- Session storage: `~/.claude/projects/<project-key>/<uuid>.jsonl`
- Relevant flags: `--resume <id>`, `--session-id <uuid>`, `--continue`, `--fork-session`
