(() => {
  const root = document.documentElement
  const themeKey = 'arbor-demo-theme'
  const themeToggle = document.getElementById('themeToggle')

  const applyTheme = (theme) => {
    root.dataset.theme = theme
    themeToggle.textContent = theme === 'dark' ? '浅色模式' : '深色模式'
  }
  let theme = localStorage.getItem(themeKey)
  if (theme !== 'dark' && theme !== 'light') theme = 'light'
  applyTheme(theme)
  themeToggle?.addEventListener('click', () => {
    theme = root.dataset.theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem(themeKey, theme)
    applyTheme(theme)
  })

  const toast = document.getElementById('demoToast')
  let toastTimer = null
  const notify = (message) => {
    if (!toast) return
    toast.textContent = message
    toast.classList.add('show')
    if (toastTimer) window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600)
  }

  document.querySelectorAll('[data-toast]').forEach((element) => {
    element.addEventListener('click', () => notify(element.dataset.toast))
  })

  const views = Array.from(document.querySelectorAll('.view'))
  const navButtons = Array.from(document.querySelectorAll('.nav button'))
  const showView = (name) => {
    views.forEach((view) => view.classList.toggle('active', view.dataset.page === name))
    navButtons.forEach((button) => {
      const active =
        button.dataset.view === name ||
        (name === 'reader' && button.dataset.view === 'library') ||
        (name === 'topic-detail' && button.dataset.view === 'topics')
      button.classList.toggle('active', active)
    })
  }
  navButtons.forEach((button) => {
    button.addEventListener('click', () => showView(button.dataset.view))
  })

  const librarySearch = document.getElementById('librarySearch')
  const libraryRows = Array.from(document.querySelectorAll('#libraryBody tr'))
  librarySearch?.addEventListener('input', () => {
    const keyword = librarySearch.value.trim().toLowerCase()
    libraryRows.forEach((row) => {
      const match = !keyword || row.textContent.toLowerCase().includes(keyword)
      row.style.display = match ? '' : 'none'
    })
  })

  const readerTitle = document.getElementById('readerTitle')
  const pdfTitle = document.getElementById('pdfTitle')
  libraryRows.forEach((row) => {
    row.addEventListener('click', () => {
      const title = row.dataset.title || '文献标题'
      readerTitle.textContent = title
      pdfTitle.textContent = title
      showView('reader')
      document.querySelector('.pdf-scroll')?.scrollTo({ top: 0 })
    })
  })
  document.getElementById('backToLibrary')?.addEventListener('click', () => showView('library'))

  const readerTabs = Array.from(document.querySelectorAll('.panel-tabs .tab'))
  readerTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      readerTabs.forEach((item) => item.classList.toggle('active', item === tab))
      document.querySelectorAll('[data-panel-body]').forEach((panel) => {
        panel.hidden = panel.dataset.panelBody !== tab.dataset.panel
      })
    })
  })

  document.querySelectorAll('.context-bar').forEach((bar) => {
    bar.querySelectorAll('.context-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        bar.querySelectorAll('.context-chip').forEach((item) => item.classList.toggle('active', item === chip))
      })
    })
  })

  document.querySelectorAll('.filter-chips').forEach((bar) => {
    bar.querySelectorAll('.chip-button').forEach((chip) => {
      chip.addEventListener('click', () => {
        bar.querySelectorAll('.chip-button').forEach((item) => item.classList.toggle('active', item === chip))
      })
    })
  })

  const appendBubble = (container, role, text) => {
    const bubble = document.createElement('div')
    bubble.className = `chat-msg ${role}`
    bubble.textContent = text
    container.appendChild(bubble)
    container.scrollTop = container.scrollHeight
    return bubble
  }

  const fakeAnswer = (question) => {
    if (/局限|缺点|不足/.test(question)) {
      return '从论文的讨论部分看，主要局限是跨化学体系泛化仍需更多验证，并且对部分充电窗口长度较敏感。可结合第 8 页的误差分析一起阅读。在线 Demo 的回复为模拟内容，桌面版会基于真实文献生成并附引用。'
    }
    if (/方法|复现|实现/.test(question)) {
      return '论文使用 16 个部分充电曲线特征，结合贝叶斯超参数调优与迁移学习。复现时优先核对特征提取窗口、数据清洗与训练集划分，避免时间片段泄漏。在线 Demo 的回复为模拟内容。'
    }
    return '根据当前文献，可以先从研究问题、方法和证据三条线来理解：作者用部分充电曲线估计 SOH，并通过迁移学习覆盖多种化学体系。建议回到第 1 页与第 4 页核对定义与结果。在线 Demo 的回复为模拟内容。'
  }

  const sendInto = (input, thread, before) => {
    const text = input.value.trim()
    if (!text) return
    const userBubble = document.createElement('div')
    userBubble.className = 'chat-msg user'
    userBubble.textContent = text
    if (before) thread.insertBefore(userBubble, before)
    else thread.appendChild(userBubble)
    input.value = ''
    thread.scrollTop = thread.scrollHeight

    window.setTimeout(() => {
      const assistant = document.createElement('div')
      assistant.className = 'chat-msg assistant'
      assistant.textContent = fakeAnswer(text)
      const cite = document.createElement('span')
      cite.className = 'cite'
      cite.textContent = ' [第 3 页]'
      assistant.appendChild(cite)
      if (before) thread.insertBefore(assistant, before)
      else thread.appendChild(assistant)
      thread.scrollTop = thread.scrollHeight
    }, 550)
  }

  const readerInput = document.getElementById('readerInput')
  const readerThread = document.querySelector('[data-panel-body="assistant"] .agent-thread')
  document.getElementById('readerSend')?.addEventListener('click', () => {
    if (readerInput && readerThread) sendInto(readerInput, readerThread, null)
  })
  readerInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (readerThread) sendInto(readerInput, readerThread, null)
    }
  })

  const chatInput = document.getElementById('chatInput')
  const chatThread = document.getElementById('chatThread')
  const chatComposer = chatThread?.parentElement?.querySelector('.composer')
  document.getElementById('chatSend')?.addEventListener('click', () => {
    if (chatInput && chatThread) sendInto(chatInput, chatThread, null)
  })
  chatInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (chatThread) sendInto(chatInput, chatThread, null)
    }
  })

  const captureInput = document.getElementById('captureInput')
  const inspirationList = document.getElementById('inspirationList')
  const saveCapture = () => {
    const text = captureInput?.value.trim()
    if (!text) {
      notify('先写点什么，再保存。')
      return
    }
    const card = document.createElement('article')
    card.className = 'inbox-card'
    const head = document.createElement('div')
    head.className = 'inbox-head'
    const kind = document.createElement('span')
    kind.className = 'pill sage'
    kind.textContent = '灵感'
    const time = document.createElement('span')
    time.textContent = '刚刚'
    head.append(kind, time)
    const title = document.createElement('h3')
    title.textContent = '新收集的灵感'
    const body = document.createElement('p')
    body.textContent = text
    card.append(head, title, body)
    inspirationList?.prepend(card)
    captureInput.value = ''
    notify('已保存到灵感收集（演示）。')
  }
  document.getElementById('captureSave')?.addEventListener('click', saveCapture)
  captureInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      saveCapture()
    }
  })

  const translations = {
    1: {
      title: '2026/11/07 16:43 · deepseek-flash',
      sub: '结构化译文 · 保留原图',
      translated: './assets/demo/translation-translated-1.png',
      original: './assets/demo/translation-original-1.png',
      structured:
        '<h4>摘要</h4><p>本工作提出一种广义的数据驱动老化估计方法，仅使用来自部分负载曲线的原始电池传感器数据。为此，获取了描述电池电芯及相应充电曲线的高级参数。</p><h4>方法</h4><p>开发了一种使用贝叶斯超参数调优的神经网络，能够在无需进一步预处理或特征工程的情况下估计 SOH。神经网络仅接收描述部分充电曲线的 16 个参数作为输入数据。</p>',
      plain:
        '摘要\n本工作提出一种广义的数据驱动老化估计方法，仅使用来自部分负载曲线的原始电池传感器数据。为此，获取了描述电池电芯及相应充电曲线的高级参数。\n\n方法\n开发了一种使用贝叶斯超参数调优的神经网络，能够在无需进一步预处理或特征工程的情况下估计 SOH。神经网络仅接收描述部分充电曲线的 16 个参数作为输入数据。'
    },
    2: {
      title: '2026/11/07 15:08 · qwen-vl-plus',
      sub: '图表翻译 · 保留原图',
      translated: './assets/demo/translation-translated-2.png',
      original: './assets/demo/translation-original-2.png',
      structured:
        '<h4>图 8 · SOH 估计验证结果</h4><table class="excerpt-table"><thead><tr><th>模型</th><th>MAPE</th></tr></thead><tbody><tr><td>源模型（NCM）</td><td>1.43%</td></tr><tr><td>目标模型 1（LFP）</td><td>2.05%</td></tr><tr><td>目标模型 2（NCA）</td><td>1.87%</td></tr></tbody></table><p>在 500 次循环后，目标模型与参考值的偏差明显小于基线模型，说明迁移学习有效。</p>',
      plain:
        '图 8 · SOH 估计验证结果\n模型 | MAPE\n源模型（NCM）| 1.43%\n目标模型 1（LFP）| 2.05%\n目标模型 2（NCA）| 1.87%\n\n在 500 次循环后，目标模型与参考值的偏差明显小于基线模型，说明迁移学习有效。'
    },
    3: {
      title: '2026/11/06 21:12 · deepseek-flash',
      sub: '扫描页 · 保留原图',
      translated: './assets/demo/translation-translated-3.png',
      original: './assets/demo/translation-original-3.png',
      structured:
        '<h4>实验设置</h4><p>实验在 25°C 下进行，分别使用 NCA、NCM 与 NCA-NCM 三种电池体系。所有充电片段均从 10% SOC 开始，并在不同截止电压下截断。</p><h4>数据划分</h4><p>为避免数据泄漏，训练集与测试集按电池单体划分，而不是按时间片段随机划分。</p>',
      plain:
        '实验设置\n实验在 25°C 下进行，分别使用 NCA、NCM 与 NCA-NCM 三种电池体系。所有充电片段均从 10% SOC 开始，并在不同截止电压下截断。\n\n数据划分\n为避免数据泄漏，训练集与测试集按电池单体划分，而不是按时间片段随机划分。'
    }
  }
  const translateImage = document.getElementById('translateImage')
  const translateTitle = document.getElementById('translateTitle')
  const translateSub = document.getElementById('translateSub')
  const translateStructured = document.getElementById('translateStructured')
  const translatePlain = document.getElementById('translatePlain')
  let activeTranslate = '1'
  const setImageMode = (mode) => {
    const data = translations[activeTranslate]
    if (!data) return
    document.querySelectorAll('[data-image-mode]').forEach((btn) => btn.classList.toggle('active', btn.dataset.imageMode === mode))
    translateImage.src = mode === 'original' ? data.original : data.translated
    translateImage.alt = mode === 'original' ? '原图' : '译文图'
  }
  const setTextMode = (mode) => {
    document.querySelectorAll('[data-translate-text]').forEach((btn) => btn.classList.toggle('active', btn.dataset.translateText === mode))
    translateStructured.hidden = mode !== 'structured'
    translatePlain.hidden = mode !== 'plain'
  }
  const applyTranslation = (id) => {
    const data = translations[id]
    if (!data) return
    translateTitle.textContent = data.title
    translateSub.textContent = data.sub
    translateStructured.innerHTML = data.structured
    translatePlain.textContent = data.plain
    setImageMode('translated')
    setTextMode('structured')
  }
  document.querySelectorAll('.translate-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.translate-item').forEach((other) => other.classList.toggle('active', other === item))
      activeTranslate = item.dataset.translate
      applyTranslation(activeTranslate)
    })
  })
  document.querySelectorAll('[data-image-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setImageMode(btn.dataset.imageMode))
  })
  document.querySelectorAll('[data-translate-text]').forEach((btn) => {
    btn.addEventListener('click', () => setTextMode(btn.dataset.translateText))
  })
  applyTranslation('1')

  document.querySelectorAll('.topic-card').forEach((card) => {
    card.addEventListener('click', () => showView('topic-detail'))
  })
  document.getElementById('backToTopics')?.addEventListener('click', () => showView('topics'))
  document.querySelectorAll('.question-btn').forEach((btn) => {
    btn.addEventListener('click', () => notify('已发起主题对话（演示）。'))
  })

  let canvasZoom = 1
  const canvasStage = document.getElementById('canvasStage')
  const canvasZoomLabel = document.getElementById('canvasZoomLabel')
  const applyZoom = () => {
    canvasStage.style.zoom = canvasZoom
    canvasZoomLabel.textContent = `${Math.round(canvasZoom * 100)}%`
  }
  document.getElementById('canvasZoomIn')?.addEventListener('click', () => {
    canvasZoom = Math.min(1.4, canvasZoom + 0.1)
    applyZoom()
  })
  document.getElementById('canvasZoomOut')?.addEventListener('click', () => {
    canvasZoom = Math.max(0.6, canvasZoom - 0.1)
    applyZoom()
  })

  document.getElementById('planGenerate')?.addEventListener('click', () => {
    const goal = document.getElementById('planGoal')?.value.trim()
    if (!goal) {
      notify('请先填写学习目标。')
      return
    }
    const meta = document.getElementById('planMeta')
    if (meta) meta.textContent = `${new Date().toLocaleString('zh-CN', { hour12: false })} · deepseek-chat · 3 篇文献`
    notify('已生成 3 篇文献的阅读计划（演示）。')
  })

  if (chatThread) chatThread.scrollTop = chatThread.scrollHeight
})()
