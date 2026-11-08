const api = window.api
const demo = window.__DEMO__
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const now = Date.now()
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))

const state = await api.library.getState()
if (state.documents.length || state.researchTopics.length || state.translations.length) {
  throw new Error('隔离 profile 已有数据，拒绝覆盖。请重新生成 profile。')
}

const tagColors = {
  SOH: '#8b9d77',
  迁移学习: '#b28d6f',
  贝叶斯优化: '#7d8fa8',
  不确定性: '#a58a9e'
}
for (const [name, color] of Object.entries(tagColors)) {
  await api.tags.add({ name, color })
}

const rootCollection = await api.collections.add('电池健康')
await api.collections.update(rootCollection.id, { includeChildren: true })
const partialCollection = await api.collections.add('部分充电曲线', rootCollection.id)
const transferCollection = await api.collections.add('迁移学习', rootCollection.id)
const uncertaintyCollection = await api.collections.add('不确定度', rootCollection.id)

const methodProperty = await api.properties.add({
  name: '方法类型',
  type: 'select',
  options: ['数据驱动', '物理约束', '混合模型', '综述']
})
const reproduceProperty = await api.properties.add({
  name: '复现状态',
  type: 'select',
  options: ['未开始', '进行中', '已完成']
})
const sourceProperty = await api.properties.add({
  name: '数据来源',
  type: 'select',
  options: ['公开数据集', '实验室自采', '车队数据']
})
const importanceProperty = await api.properties.add({ name: '重要性', type: 'number' })
const optionId = (property, name) => property.options?.find((option) => option.name === name)?.id ?? null

const paperTitle = 'Generalized State-of-Health Estimation from Partial Charging Curves with Transfer Learning'
const doc = await api.library.importDocument(demo.files['demo-paper.pdf'], paperTitle)
await api.library.setText(doc.id, demo.texts['demo-paper.pdf'], {
  title: paperTitle,
  authors: 'Lina Chen, Ming Zhao, Yuki Sato'
})
const notes = [
  '# 阅读笔记',
  '',
  '## 核心问题',
  '能否仅凭 **部分充电曲线** 估计 SOH，并迁移到不同化学体系？',
  '',
  '## 方法拆解',
  '- 16 个描述子：电压斜率、增量容量峰、热速率、时长比',
  '- 贝叶斯调参目标：$L = L_{\\mathrm{MAPE}} + \\lambda \\max(0, \\sigma_{\\mathrm{fold}} - \\sigma_0)$',
  '- 两阶段迁移：重估归一化 → 微调最后一个时序块与回归头',
  '',
  '## 待核对',
  '- [ ] Table 1 的 NCA 基线是否使用相同的充电窗口',
  '- [ ] LFP 失败案例中电流中断的比例',
  '- [ ] 不确定度阈值是按温度分段还是全局统一'
].join('\n')
await api.library.update(doc.id, {
  authors: 'Lina Chen, Ming Zhao, Yuki Sato',
  year: '2024',
  journal: 'Journal of Energy Storage',
  abstract:
    'Accurate state-of-health estimation is essential for safe operation of lithium-ion batteries, yet full-cycle aging tests are slow and expensive. This work estimates SOH from partial charging curves using sixteen descriptors, a Bayesian-tuned temporal convolution network and a conservative cross-chemistry transfer schedule. The method reaches 1.43% mean absolute percentage error on three public aging datasets and remains below 2.1% with only twenty minutes of charging data.',
  doi: '10.1016/j.est.2024.000101',
  url: 'https://example.org/arbor-demo/partial-charging-soh',
  tags: ['SOH', '迁移学习', '贝叶斯优化', '不确定性'],
  collections: [partialCollection.id, transferCollection.id, uncertaintyCollection.id],
  readingStatus: 'reading',
  lastPage: 3,
  starred: true,
  notes,
  addedAt: now - 2 * HOUR,
  propertyValues: {
    [methodProperty.id]: optionId(methodProperty, '数据驱动'),
    [reproduceProperty.id]: optionId(reproduceProperty, '进行中'),
    [sourceProperty.id]: optionId(sourceProperty, '公开数据集'),
    [importanceProperty.id]: 5
  }
})

