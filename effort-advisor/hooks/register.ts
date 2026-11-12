import type { EngineInterface, Register } from 'claude-code'

type Level = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type Kind = 'simple' | 'hard'
type Rule = 'ask' | 'always' | 'never'

const RANK: Record<Level, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 }

// What a prompt of each kind is offered: quick ones go down, hard ones go up.
const TARGET: Record<Kind, Level> = { simple: 'low', hard: 'high' }

const HARD =
  /\b(why|root cause|investigat\w*|debug\w*|diagnos\w*|design\w*|architect\w*|refactor\w*|redesign\w*|plan|analy[sz]\w*|reconcil\w*|migrat\w*|compar\w*|trade-?offs?|review|audit\w*|figure out|work out|optimi[sz]\w*|rewrite|from scratch|end to end|strategy|think (hard|carefully|deeply))\b/i

const EASY =
  /\b(what is|what's|where is|where's|show|list|rename|typo|open|run|status|commit|push|merge|look ?up|pull|check|find|how many|which|yes|ok|okay|sure|thanks|go ahead|do it)\b/i

// After "Keep", the same kind of prompt is not asked about again for this long.
const QUIET_MS = 10 * 60 * 1000

// Prompts the person sent themself: typed here, from the phone, or through the app.
const USER_KINDS = new Set(['composer', 'bridge', 'sdk'])

const classify = (text: string): Kind | null => {
  const words = text.trim().split(/\s+/).filter(Boolean).length

  if (words === 0) {
    return null
  }

  if (HARD.test(text) || words > 150) {
    return 'hard'
  }

  return words <= 8 || (words <= 30 && EASY.test(text)) ? 'simple' : null
}

const isLevel = (effort: unknown): effort is Level =>
  typeof effort === 'string' && effort in RANK

const ruleKey = (kind: Kind): string => `rule:${kind}`

const decide = async (
  $: EngineInterface,
  text: string,
  current: Level,
  quietUntil: Record<Kind, number>,
): Promise<Level | null> => {
  const kind = classify(text)

  if (kind === null) {
    return null
  }

  const target = TARGET[kind]
  const isWorthIt = kind === 'simple' ? RANK[current] > RANK[target] : RANK[current] < RANK[target]

  if (!isWorthIt) {
    return null
  }

  const rule = ((await $.store.get(ruleKey(kind))) ?? 'ask') as Rule

  if (rule === 'never') {
    return null
  }

  if (rule === 'always') {
    $.ui.toast(`Running this one at ${target} effort (chat is on ${current})`)

    return target
  }

  const now = await $.clock.now()

  if (now < quietUntil[kind]) {
    return null
  }

  const use = `Use ${target}`
  const keep = `Keep ${current}`
  const always = `Always ${target} for these`
  const never = 'Stop asking'
  const question =
    kind === 'simple'
      ? `This looks like a quick request. Run it at ${target} effort instead of ${current} to save usage?`
      : `This looks like a hard one. Run it at ${target} effort instead of ${current}?`

  let answer: string

  try {
    answer = await $.ui.ask(question, { header: 'Effort', options: [use, keep, always, never] })
  } catch {
    // Dismissed, or nobody to ask: leave the effort as it is.
    return null
  }

  if (answer === use) {
    return target
  }

  if (answer === always) {
    await $.store.set(ruleKey(kind), 'always')

    return target
  }

  if (answer === never) {
    await $.store.set(ruleKey(kind), 'never')

    return null
  }

  quietUntil[kind] = now + QUIET_MS

  return null
}

export const register: Register = on => {
  // The person's latest prompt, until the turn it starts has been decided.
  let pending: string | null = null
  // The level picked for a turn, by its id: sent on each of that turn's requests.
  const chosen = new Map<string, Level>()
  const quietUntil: Record<Kind, number> = { simple: 0, hard: 0 }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'effort-advisor',
      description: 'Show what the effort advisor does on its own; "reset" makes it ask again',
      argumentHint: '[reset]',
    })

    return next(e)
  })

  on('command.run', { command: 'effort-advisor' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'reset') {
      await $.store.delete(ruleKey('simple'))
      await $.store.delete(ruleKey('hard'))
      quietUntil.simple = 0
      quietUntil.hard = 0

      return { text: 'Effort advisor reset: it will ask again for quick and hard prompts.' }
    }

    const simple = ((await $.store.get(ruleKey('simple'))) ?? 'ask') as Rule
    const hard = ((await $.store.get(ruleKey('hard'))) ?? 'ask') as Rule
    const say = (rule: Rule, target: Level): string =>
      rule === 'always' ? `always ${target}, without asking` : rule === 'never' ? 'left alone' : 'asks first'

    return {
      text:
        `Quick prompts: ${say(simple, TARGET.simple)}. Hard prompts: ${say(hard, TARGET.hard)}. ` +
        'Run /effort-advisor reset to make it ask again.',
    }
  })

  on('prompt.submit', ($, e, next) => {
    const isUsers = USER_KINDS.has(e.origin?.kind ?? 'composer')

    pending = isUsers && e.isMeta !== true && e.command === undefined ? e.text : null

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const current = e.effort

    if (e.agentId !== undefined || !isLevel(current)) {
      return yield* next(e)
    }

    if (pending !== null) {
      const text = pending

      pending = null
      chosen.clear()

      const picked = await decide($, text, current, quietUntil)

      if (picked !== null) {
        chosen.set(e.turnId, picked)
      }
    }

    const level = chosen.get(e.turnId)

    return yield* next(level === undefined ? e : { ...e, effort: level })
  })
}
