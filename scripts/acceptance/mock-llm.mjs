import http from 'node:http'

const chunks = ['这是', '模型在后台', '生成的回答。']
const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
    res.writeHead(404).end('not found')
    return
  }
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    const stream = body.includes('"stream":true')
    if (!stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: chunks.join('') } }] }))
      return
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    let index = 0
    const timer = setInterval(() => {
      if (index < chunks.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[index] } }] })}\n\n`)
        index += 1
        return
      }
      clearInterval(timer)
      res.write('data: [DONE]\n\n')
      res.end()
    }, 700)
  })
})

server.listen(9876, '127.0.0.1', () => {
  console.log('mock llm on 9876')
})
