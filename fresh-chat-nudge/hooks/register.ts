import type { Register } from 'claude-code'

// Percent of the context window used at which the mod speaks up.
const WARN = 60
const URGENT = 80

const levelOf = (percent: number): 0 | 1 | 2 =>
  percent >= URGENT ? 2 : percent >= WARN ? 1 : 0

const noteFor = (level: 1 | 2, percent: number): string =>
  level === 2
    ? `[fresh-chat-nudge] This chat has used ${percent}% of its context window. ` +
      'Open your reply with one plain line telling the user it is now better to start a new chat. ' +
      'Then answer their message, and end the reply with a short handoff summary they can paste into the new chat: ' +
      'what was being worked on, what is done, what is left, and the files, branches or tickets involved.'
    : `[fresh-chat-nudge] This chat has used ${percent}% of its context window. ` +
      'In one plain line, tell the user this is a good point to start a new chat soon, ' +
      'and offer to write a short handoff summary for it. Then answer their message as normal. Say this once only.'

export const register: Register = on => {
  // The highest level the person has been shown, and the model has been told.
  let shown: 0 | 1 | 2 = 0
  let told: 0 | 1 | 2 = 0

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    const percent = (await $.session.usage()).context.percent ?? 0
    const level = levelOf(percent)

    if (level === 0) {
      // Compacted or cleared: start over.
      shown = 0
      told = 0
      $.ui.status(undefined)
    } else {
      $.ui.status(
        level === 2
          ? `Context ${percent}% full: start a new chat`
          : `Context ${percent}% full: good point for a new chat soon`,
      )

      if (level > shown) {
        shown = level
        $.ui.toast(
          level === 2
            ? `Context is ${percent}% full. Better to start a new chat now.`
            : `Context is ${percent}% full. A new chat soon will work better.`,
          { timeoutMs: 10000 },
        )
      }
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const percent = (await $.session.usage()).context.percent ?? 0
    const level = levelOf(percent)

    if (level === 0 || level <= told) {
      return next(e)
    }

    told = level

    return next({ ...e, context: [...(e.context ?? []), noteFor(level, percent)] })
  }).catch(($, e, next) => next(e))
}
