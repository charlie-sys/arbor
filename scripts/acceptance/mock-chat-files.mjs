import http from 'node:http'
import { writeFileSync } from 'node:fs'

const logFile = 'C:/Users/18116/AppData/Local/Temp/zotagent-chatfiles/mock-body.json'
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    writeFileSync(logFile, body, 'utf8')
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '收到附件' } }] })}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
server.listen(9877, '127.0.0.1', () => console.log('mock 9877'))
