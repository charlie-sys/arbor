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
      const active = button.dataset.view === name || (name === 'reader' && button.dataset.view === 'library')
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
      const match = !keyword || (row.dataset.title || '').toLowerCase().includes(keyword)
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

  const tabs = Array.from(document.querySelectorAll('.tab'))
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((item) => item.classList.toggle('active', item === tab))
      document.querySelectorAll('[data-panel-body]').forEach((panel) => {
        panel.hidden = panel.dataset.panelBody !== tab.dataset.panel
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
  const readerThread = document.querySelector('[data-panel-body="assistant"]')
  const readerComposer = readerThread?.querySelector('.composer')
  document.getElementById('readerSend')?.addEventListener('click', () => {
    if (readerInput && readerThread) sendInto(readerInput, readerThread, readerComposer)
  })
  readerInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (readerThread) sendInto(readerInput, readerThread, readerComposer)
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
      title: '译文',
      body: '本工作的目标是弥合上述研究空白，并提供一种广义的数据驱动老化估计方法。该方法仅使用来自部分负载曲线的原始电池传感器数据。为此，获取了描述电池电芯及相应充电曲线的高级参数。',
      extra: '开发了一种使用贝叶斯超参数调优的神经网络，该网络能够在无需执行进一步预处理或特征工程的情况下估计 SOH。'
    },
    2: {
      title: '图表翻译',
      body: '图 8：SOH 估计验证结果。横轴为循环次数，纵轴为 SOH 与 APE。不同颜色分别对应源模型、目标模型 1、目标模型 2 与参考值。',
      extra: '在 500 次循环后，目标模型 1 与参考值的偏差明显小于基线模型，说明迁移学习有效。'
    },
    3: {
      title: '扫描页译文',
      body: '实验在 25°C 下进行，分别使用 NCA、NCM 与 NCA-NCM 三种电池体系。所有充电片段均从 10% SOC 开始，并在不同截止电压下截断。',
      extra: '为避免数据泄漏，训练集与测试集按电池单体划分，而不是按时间片段随机划分。'
    }
  }
  const translateDetail = document.getElementById('translateDetail')
  document.querySelectorAll('.translate-item').forEach((item) => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.translate-item').forEach((other) => other.classList.toggle('active', other === item))
      const data = translations[item.dataset.translate]
      if (!data || !translateDetail) return
      translateDetail.innerHTML = `
        <h3>${data.title}</h3>
        <p>${data.body}</p>
        <div class="translate-image">模拟截图区域 · 保留原图</div>
        <p>${data.extra}</p>
        <div class="chips">
          <span class="pill sage">结构化译文</span>
          <span class="pill sage">纯文本可复制</span>
          <span class="pill sage">原文可追溯</span>
        </div>
      `
    })
  })

  if (chatThread) chatThread.scrollTop = chatThread.scrollHeight
})()