const highlightInputs = [
  {
    page: 2,
    color: 'green',
    text: 'We extract sixteen descriptors from short charging segments and train a Bayesian-tuned temporal convolution network.',
    note: '特征工程的起点，与 3.1 节对照。',
    rects: [{ x: 68, y: 132, width: 420, height: 14 }]
  },
  {
    page: 3,
    color: 'yellow',
    text: 'The proposed model achieves a mean absolute percentage error of 1.43% across the evaluated chemistries.',
    note: '与 Table 1 交叉核对；注意 LFP 的最差误差。',
    rects: [{ x: 72, y: 208, width: 402, height: 14 }]
  },
  {
    page: 4,
    color: 'blue',
    text: 'a health estimator should know when it is out of distribution.',
    note: '可延伸为“高不确定度 → 延迟复核队列”的维护策略。',
    rects: [{ x: 66, y: 168, width: 350, height: 14 }]
  },
  {
    page: 3,
    color: 'pink',
    text: 'A prediction is marked unreliable when the predictive standard deviation exceeds a threshold calibrated on held-out source cells.',
    note: '阈值按温度分段可能更合理。',
    rects: [{ x: 74, y: 300, width: 410, height: 14 }]
  }
]
for (const input of highlightInputs) {
  await api.highlights.add({ docId: doc.id, ...input })
}

const excerptInputs = [
  {
    page: 2,
    source: 'We extract sixteen descriptors from short charging segments ... and train a Bayesian-tuned temporal convolution network.',
    question: '这篇论文的核心贡献与局限是什么？',
    answer:
      '**贡献**\n\n1. 用 16 个部分充电描述子在短窗口内估计 SOH，无需等待完整循环。\n2. 贝叶斯调参在多个折之间保持稳定，降低小验证集带来的选择偏差。\n3. 两阶段迁移把 NCA 源模型适配到 NCM / LFP，并同时给出校准后的不确定度。\n\n**局限**\n\n- 只覆盖三种化学体系与实验室老化协议。\n- 对充电片段长度、电流中断和传感器布置敏感。\n- 目标域标签很少时，跨随机种子的方差仍然明显。\n\n$$\\mathrm{MAPE} = 1.43\\%,\\quad \\text{worst} = 3.20\\%$$'
  },
  {
    page: 3,
    source: 'With ten minutes of data, the baseline degrades sharply, whereas the proposed model retains a usable estimate and increases its predictive variance.',
    question: '为什么短窗口下不确定性会升高？',
    answer:
      '窗口越短，增量容量峰与热速率越难稳定估计，描述子噪声被放大。模型通过 **辅助弱窗口标记** 与 MC dropout 把这种不确定性显式暴露出来：\n\n- 预测均值仍可用，但 $\\sigma$ 上升；\n- 当 $\\sigma > \\sigma_0$ 时标记为不可靠，转入较慢的参考测试；\n- 这比“静默给出错误点估计”更适合在线监测。'
  },
  {
    page: 4,
    source: 'Real fleets introduce additional variation: sensor placement, charger behavior, seasonal temperature and user driving patterns.',
    question: '如果要在车队部署，需要补充哪些验证？',
    answer:
      '建议按以下顺序补齐验证：\n\n- [ ] 按 **车辆 / 电芯编号** 划分训练与测试，避免时间片段泄漏\n- [ ] 覆盖冬季低温与快充比例较高的车辆\n- [ ] 记录充电器更换、传感器维修等事件\n- [ ] 用季度参考测试校准 $\\sigma_0$\n- [ ] 把高不确定度预测接入延迟复核队列\n\n重点不是再刷低平均误差，而是确认 **校准与失败模式** 在真实运营条件下仍成立。'
  },
  {
    page: 2,
    source: 'sixteen descriptors: five voltage-slope statistics, four incremental-capacity peaks, three thermal rates, two duration ratios and two session-level context variables.',
    question: '16 个描述子分别解决什么问题？',
    answer:
      '| 类别 | 数量 | 作用 |\n| --- | --- | --- |\n| 电压斜率统计 | 5 | 描述恒流段形状 |\n| 增量容量峰 | 4 | 捕捉老化引起的峰位/峰高变化 |\n| 热速率 | 3 | 提供温度上下文 |\n| 时长比 | 2 | 约束片段完整性 |\n| 会话上下文 | 2 | 充电器类型与起始 SOC |\n\n描述子按化学体系分别归一化，再进入时序网络。'
  }
]
const excerpts = []
for (const input of excerptInputs) {
  excerpts.push(await api.excerpts.add({ docId: doc.id, ...input }))
}

