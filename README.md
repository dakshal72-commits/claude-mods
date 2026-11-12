# claude-mods

Two mods for Claude Code.

## fresh-chat-nudge

Watches how full the chat's context window is and says when starting a new chat is the better move.

- At 60% full: a toast and a status line, and Claude mentions it once and offers a handoff summary.
- At 80% full: Claude opens its next reply by saying to start a new chat, and ends it with a handoff summary to paste into the new one.
- Resets after a compact or clear.

## subagent-router

Has Claude hand lookups and other information-gathering to subagents, on a model chosen by difficulty: Haiku for simple pulls, Sonnet for multi-step lookups, Opus for hard investigations. Never Fable.

- A subagent asked to run on Fable is moved to Opus.
- A subagent with no model named gets Sonnet (Haiku for search agents, Opus for planning).
- A fork is refused while the chat is on Fable, since a fork runs on the parent's model.
- A toast names the model each subagent landed on.

## Install

At the prompt of a Claude Code terminal session, one line per mod:

```
/plugin install fresh-chat-nudge --marketplace dakshal72-commits/claude-mods
```

```
/plugin install subagent-router --marketplace dakshal72-commits/claude-mods
```

Answer `y` to add the marketplace, then choose the user scope so the mod loads in every chat.

From a shell instead:

```
claude plugin install fresh-chat-nudge --marketplace dakshal72-commits/claude-mods
claude plugin install subagent-router --marketplace dakshal72-commits/claude-mods
```
