import type { Register } from 'claude-code'

// Percent of the context window used at which the mod speaks up.
const WARN = 50
const URGENT = 80

const levelOf = (percent: number): 0 | 1 | 2 =>
  percent >= URGENT ? 2 : percent >= WARN ? 1 : 0

const HANDOFF_BLOCK =
  'a handoff prompt for the new chat, in one fenced code block the user can copy whole. ' +
  'Write it to a chat that knows nothing of this one, addressed to Claude, and complete enough to carry on without this chat: ' +
  'the goal; what is done and the current state; the exact next steps; ' +
  'the files, folders, branches, PRs and tickets involved, by full path or URL; ' +
  'which skills to load first; the decisions made and the preferences or corrections the user gave; ' +
  'and anything unfinished, unverified or known to be broken. ' +
  'Leave out passwords, keys and tokens. Outside the block, say only that it is ready to paste.'

const HANDOFF = `End the reply with ${HANDOFF_BLOCK}`

const HANDOFF_NOW = `I want to continue this work in a new chat. Write ${HANDOFF_BLOCK}`

const noteFor = (level: 1 | 2, percent: number): string =>
  level === 2
    ? `[fresh-chat-nudge] This chat has used ${percent}% of its context window. ` +
      'Open your reply with one plain line telling the user it is now better to start a new chat. ' +
      `Then answer their message. ${HANDOFF}`
    : `[fresh-chat-nudge] This chat has used ${percent}% of its context window. ` +
      'Open your reply with one plain line telling the user this is a good point to start a new chat soon. ' +
      `Then answer their message as normal. ${HANDOFF}`

export const register: Register = on => {
  // The highest level the person has been shown, and the model has been told.
  let shown: 0 | 1 | 2 = 0
  let told: 0 | 1 | 2 = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'handoff',
      description: 'Write a handoff prompt to continue this work in a new chat',
    })

    return next(e)
  })

  on('command.run', { command: 'handoff' }, $ => {
    // A prompt cannot be submitted from inside the command itself (it would wait
    // on the command's own turn), so it goes out from a timer just after.
    $.clock.after(250, () => {
      $.prompt.submit({ text: HANDOFF_NOW, asUser: true }).then(
        sent => {
          if (sent.drop !== undefined) {
            $.ui.toast(`Handoff not started: ${sent.drop}`, { timeoutMs: 10000 })
          }
        },
        () => {
          $.ui.toast('Handoff could not start. Type "write a handoff prompt" instead.', {
            timeoutMs: 10000,
          })
        },
      )
    })

    return { text: 'Writing a handoff prompt for a new chat.' }
  })

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
