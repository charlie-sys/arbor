export type BlindBoxCategory = 'body' | 'eyes' | 'mind' | 'tiny'

export interface BlindBoxCardText {
  zh: string
  en: string
}

export interface BlindBoxCard {
  id: string
  category: BlindBoxCategory
  text: BlindBoxCardText
  durationSec: number
}

export const BLIND_BOX_RECENT_LIMIT = 8

export const BLIND_BOX_CATEGORY_LABEL: Record<BlindBoxCategory, string> = {
  body: '身体',
  eyes: '眼睛',
  mind: '脑子',
  tiny: '小事'
}

export const BLIND_BOX_CARDS: BlindBoxCard[] = [
  {
    id: 'body-water',
    category: 'body',
    text: {
      zh: '去接一杯水，回来之前不刷手机。',
      en: 'Get a glass of water and leave your phone behind until you return.'
    },
    durationSec: 60
  },
  {
    id: 'body-stretch',
    category: 'body',
    text: {
      zh: '站起来，把手举过头顶，慢慢伸个懒腰。',
      en: 'Stand up, reach above your head, and stretch slowly.'
    },
    durationSec: 30
  },
  {
    id: 'body-shoulders',
    category: 'body',
    text: {
      zh: '肩膀上提两秒，再放松。重复五次。',
      en: 'Raise your shoulders for two seconds, then relax. Repeat five times.'
    },
    durationSec: 30
  },
  {
    id: 'body-walk',
    category: 'body',
    text: {
      zh: '离开座位走二十步，不用有目的地。',
      en: 'Leave your seat and walk twenty steps with no destination.'
    },
    durationSec: 60
  },
  {
    id: 'body-window',
    category: 'body',
    text: {
      zh: '走到窗边站一会儿，让眼睛离开屏幕。',
      en: 'Stand by a window for a moment and let your eyes leave the screen.'
    },
    durationSec: 90
  },
  {
    id: 'body-ankles',
    category: 'body',
    text: {
      zh: '坐着慢慢转动脚踝，左右各十次。',
      en: 'Sit back and slowly roll each ankle ten times.'
    },
    durationSec: 30
  },
  {
    id: 'body-warm-hands',
    category: 'body',
    text: {
      zh: '把双手搓热，轻轻敷在脸上。',
      en: 'Rub your hands together until warm, then rest them gently on your face.'
    },
    durationSec: 20
  },
  {
    id: 'body-breath',
    category: 'body',
    text: {
      zh: '走到门口，深吸一口气，再慢慢吐出来。',
      en: 'Walk to the doorway, take a deep breath, and let it out slowly.'
    },
    durationSec: 30
  },
  {
    id: 'eyes-far',
    category: 'eyes',
    text: {
      zh: '看向窗外最远的东西，停留二十秒。',
      en: 'Look at the farthest thing outside your window for twenty seconds.'
    },
    durationSec: 20
  },
  {
    id: 'eyes-blink',
    category: 'eyes',
    text: {
      zh: '把视线移开屏幕，慢慢眨眼十次。',
      en: 'Look away from the screen and blink slowly ten times.'
    },
    durationSec: 20
  },
  {
    id: 'eyes-close',
    category: 'eyes',
    text: {
      zh: '闭上眼睛，让眼周肌肉完全松开。',
      en: 'Close your eyes and let the muscles around them relax completely.'
    },
    durationSec: 30
  },
  {
    id: 'eyes-colors',
    category: 'eyes',
    text: {
      zh: '找三样不同颜色的东西，逐个看清楚。',
      en: 'Find three things in different colors and look at each one closely.'
    },
    durationSec: 30
  },
  {
    id: 'eyes-corner',
    category: 'eyes',
    text: {
      zh: '看向房间最远的角落，不思考任何事情。',
      en: 'Look at the farthest corner of the room and think about nothing.'
    },
    durationSec: 20
  },
  {
    id: 'eyes-sky',
    category: 'eyes',
    text: {
      zh: '如果看得见天空，抬头看一会儿。',
      en: 'If you can see the sky, look up for a little while.'
    },
    durationSec: 30
  },
  {
    id: 'mind-silence',
    category: 'mind',
    text: {
      zh: '什么都不做，安静待一分钟。',
      en: 'Do nothing at all and sit quietly for one minute.'
    },
    durationSec: 60
  },
  {
    id: 'mind-sounds',
    category: 'mind',
    text: {
      zh: '数出周围五种不同的声音。',
      en: 'Count five different sounds around you.'
    },
    durationSec: 60
  },
  {
    id: 'mind-song',
    category: 'mind',
    text: {
      zh: '离开屏幕，只听一首歌的前奏。',
      en: 'Look away from the screen and listen only to a song intro.'
    },
    durationSec: 30
  },
  {
    id: 'mind-small-win',
    category: 'mind',
    text: {
      zh: '想一件今天已经做得还不错的小事。',
      en: 'Think of one small thing you have already done well today.'
    },
    durationSec: 20
  },
  {
    id: 'mind-next-sip',
    category: 'mind',
    text: {
      zh: '先只想着下一口水，别安排之后的事。',
      en: 'Think only about your next sip of water. Plan nothing else.'
    },
    durationSec: 15
  },
  {
    id: 'mind-breath',
    category: 'mind',
    text: {
      zh: '慢慢吸气四秒，再呼气六秒，重复三次。',
      en: 'Inhale slowly for four seconds, exhale for six, and repeat three times.'
    },
    durationSec: 30
  },
  {
    id: 'mind-name-feeling',
    category: 'mind',
    text: {
      zh: '用一句话说出现在的状态，不评价它。',
      en: 'Describe how you feel in one sentence, without judging it.'
    },
    durationSec: 20
  },
  {
    id: 'mind-ceiling',
    category: 'mind',
    text: {
      zh: '抬头看看天花板，让思绪空白十秒。',
      en: 'Look up at the ceiling and let your mind go blank for ten seconds.'
    },
    durationSec: 10
  },
  {
    id: 'tiny-phone',
    category: 'tiny',
    text: {
      zh: '把手机屏幕朝下放一分钟。',
      en: 'Place your phone face down for one minute.'
    },
    durationSec: 60
  },
  {
    id: 'tiny-plant',
    category: 'tiny',
    text: {
      zh: '给身边的植物浇一点水。',
      en: 'Give any plant nearby a little water.'
    },
    durationSec: 30
  },
  {
    id: 'tiny-desk',
    category: 'tiny',
    text: {
      zh: '只整理桌面上的一小角，不用扩大范围。',
      en: 'Tidy just one small corner of your desk. Do not expand the task.'
    },
    durationSec: 30
  },
  {
    id: 'tiny-drink',
    category: 'tiny',
    text: {
      zh: '给自己倒一杯热饮或者温水。',
      en: 'Pour yourself a warm drink or a glass of water.'
    },
    durationSec: 60
  },
  {
    id: 'tiny-hands',
    category: 'tiny',
    text: {
      zh: '把手从键盘和鼠标上拿开，放三十秒。',
      en: 'Take your hands off the keyboard and mouse for thirty seconds.'
    },
    durationSec: 30
  },
  {
    id: 'tiny-window',
    category: 'tiny',
    text: {
      zh: '找到离你最远的一扇窗，看一会儿。',
      en: 'Find the window farthest from you and look outside for a moment.'
    },
    durationSec: 30
  },
  {
    id: 'tiny-space',
    category: 'tiny',
    text: {
      zh: '把椅子往后推一点，给身体多留一点空间。',
      en: 'Push your chair back a little and give yourself more space.'
    },
    durationSec: 15
  },
  {
    id: 'tiny-notification',
    category: 'tiny',
    text: {
      zh: '关掉一个不重要的通知，再回来。',
      en: 'Turn off one nonessential notification, then come back.'
    },
    durationSec: 30
  },
  {
    id: 'tiny-touch',
    category: 'tiny',
    text: {
      zh: '摸一摸身边质感舒服的东西，感受十秒。',
      en: 'Touch something nearby that feels pleasant and notice it for ten seconds.'
    },
    durationSec: 10
  },
  {
    id: 'tiny-back',
    category: 'tiny',
    text: {
      zh: '把背部靠回椅背，让身体被支撑住。',
      en: 'Settle your back against the chair and let it support you.'
    },
    durationSec: 15
  }
]

export function updateRecentCardIds(
  recentIds: string[],
  nextId: string,
  limit = BLIND_BOX_RECENT_LIMIT
): string[] {
  return [...recentIds.filter((id) => id !== nextId), nextId].slice(-Math.max(0, limit))
}

export function pickBlindBoxCard(
  cards: BlindBoxCard[],
  recentIds: string[],
  random: () => number = Math.random
): BlindBoxCard {
  if (!cards.length) throw new Error('No blind-box cards are available')

  const recent = new Set(recentIds)
  const notRecent = cards.filter((card) => !recent.has(card.id))
  const pool = notRecent.length ? notRecent : cards
  const lastCard = cards.find((card) => card.id === recentIds.at(-1))
  const categories = [...new Set(pool.map((card) => card.category))].filter(
    (category) => category !== lastCard?.category
  )
  const categoryPool = categories.length
    ? pool.filter((card) => categories.includes(card.category))
    : pool
  const index = Math.min(categoryPool.length - 1, Math.floor(random() * categoryPool.length))
  return categoryPool[index]
}
