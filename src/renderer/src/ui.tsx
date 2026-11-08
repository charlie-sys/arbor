import { memo } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatFullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function wrapLatexEnvironments(text: string): string {
  const pattern =
    /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|cases|matrix|pmatrix|bmatrix|vmatrix)\}[\s\S]*?\\end\{\1\}/g
  return text.replace(pattern, (match, _env, offset: number) => {
    const before = text.slice(0, offset)
    const displayDelimiters = (before.match(/\$\$/g) || []).length
    if (displayDelimiters % 2 === 1) return match
    return `\n$$\n${match}\n$$\n`
  })
}

function normalizeMath(text: string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((segment, index) => {
      if (index % 2 === 1) return segment
      const converted = segment
        .replace(/\\tag\*?\{([^{}]*)\}/g, (_match, tag: string) => `\\quad\\text{(${tag})}`)
        .replace(/\\label\{[^{}]*\}/g, '')
        .replace(/\\nonumber|\\notag/g, '')
        .replace(/\\eqref\{([^{}]*)\}/g, (_match, tag: string) => `\\text{(${tag})}`)
        .replace(/\\bm\{([^{}]*)\}/g, (_match, expression: string) => `\\boldsymbol{${expression}}`)
        .replace(/\\\[([\s\S]*?)\\\]/g, (_match, expression: string) => `\n$$\n${expression.trim()}\n$$\n`)
        .replace(/\\\(([\s\S]*?)\\\)/g, (_match, expression: string) => `$${expression.trim()}$`)
      return wrapLatexEnvironments(converted)
    })
    .join('')
}

function MarkdownView({
  children,
  onPageRef
}: {
  children: string
  onPageRef?: (docId: string, page: number) => void
}): React.JSX.Element {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        urlTransform={(url) =>
          url.startsWith('zotagent:page:') || url.startsWith('zotfile:') || url.startsWith('data:image/')
            ? url
            : defaultUrlTransform(url)
        }
        components={{
          a: ({ href, children: content }) => {
            if (href?.startsWith('zotagent:page:') && onPageRef) {
              return (
                <a
                  href="#"
                  className="page-ref"
                  onClick={(event) => {
                    event.preventDefault()
                    const [, , docId = '', page = '0'] = href.split(':')
                    const pageNumber = Number(page)
                    if (Number.isFinite(pageNumber) && pageNumber > 0) onPageRef(docId, pageNumber)
                  }}
                >
                  {content}
                </a>
              )
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {content}
              </a>
            )
          }
        }}
      >
        {normalizeMath(children)}
      </ReactMarkdown>
    </div>
  )
}

// 对话每次输入/流式更新都会重渲染整个列表，未变化的 Markdown 不应重复解析与排版公式
export const Markdown = memo(
  MarkdownView,
  (prev, next) => prev.children === next.children && prev.onPageRef === next.onPageRef
)