const chatMessages = (entries) =>
  entries.map((entry) => ({ id: newId(), role: entry.role, content: entry.content, createdAt: now - entry.minutes * 60 * 1000 }))

const chat1 = await api.chats.create([doc.id])
const chat1Messages = chatMessages([
    { role: 'user', minutes: 42, content: '用三点总结这篇论文，并说明它能解决什么实际问题。' },
    {
      role: 'assistant',
      minutes: 41,
      content:
        '1. **从部分充电曲线估计 SOH**：使用 16 个描述子，避免等待完整充放电循环（第 2 页）。\n2. **贝叶斯调参 + 两阶段迁移**：先在 NCA 源域训练，再在无标签目标域重估归一化，最后微调最后时序块（第 3 页）。\n3. **带不确定度的结果**：三种化学体系平均 MAPE 约 **1.43%**，20 分钟窗口下仍低于 2.1%（第 3–4 页）。\n\n实际价值在于在线电池健康监测、二手电池评估，以及实验数据不足时的快速建模。'
    },
    { role: 'user', minutes: 38, content: '如果我要复现，最需要注意什么？' },
    {
      role: 'assistant',
      minutes: 37,
      content:
        '优先核对三件事：\n\n- **特征窗口**：部分充电片段必须对齐恒流段起点，短于 10 分钟要打标记。\n- **数据划分**：按电芯编号划分，而不是随机切时间窗口，否则会泄漏相邻老化状态。\n- **调参冻结**：迁移前冻结贝叶斯选出的配置，避免目标域信息进入源阶段。\n\n复现目标函数：$L = L_{\\mathrm{MAPE}} + \\lambda \\max(0, \\sigma_{\\mathrm{fold}} - \\sigma_0)$。'
    }
  ])
await api.chats.update(chat1.id, { title: '这篇论文讲了什么', messages: chat1Messages })

const chat2 = await api.chats.create([doc.id])
const chat2Messages = chatMessages([
    { role: 'user', minutes: 120, content: '跨化学体系迁移为什么能降低误差？' },
    {
      role: 'assistant',
      minutes: 119,
      content:
        '源域学到的主要是 **曲线形状先验**，而不是某个体系的具体数值。两阶段协议先重估批归一化统计量，让目标域特征进入相同尺度；再以较小学习率微调最后一个时序块和回归头，使输出尺度可以平移。\n\n因此它保留形状先验，同时允许目标域调整幅度，代价是单体系峰值精度略低。'
    },
    { role: 'user', minutes: 116, content: '不确定度高时系统应该怎么做？' },
    {
      role: 'assistant',
      minutes: 115,
      content:
        '建议不要直接采用点估计，而是分级处理：\n\n1. $\\sigma \\le \\sigma_0$：正常写入监测记录。\n2. $\\sigma_0 < \\sigma \\le 2\\sigma_0$：标记“待复核”，缩短下次估计间隔。\n3. $\\sigma > 2\\sigma_0$：转入较慢的参考测试，并记录触发原因。\n\n论文在讨论部分明确建议按温度分段校准阈值，而不是使用单一全局阈值（第 4 页）。'
    }
  ])
await api.chats.update(chat2.id, { title: '迁移学习与不确定性', messages: chat2Messages })

const chat3 = await api.chats.create([doc.id])
await api.chats.update(chat3.id, {
  title: 'LFP 失败案例分析',
  messages: chatMessages([
    { role: 'user', minutes: 240, content: '为什么 LFP 是最困难的目标体系？' },
    {
      role: 'assistant',
      minutes: 239,
      content:
        'LFP 的电压平台较平坦，短窗口内的电压斜率与增量容量峰区分度低，描述子更容易受测量噪声影响。论文中 LFP 的平均误差与最差误差都高于 NCA / NCM，且目标域标签最少（第 3–4 页）。\n\n可行的延伸是：引入温度上下文、增加目标域无标签预适配轮次，或把不确定度阈值按体系分别标定。'
    }
  ])
})

