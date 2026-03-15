import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import dancesRouter from './routes/dances.ts'
import sessionsRouter from './routes/sessions.ts'

dotenv.config()

const app = express()

app.use(cors({
  origin: process.env.CORS_ORIGIN || /^http:\/\/localhost:\d+$/,
}))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/dances', dancesRouter)
app.use('/api/sessions', sessionsRouter)

export default app
