import { retrieveMemoryTopics } from './memorySearch'
import { loadHelpSections, searchHelp } from './help'
import { searchWeb, fetchUrl } from './web'
import { searchGitHub, type GitHubSearchType } from './github'
import { store } from '../store'

export interface AliToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface AliTool {
  definition: AliToolDefinition
  execute(args: Record<string, unknown>): Promise<string>
}

const searchMemory: AliTool = {
  definition: {
    type: 'function',
    function: {
      name: 'search_memory',
      description: '检索阿栗的长期记忆主题。用户提到过去、偏好或“你还记得”时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要检索的记忆关键词或问题' },
          limit: { type: 'number', description: '返回条数，1–5，默认 3' }
        },
        required: ['query']
      }
    }
  },
  async execute(args) {
    const query = typeof args.query === 'string' ? args.query : ''
    const limit = Math.min(5, Math.max(1, Number(args.limit) || 3))
    const topics = await retrieveMemoryTopics(query, limit, 1)
    if (!topics.length) return '未找到相关长期记忆。'
    return topics
      .map((topic) => `【${topic.title}】${topic.description ? ` ${topic.description}` : ''}\n${topic.body.slice(0, 800)}`)
      .join('\n\n')
  }
}

const searchHelpTool: AliTool = {
  definition: {
    type: 'function',
    function: {
      name: 'search_help',
      description: '检索 Arbor 使用说明。用户询问软件功能、设置或操作时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要检索的功能或问题' }
        },
        required: ['query']
      }
    }
  },
  async execute(args) {
    const query = typeof args.query === 'string' ? args.query : ''
    const sections = await searchHelp(query, 2, 2200)
    if (!sections.length) return '使用说明中没有找到相关章节。'
    return sections
      .map((section) => `【${section.path}】\n${section.body}`)
      .join('\n\n')
  }
}

const readHelpTool: AliTool = {
  definition: {
    type: 'function',
    function: {
      name: 'read_help',
      description: '读取指定使用说明章节的完整内容。',
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'string', description: '章节 id、标题或路径关键词' }
        },
        required: ['section']
      }
    }
  },
  async execute(args) {
    const key = String(args.section || '').trim()
    if (!key) return '请提供章节目录。'
    const sections = await loadHelpSections()
    const section = sections.find((item) => item.id === key) ??
      sections.find((item) => item.title.includes(key) || item.path.includes(key))
    return section ? `【${section.path}】\n${section.body}` : '未找到该章节。'
  }
}

const searchWebTool: AliTool = {
  definition: {
    type: 'function',
    function: {
      name: 'search_web',
      description: '联网搜索公开网页。用户要求查最新信息、外部资料或明确要求搜索时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          limit: { type: 'number', description: '结果数量，1–5，默认 5' }
        },
        required: ['query']
      }
    }
  },
  async execute(args) {
    const ali = store.data.settings.ali
    const query = typeof args.query === 'string' ? args.query : ''
    const limit = Math.min(5, Math.max(1, Number(args.limit) || 5))
    const result = await searchWeb(query, { provider: ali.webProvider, endpoint: ali.webEndpoint, apiKey: ali.webApiKey }, limit)
    return JSON.stringify({ cached: result.cached ?? false, sources: result.sources, raw: result.raw })
  }
}

const searchGitHubTool: AliTool = {
  definition: {
    type: 'function',
    function: {
      name: 'search_github',
      description: '搜索 GitHub 仓库、Issue 或代码。用户要找 GitHub 项目、实现或讨论时使用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词或 GitHub 查询语法' },
          type: { type: 'string', enum: ['repositories', 'issues', 'code'], description: '搜索类型，默认 repositories' },
          limit: { type: 'number', description: '结果数量，1–10，默认 5' }
        },
        required: ['query']
      }
    }
  },
  async execute(args) {
    const query = typeof args.query === 'string' ? args.query : ''
    const type: GitHubSearchType =
      args.type === 'issues' || args.type === 'code' ? args.type : 'repositories'
    const limit = Math.min(10, Math.max(1, Number(args.limit) || 5))
    const result = await searchGitHub(query, type, limit, store.data.settings.ali.githubToken)
    return JSON.stringify({ cached: result.cached ?? false, sources: result.sources, raw: result.raw })
  }
}

const fetchUrlTool: AliTool = {
  definition: {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: '抓取一个公开网页并返回正文。用户给出 URL 或需要阅读搜索结果时使用。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要抓取的 http/https URL' }
        },
        required: ['url']
      }
    }
  },
  async execute(args) {
    const url = typeof args.url === 'string' ? args.url : ''
    const result = await fetchUrl(url)
    return JSON.stringify(result)
  }
}

export const aliTools: AliTool[] = [searchMemory, searchHelpTool, readHelpTool, searchWebTool, searchGitHubTool, fetchUrlTool]

export function aliToolDefinitions(includeNetwork = true): AliToolDefinition[] {
  const network = new Set(['search_web', 'search_github', 'fetch_url'])
  return aliTools
    .filter((tool) => includeNetwork || !network.has(tool.definition.function.name))
    .map((tool) => tool.definition)
}

export async function executeAliTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = aliTools.find((item) => item.definition.function.name === name)
  if (!tool) throw new Error(`未知工具：${name}`)
  return tool.execute(args)
}
