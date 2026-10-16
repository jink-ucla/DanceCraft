import { Router } from 'express'
import type { Response } from 'express'
import { parseBattleRequest, parseCoachRequest } from '../coach/schemas.ts'
import { generateBattleVerdict, generateCoachPlan, getCoachStatus } from '../coach/claude.ts'

const router = Router()

/** Abort the Claude call if the client goes away before we answer. */
function abortOnClose(res: Response): AbortSignal {
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) controller.abort()
  })
  return controller.signal
}

// Is Claude configured? (never exposes the key)
router.get('/status', (_req, res) => {
  res.json(getCoachStatus())
})

// Personalised practice plan
router.post('/', async (req, res) => {
  const parsed = parseCoachRequest(req.body)
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error })
    return
  }
  try {
    res.json(await generateCoachPlan(parsed.value, abortOnClose(res)))
  } catch (err) {
    console.error('[coach] plan failed:', err)
    res.status(500).json({ error: 'Coach failed to build a plan' })
  }
})

// "Beat the host" verdict + commentary
router.post('/battle', async (req, res) => {
  const parsed = parseBattleRequest(req.body)
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error })
    return
  }
  try {
    res.json(await generateBattleVerdict(parsed.value, abortOnClose(res)))
  } catch (err) {
    console.error('[coach] battle failed:', err)
    res.status(500).json({ error: 'Coach failed to judge the battle' })
  }
})

export default router
