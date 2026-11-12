import type { Register } from 'claude-code'

const SECTION = {
  id: 'subagent-router:delegation',
  scope: 'session',
  text: `# Handing lookups to subagents

The user has asked, as a standing instruction, that you hand information-gathering work to subagents instead of doing it in the main chat. This replaces any earlier guidance to spawn agents only when asked.

Delegate with the Agent tool whenever a lookup would take more than a couple of tool calls: pulling everything about a SKU, restock or OTO data, bin contents or history, NetSuite searches, Jira ticket research, sweeping code or files for an answer. Browser and computer-use work goes to a subagent too: clicking through NetSuite, the Dashboard or any website, or driving a desktop app. Independent lookups go out together, one subagent each. Quick single-call checks, and the actual edits and decisions, stay with you.

Always set the Agent tool's \`model\` by how hard the task is:
- \`haiku\`: simple, mechanical pulls. One SKU, one bin, one ticket, one file; fetch and report.
- \`sonnet\`: multi-step lookups. Several sources to cross-check, a list of SKUs, some judgment about what matters.
- \`opus\`: hard investigations. Working out why something happened, reconciling data that disagrees, anything needing real reasoning.
- Anything that drives a browser or the desktop: \`sonnet\` at least. Haiku is unreliable at clicking through sites.
- Never \`fable\`, and never a fork (a fork runs on the parent's model).

A subagent starts with none of this conversation. Give it a complete brief: the exact SKU, bin, ticket or file, which skill to load first if one covers the job (for example netsuite-lookups), and the exact shape of the answer you want back. Check anything surprising in its report before passing it on to the user.

Browser and desktop work is the most expensive kind, so keep it lean, and say so in the brief of any subagent that does it:
- Read pages as text (page text, the accessibility tree, find) instead of taking screenshots. Take a screenshot only when layout or an image matters, or the text read fails.
- Prefer a saved search, an export or CSV, or a direct URL over clicking through screens.
- Batch browser actions into one call where the steps are predictable, and close tabs when done.

If you are a subagent yourself, ignore the delegation rules above and do the work directly, but still follow the browser rules.`,
} as const

const isFable = (model: string | undefined): boolean =>
  model !== undefined && /fable|mythos/i.test(model)

// The fallback when the call named no model: by agent type, else the middle tier.
const LIGHT = new Set(['Explore', 'claude-code-guide', 'statusline-setup'])
const HEAVY = new Set(['Plan'])

const pick = (subagentType: string): string =>
  LIGHT.has(subagentType) ? 'haiku' : HEAVY.has(subagentType) ? 'opus' : 'sonnet'

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return e.tools.includes('Agent')
      ? { sections: [...composed.sections, SECTION] }
      : composed
  })

  on('agent.spawn', async ($, e, next) => {
    if (e.resume !== undefined) {
      return next(e)
    }

    if (e.fork) {
      return isFable(e.parentModel)
        ? {
            deny:
              'subagent-router: a fork would run on Fable. Use subagent_type "general-purpose" ' +
              'with model haiku, sonnet or opus, and put the context it needs in the prompt.',
          }
        : next(e)
    }

    const asked = e.model
    const isUnset = asked === undefined || asked === 'inherit'
    const model = isUnset ? pick(e.subagentType) : isFable(asked) ? 'opus' : asked
    const started = await next({ ...e, model })

    if (started.deny === undefined) {
      $.ui.toast(
        isFable(started.model)
          ? `"${e.description}" is running on ${started.model}: this session forces one model on subagents.`
          : `Subagent "${e.description}" is on ${started.model}`,
      )
    }

    return started
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'subagent-router: its model guard failed.' }))
}
