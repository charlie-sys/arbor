import { zzzMarkup, sparkleMarkup, thoughtMarkup, speedMarkup } from './art.mjs'
import { bookMarkup, typewriterMarkup, fishMarkup, crankMarkup, papersMarkup } from './props.mjs'

const rest = { pawL: { x: 74, y: 188, rot: -6 }, pawR: { x: 126, y: 188, rot: 6 } }
const blink = (i, at = 5) => (i === at ? 0.08 : 1)

export const STATES = {
  typing: {
    label: '正在写作',
    fps: 10,
    frames: [0, 1, 2, 3, 4, 5].map((i) => ({
      bodyY: i % 2 ? -0.6 : 0,
      headY: i % 2 ? -0.8 : 0,
      mouth: 1.2,
      tongue: 0.5,
      eyeOpen: blink(i, 5),
      pupilY: 1,
      tail: i % 2 ? 4 : -6,
      scarf: i % 2 ? 1.5 : -0.5,
      pawL: { x: 88, y: i % 2 ? 188 : 191, rot: -8 },
      pawR: { x: 112, y: i % 2 ? 191 : 188, rot: 8 },
      propMarkup: typewriterMarkup(i)
    }))
  },
  reading: {
    label: '正在阅读',
    fps: 5,
    frames: [0, 1, 2, 3, 4, 5].map((i) => ({
      headY: i === 2 ? 1.2 : 0,
      headRot: [-1, 0, 1, 2, 1, 0][i],
      eyeOpen: blink(i, 4),
      pupilY: 1.5,
      mouth: 0,
      tail: [-4, 0, 4, 0, -4, 0][i],
      scarf: [0, 1, 2, 1, 0, -1][i],
      pawL: { x: 78, y: 181, rot: -14 },
      pawR: { x: 122, y: 181, rot: 14 },
      propMarkup: bookMarkup([0, 7, 15, 0, 0, 0][i])
    }))
  },
  thinking: {
    label: '正在思考',
    fps: 4,
    frames: [0, 1, 2, 3, 4, 5].map((i) => ({
      headRot: [-6, -4, 0, 4, 6, 4][i],
      headY: [0, -0.5, 0, 0.5, 0, -0.5][i],
      earL: [-6, -2, 0, 2, 4, 2][i],
      earR: [2, 4, 2, 0, -2, -4][i],
      eyeOpen: i === 2 ? 0.55 : 0.85,
      pupilX: 1.5,
      mouth: 0,
      tail: [-3, 1, 4, 1, -3, 1][i],
      chinPaw: true,
      ...rest,
      overlayMarkup: thoughtMarkup(i)
    }))
  },
  active: {
    label: '四处看看',
    fps: 8,
    frames: [0, 1, 2, 3, 4, 5].map((i) => ({
      headRot: [-5, -2, 2, 5, 2, -2][i],
      earL: [-4, 0, 2, 4, 2, 0][i],
      earR: [4, 2, 0, -2, -4, -2][i],
      pupilX: [-2, -1, 1, 2, 1, -1][i],
      mouth: 1,
      tail: [-18, 12, -18, 12, -18, 12][i],
      bodyY: i % 2 ? -0.8 : 0,
      scarf: [2, 0, -2, 0, 2, 0][i],
      ...rest
    }))
  },
  idle: {
    label: '摸一会儿鱼',
    fps: 3,
    frames: [0, 1, 2, 3, 4, 5].map((i) => ({
      bodyRot: 2,
      headRot: 3,
      headY: 1,
      eyeOpen: 0.52,
      pupilY: 2,
      mouth: 1.4,
      tongue: i === 2 ? 0.8 : 0,
      earL: 4,
      earR: -4,
      tail: [0, 9, 14, 6, -2, 4][i],
      scarf: 1,
      pawL: { x: 88, y: 184, rot: -18 },
      pawR: { x: 112, y: 184, rot: 18 },
      propMarkup: fishMarkup(i)
    }))
  },
  away: {
    label: '睡着了',
    fps: 2,
    frames: [0, 1, 2, 3].map((i) => ({
      sleep: true,
      bodyY: [0, -1.2, -1.8, -1.2][i],
      overlayMarkup: zzzMarkup(143, 148 - [0, 5, 10, 14][i], [0.35, 0.55, 0.75, 0.5][i])
    }))
  },
  busy: {
    label: 'AI 正在干活',
    fps: 10,
    frames: [0, 1, 2, 3, 4, 5].map((i) => ({
      bodyY: i % 2 ? -0.8 : 0,
      headRot: i % 2 ? -1.5 : 1.5,
      eyeOpen: 0.9,
      pupilX: 2,
      mouth: 0.6,
      tail: i % 2 ? -8 : -2,
      scarf: i % 2 ? 2 : 0,
      pawL: { x: 84, y: 180, rot: -20 },
      pawR: { x: 118, y: 184, rot: 20 },
      backMarkup: papersMarkup(i),
      propMarkup: crankMarkup(i),
      overlayMarkup: speedMarkup(i)
    }))
  },
  happy: {
    label: '开心',
    fps: 12,
    frames: [0, 1, 2, 3, 4, 5].map((i) => ({
      bodyY: [0, -14, -26, -18, -6, 0][i],
      bodyRot: [0, -3, 4, -2, 0, 0][i],
      headRot: [0, 2, -2, 2, 0, 0][i],
      happyEyes: true,
      mouth: 2.4,
      tongue: 1,
      earL: [-6, -10, -4, -8, -6, -2][i],
      earR: [6, 10, 4, 8, 6, 2][i],
      tail: [-30, 22, -30, 22, -30, 12][i],
      scarf: [0, 3, -3, 3, 0, 0][i],
      pawL: { x: 68, y: 160, rot: -50 },
      pawR: { x: 132, y: 160, rot: 50 },
      overlayMarkup: sparkleMarkup(i, i < 4 ? 1 : 0.55)
    }))
  }
}