const topic1 = await api.topics.add({ name: '部分充电曲线与 SOH 估计', docIds: [doc.id] })
await api.topics.update(topic1.id, {
  questions: [
    '部分充电窗口最短可以到多少分钟？',
    '电压斜率与增量容量特征如何互补？',
    '温度修正是否会掩盖真实老化？',
    '短窗口下如何判断预测是否可信？'
  ],
  chatId: chat1.id
})
const topic2 = await api.topics.add({ name: '跨化学体系迁移与不确定性', docIds: [doc.id] })
await api.topics.update(topic2.id, {
  questions: [
    '源域与目标域的差异主要体现在哪些特征上？',
    '冻结调参配置为什么能避免评估偏差？',
    '不确定度阈值应该如何标定？'
  ],
  chatId: chat2.id
})

const board = await api.canvases.add('部分充电 SOH · 研究画布')
const node = (kind, x, y, width, height, extra) => ({
  id: newId(),
  kind,
  x,
  y,
  width,
  height,
  title: extra.title,
  text: extra.text,
  docId: extra.docId,
  excerptId: extra.excerptId,
  chatId: extra.chatId,
  messageId: extra.messageId,
  color: extra.color,
  createdAt: now - 6 * HOUR
})
const section1 = node('section', 30, 30, 360, 420, {
  title: '问题定义',
  text: '部分充电曲线能否在 20 分钟内稳定估计 SOH？\n\n约束：无完整循环、跨化学体系、必须知道预测何时不可信。',
  color: '#edf0e6'
})
const docNode = node('document', 60, 90, 260, 150, {
  title: paperTitle,
  text: 'Lina Chen, Ming Zhao, Yuki Sato · 2024 · Journal of Energy Storage',
  docId: doc.id
})
const excerptNode1 = node('excerpt', 60, 270, 280, 170, {
  title: '摘录 · 核心贡献与局限',
  text: '16 个描述子 + 贝叶斯调参 + 两阶段迁移；三种化学体系平均 MAPE 1.43%，20 分钟窗口仍低于 2.1%。',
  docId: doc.id,
  excerptId: excerpts[0].id
})
const excerptNode2 = node('excerpt', 450, 60, 280, 170, {
  title: '摘录 · 短窗口不确定性',
  text: '窗口越短，增量容量峰与热速率越难稳定估计；不确定度升高时应转入较慢的参考测试。',
  docId: doc.id,
  excerptId: excerpts[1].id
})
const chatNode1 = node('chat', 450, 270, 300, 180, {
  title: '问答 · 这篇论文讲了什么',
  text: '三点总结 + 复现要点；引用第 2–4 页。',
  docId: doc.id,
  chatId: chat1.id,
  messageId: chat1Messages[1]?.id
})
const section2 = node('section', 800, 30, 380, 470, {
  title: '迁移与不确定性',
  text: '把源域形状先验迁移到目标体系，并把不确定度接入维护流程。',
  color: '#edf0e6'
})
const excerptNode3 = node('excerpt', 830, 100, 280, 170, {
  title: '摘录 · 车队部署验证',
  text: '按车辆或电芯编号划分训练测试，覆盖冬季低温与快充车辆，并记录充电器与传感器事件。',
  docId: doc.id,
  excerptId: excerpts[2].id
})
const excerptNode4 = node('excerpt', 830, 300, 280, 170, {
  title: '摘录 · 16 个描述子',
  text: '5 个电压斜率统计、4 个增量容量峰、3 个热速率、2 个时长比、2 个会话上下文。',
  docId: doc.id,
  excerptId: excerpts[3].id
})
const chatNode2 = node('chat', 450, 500, 300, 180, {
  title: '问答 · 迁移与不确定性',
  text: '两阶段迁移保留形状先验；高不确定度进入延迟复核队列。',
  docId: doc.id,
  chatId: chat2.id,
  messageId: chat2Messages[1]?.id
})
const nodes = [section1, docNode, excerptNode1, excerptNode2, chatNode1, section2, excerptNode3, excerptNode4, chatNode2]
const edge = (from, to, label) => ({ id: newId(), from, to, label })
const edges = [
  edge(docNode.id, excerptNode1.id, '核心结论'),
  edge(docNode.id, excerptNode2.id, '证据'),
  edge(docNode.id, chatNode1.id, '问答'),
  edge(docNode.id, excerptNode3.id, '部署'),
  edge(docNode.id, excerptNode4.id, '方法'),
  edge(excerptNode2.id, chatNode2.id, '延伸'),
  edge(chatNode1.id, chatNode2.id, '追问')
]
await api.canvases.update(board.id, { nodes, edges })

