(() => {
  // 问卷结果回传地址：在 formspree.io 创建表单后，把 f/ 后面的 ID 填进来。
  // 例如 https://formspree.io/f/abcdwxyz
  const FORMSPREE_ENDPOINT = 'https://formspree.io/f/YOUR_FORM_ID'

  const form = document.getElementById('survey')
  const success = document.getElementById('success')
  const summary = document.getElementById('summary')
  const submitStatus = document.getElementById('submitStatus')
  const progressText = document.getElementById('progressText')
  const progressBar = document.getElementById('progressBar')
  const fillInput = document.getElementById('q10')
  const fillCount = document.getElementById('fillCount')
  const requiredNames = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9']
  const labels = {
    q1: '主要身份',
    q2: '使用目的',
    q3: '使用频率',
    q4: '最常用功能',
    q5: '列表宽度/列宽拖动的帮助度',
    q6: '视觉界面满意度',
    q7: '深色模式使用',
    q8: '最需要改进的方面',
    q9: '推荐意愿',
    q10: '最希望增加或改进的功能'
  }

  const checkedValues = (name) =>
    Array.from(form.querySelectorAll(`input[name="${name}"]:checked`)).map((input) => input.value)

  const isAnswered = (name) => checkedValues(name).length > 0

  const updateProgress = () => {
    const done = requiredNames.filter(isAnswered).length
    progressText.textContent = `已完成 ${done} / ${requiredNames.length}`
    progressBar.style.width = `${(done / requiredNames.length) * 100}%`
  }

  const updateCount = (group) => {
    const name = group.querySelector('input')?.name
    const max = Number(group.dataset.max || 99)
    const counter = form.querySelector(`[data-count-for="${name}"]`)
    if (!counter) return
    const count = group.querySelectorAll('input:checked').length
    counter.textContent = `已选 ${count} / ${max}`
    counter.classList.toggle('limit', count >= max)
  }

  form.querySelectorAll('.options[data-max]').forEach((group) => {
    updateCount(group)
    group.addEventListener('change', (event) => {
      const max = Number(group.dataset.max || 99)
      const checked = Array.from(group.querySelectorAll('input:checked'))
      if (checked.length > max) {
        const input = event.target
        if (input && input.checked) input.checked = false
        updateCount(group)
        return
      }
      updateCount(group)
      updateProgress()
    })
  })

  form.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      input.closest('.question')?.classList.remove('invalid')
      updateProgress()
    })
  })

  fillInput?.addEventListener('input', () => {
    fillCount.textContent = `${fillInput.value.length} / 200`
  })

  const sendToFormspree = async (json) => {
    const notConfigured = !FORMSPREE_ENDPOINT || FORMSPREE_ENDPOINT.includes('YOUR_FORM_ID')
    if (notConfigured) {
      if (submitStatus) {
        submitStatus.textContent = '回传地址未配置：请在 questionnaire.js 顶部填入 Formspree 端点。可先复制或下载 JSON 手动发送。'
        submitStatus.className = 'submit-status warn'
      }
      return
    }
    if (submitStatus) {
      submitStatus.textContent = '正在提交…'
      submitStatus.className = 'submit-status'
    }
    try {
      const res = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: json
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (submitStatus) {
        submitStatus.textContent = '已提交成功，感谢你的反馈！'
        submitStatus.className = 'submit-status ok'
      }
    } catch {
      if (submitStatus) {
        submitStatus.textContent = '自动提交失败：请复制或下载 JSON 发送给 Arbor 团队。'
        submitStatus.className = 'submit-status error'
      }
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    form.querySelectorAll('.question').forEach((question) => question.classList.remove('invalid'))
    const missing = requiredNames.filter((name) => !isAnswered(name))
    if (missing.length) {
      missing.forEach((name) => {
        form.querySelector(`[data-question="${name}"]`)?.classList.add('invalid')
      })
      const first = form.querySelector(`[data-question="${missing[0]}"]`)
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      first?.querySelector('input')?.focus({ preventScroll: true })
      return
    }

    const answers = {}
    requiredNames.forEach((name) => {
      const values = checkedValues(name)
      answers[name] = name === 'q1' || name === 'q3' || name === 'q5' || name === 'q6' || name === 'q7' || name === 'q9'
        ? values[0]
        : values
    })
    answers.q10 = fillInput?.value.trim() || ''

    const lines = [
      'Arbor 用户体验问卷',
      `提交时间：${new Date().toLocaleString('zh-CN')}`,
      ''
    ]
    Object.keys(labels).forEach((name) => {
      const value = answers[name]
      const text = Array.isArray(value) ? value.join('、') : value
      lines.push(`${labels[name]}：${text || '（未填写）'}`)
    })
    const json = JSON.stringify({ product: 'Arbor', submittedAt: new Date().toISOString(), answers }, null, 2)
    if (summary) summary.textContent = lines.join('\n')

    form.style.display = 'none'
    document.querySelector('.progress-wrap')?.setAttribute('hidden', 'hidden')
    success?.classList.add('visible')
    success?.scrollIntoView({ behavior: 'smooth', block: 'start' })

    const copyButton = document.getElementById('copyResult')
    if (copyButton) {
      copyButton.onclick = async () => {
        try {
          await navigator.clipboard.writeText(json)
          copyButton.textContent = '已复制'
        } catch {
          copyButton.textContent = '复制失败，请手动选择摘要'
        }
        window.setTimeout(() => (copyButton.textContent = '复制答案'), 2200)
      }
    }

    const downloadButton = document.getElementById('downloadResult')
    if (downloadButton) {
      downloadButton.onclick = () => {
        const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `arbor-survey-${new Date().toISOString().slice(0, 10)}.json`
        link.click()
        URL.revokeObjectURL(url)
      }
    }

    const restart = document.getElementById('restart')
    if (restart) {
      restart.onclick = () => {
        form.reset()
        form.style.display = ''
        document.querySelector('.progress-wrap')?.removeAttribute('hidden')
        success?.classList.remove('visible')
        fillCount.textContent = '0 / 200'
        if (submitStatus) {
          submitStatus.textContent = ''
          submitStatus.className = 'submit-status'
        }
        form.querySelectorAll('.options[data-max]').forEach(updateCount)
        updateProgress()
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }

    sendToFormspree(json)
  })

  updateProgress()
})()
