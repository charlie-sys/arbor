import { C, DEFS, head, body, sleepBody, scarf, tail } from './shape.mjs'

export const DEFAULT_POSE = {
  bodyX: 0,
  bodyY: 0,
  bodyRot: 0,
  headX: 0,
  headY: 0,
  headRot: 0,
  earL: 0,
  earR: 0,
  eyeOpen: 1,
  pupilX: 0,
  pupilY: 0,
  happyEyes: false,
  mouth: 0,
  tongue: 0,
  tail: -6,
  scarf: 0,
  pawL: { x: 74, y: 188, rot: -6 },
  pawR: { x: 126, y: 188, rot: 6 },
  sleep: false,
  propMarkup: '',
  backMarkup: '',
  overlayMarkup: ''
}

export function renderSvg(rawPose) {
  const pose = { ...DEFAULT_POSE, ...rawPose }
  const bodyMarkup = pose.sleep ? sleepBody(pose) : body(pose)
  const headMarkup = pose.sleep ? '' : head(pose)
  const tailMarkup = pose.sleep ? '' : tail(pose)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="230" viewBox="0 0 200 230">
    ${DEFS}
    <ellipse cx="100" cy="${pose.sleep ? 217 : 219}" rx="${pose.sleep ? 58 : 54}" ry="8.5" fill="#2b2118" opacity=".2" filter="url(#soft)"/>
    ${pose.backMarkup}
    <g transform="translate(${pose.bodyX} ${pose.bodyY})">
      ${tailMarkup}
      ${pose.sleep ? '' : scarf(pose, false)}
      ${bodyMarkup}
      ${pose.sleep ? '' : scarf(pose, true)}
      ${headMarkup}
    </g>
    ${pose.sleep ? '' : `<rect x="0" y="0" width="200" height="230" filter="url(#grain)" opacity=".085" clip-path="url(#charClip)"/>`}
    ${pose.propMarkup}
    ${pose.overlayMarkup}
  </svg>`
}

export function zzzMarkup(x, y, op = 1) {
  const z = (sx, sy, size, o) =>
    `<path d="M ${sx} ${sy} L ${sx + size} ${sy} L ${sx} ${sy + size} L ${sx + size} ${sy + size}" fill="none" stroke="${C.fur2}" stroke-width="${Math.max(1.4, size * 0.16)}" stroke-linecap="round" stroke-linejoin="round" opacity="${o}"/>`
  return `<g transform="translate(${x} ${y})" opacity="${op}">
    ${z(0, 8, 5, 0.5)}${z(9, -2, 7, 0.7)}${z(21, -16, 9, 0.9)}
  </g>`
}

export function sparkleMarkup(frame, op = 1) {
  const pts = [
    [44, 78, 0], [154, 92, 1], [36, 142, 2], [162, 152, 3], [54, 52, 4], [148, 52, 5]
  ]
  return pts
    .map(([x, y, i]) => {
      const s = 3 + ((frame + i * 2) % 4) * 1.6
      return `<path d="M ${x} ${y - s} L ${x + s * 0.45} ${y - s * 0.45} L ${x + s} ${y} L ${x + s * 0.45} ${y + s * 0.45} L ${x} ${y + s} L ${x - s * 0.45} ${y + s * 0.45} L ${x - s} ${y} L ${x - s * 0.45} ${y - s * 0.45} Z" fill="#f4d68f" opacity="${op * (0.45 + ((frame + i) % 3) * 0.2)}"/>`
    })
    .join('')
}

export function thoughtMarkup(frame, op = 1) {
  const x = 133
  const y = 58
  const dots = [0, 1, 2]
    .map((i) => {
      const active = (frame + i) % 6 < 3
      return `<circle cx="${x + i * 10}" cy="${y - i * 7}" r="${2.2 + i * 0.6}" fill="${C.fur3}" opacity="${active ? op * 0.85 : op * 0.35}"/>`
    })
    .join('')
  return `<g>${dots}</g>`
}

export function speedMarkup(frame, op = 1) {
  const lines = [0, 1, 2]
    .map((i) => {
      const y = 168 + i * 9
      const x = 152 + ((frame + i) % 3) * 5
      return `<path d="M ${x} ${y} L ${x + 16} ${y}" stroke="#b9c3d2" stroke-width="2.4" stroke-linecap="round" opacity="${op * (0.3 + ((frame + i) % 2) * 0.25)}"/>`
    })
    .join('')
  return lines
}