const inboxInputs = [
  {
    kind: 'link',
    title: 'Discussion · 部分充电窗口在车队数据中的表现',
    url: 'https://example.org/arbor-demo/fleet-partial-charging',
    content: '车队数据讨论：20 分钟窗口在实验室与车队数据上的误差差异，尤其是冬季低温与快充比例较高的车辆。'
  },
  {
    kind: 'excerpt',
    title: '摘录 · 分布外预测需要复核',
    docId: doc.id,
    page: 4,
    content:
      '> a health estimator should know when it is out of distribution\n\n可以把不确定度阈值写入维护流程：高 $\\sigma$ 的预测不直接进入工单，而是进入延迟复核队列。'
  },
  {
    kind: 'todo',
    title: '核对训练集划分与随机种子',
    content: '确认按电芯编号划分，并检查 5 个随机种子。'
  },
  {
    kind: 'text',
    title: '灵感 · 延迟复核队列',
    content:
      '把 **高不确定度** 的预测送入延迟复核队列：\n\n1. 估计 SOH\n2. 若 $\\sigma > \\sigma_0$ 则标记\n3. 下一次完整充电后复核\n\n这样可以把模型能力与维护流程连接起来。'
  }
]
for (const input of inboxInputs) {
  await api.inbox.add(input)
}
const archived = await api.inbox.add({
  kind: 'text',
  title: '归档 · 旧版特征清单',
  content: '8 个手工特征的旧版本，仅保留作对照，不再进入模型。'
})
await api.inbox.update(archived.id, { archived: true })

const taskInputs = [
  { title: '核对 Table 1 的 NCA 基线', due: '2026-11-08', done: false },
  { title: '复现 3.2 节贝叶斯调参', due: '2026-11-10', done: false },
  { title: '整理 LFP 失败案例', due: '2026-11-12', done: false },
  { title: '阅读讨论部分并写摘要', done: true }
]
for (const input of taskInputs) {
  const task = await api.tasks.add({ title: input.title, due: input.due, docId: doc.id })
  if (input.done) await api.tasks.update(task.id, { done: true })
}

await api.views.add('在读文献', {
  status: 'reading',
  viewMode: 'table',
  sorts: [{ key: 'addedAt', dir: 'desc' }]
})
await api.views.add('高优先级', {
  propertyFilters: { [importanceProperty.id]: '5' },
  viewMode: 'table',
  sorts: [{ key: 'addedAt', dir: 'desc' }]
})

const finalState = await api.library.getState()
return {
  docId: doc.id,
  docTitle: doc.title,
  pages: demo.texts['demo-paper.pdf'].length,
  counts: {
    documents: finalState.documents.length,
    collections: finalState.collections.length,
    tags: finalState.tags.length,
    properties: finalState.properties.length,
    highlights: finalState.highlights.length,
    excerpts: finalState.excerpts.length,
    chats: finalState.chats.length,
    topics: finalState.researchTopics.length,
    canvases: finalState.canvases.length,
    inbox: finalState.inbox.length,
    tasks: finalState.tasks.length,
    views: finalState.savedViews.length
  },
  chatIds: [chat1.id, chat2.id, chat3.id],
  topicIds: [topic1.id, topic2.id],
  canvasId: board.id,
  excerptIds: excerpts.map((item) => item.id)
}
