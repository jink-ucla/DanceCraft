import app from './app.ts'

const PORT = parseInt(process.env.PORT || '3001', 10)

app.listen(PORT, () => {
  console.log(`Groovy server running on http://localhost:${PORT}`)
})
