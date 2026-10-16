// Load .env before app.ts (and the route modules it imports) evaluate, so
// module-level settings like PYTHON_PATH / DATA_DIR actually see .env values.
import 'dotenv/config'
import app from './app.ts'

const PORT = parseInt(process.env.PORT || '3001', 10)

app.listen(PORT, () => {
  console.log(`Groovy server running on http://localhost:${PORT}`)
})
