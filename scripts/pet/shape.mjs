export const C = {
  fur1: '#9aa4b4',
  fur2: '#646d7d',
  fur3: '#7e8797',
  cream: '#f7f0e3',
  cream2: '#e6dbc9',
  white: '#fffdf8',
  blush: '#e9a6a2',
  inner: '#e3b3b8',
  dark: '#3a3338',
  iris: '#7cc4e6',
  iris2: '#3f8fb8',
  scarf: '#8aa374',
  scarf2: '#5f7a4f',
  gold: '#c39a5f',
  glass: '#4a3527',
  acorn: '#bd854b',
  cap: '#6c4a2f'
}

export const DEFS = `
<defs>
  <linearGradient id="furHead" x1="0" y1="0" x2="0.35" y2="1">
    <stop offset="0" stop-color="${C.fur1}"/><stop offset="0.55" stop-color="${C.fur3}"/><stop offset="1" stop-color="${C.fur2}"/>
  </linearGradient>
  <linearGradient id="furBody" x1="0.1" y1="0" x2="0.9" y2="1">
    <stop offset="0" stop-color="${C.fur1}"/><stop offset="1" stop-color="${C.fur2}"/>
  </linearGradient>
  <linearGradient id="creamG" x1="0.2" y1="0" x2="0.8" y2="1">
    <stop offset="0" stop-color="${C.white}"/><stop offset="0.7" stop-color="${C.cream}"/><stop offset="1" stop-color="${C.cream2}"/>
  </linearGradient>
  <radialGradient id="iris" cx="0.35" cy="0.3" r="0.8">
    <stop offset="0" stop-color="#c8efff"/><stop offset="0.45" stop-color="${C.iris}"/><stop offset="1" stop-color="${C.iris2}"/>
  </radialGradient>
  <linearGradient id="scarfG" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0" stop-color="#a6bd90"/><stop offset="0.6" stop-color="${C.scarf}"/><stop offset="1" stop-color="${C.scarf2}"/>
  </linearGradient>
  <filter id="brush" x="-20%" y="-20%" width="140%" height="140%">
    <feTurbulence type="fractalNoise" baseFrequency="0.055" numOctaves="3" seed="9" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <filter id="soft"><feGaussianBlur stdDeviation="4.5"/></filter>
  <filter id="grain">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/>
    <feColorMatrix in="n" type="saturate" values="0"/>
  </filter>
  <clipPath id="charClip">
    <ellipse cx="100" cy="104" rx="49" ry="44"/>
    <ellipse cx="100" cy="169" rx="40" ry="36"/>
    <ellipse cx="100" cy="206" rx="31" ry="11"/>
  </clipPath>
</defs>`

const dabs = (list, color, op) =>
  list
    .map(
      ([x, y, r, a]) =>
        `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${(r * 0.34).toFixed(1)}" transform="rotate(${a} ${x} ${y})" fill="${color}" opacity="${op}"/>`
    )
    .join('')

const HEAD_DABS = [
  [61, 82, 6, -38], [55, 96, 5.5, -55], [54, 112, 5, -70], [60, 128, 5.5, -20],
  [72, 138, 5, 8], [139, 82, 6, 38], [145, 96, 5.5, 55], [146, 112, 5, 70],
  [140, 128, 5.5, 20], [128, 138, 5, -8], [78, 66, 5, -68], [122, 66, 5, 68]
]
const BODY_DABS = [
  [64, 160, 5.5, -50], [58, 176, 5, -72], [62, 192, 5, -30], [136, 160, 5.5, 50],
  [142, 176, 5, 72], [138, 192, 5, 30], [78, 204, 6, 4], [122, 204, 6, -4]
]

function eye(x, y, p) {
  if (p.happyEyes) {
    return `<path d="M ${x - 7} ${y + 1.5} Q ${x} ${y - 6} ${x + 7} ${y + 1.5}" fill="none" stroke="${C.dark}" stroke-width="2.6" stroke-linecap="round"/>`
  }
  if (p.eyeOpen < 0.22) {
    return `<path d="M ${x - 7} ${y} Q ${x} ${y + 2.4} ${x + 7} ${y}" fill="none" stroke="${C.dark}" stroke-width="2.2" stroke-linecap="round"/>`
  }
  const o = Math.min(1, Math.max(0.22, p.eyeOpen)).toFixed(2)
  const px = x + p.pupilX
  const py = y + p.pupilY
  return `<g transform="translate(${x} ${y}) scale(1 ${o}) translate(${-x} ${-y})">
    <ellipse cx="${x}" cy="${y}" rx="9.4" ry="9.8" fill="${C.white}"/>
    <circle cx="${px}" cy="${py + 1}" r="6.1" fill="url(#iris)"/>
    <circle cx="${px}" cy="${py + 1}" r="3.1" fill="#22303e"/>
    <circle cx="${px - 2}" cy="${py - 1.8}" r="1.9" fill="#fff" opacity=".95"/>
    <circle cx="${px + 2.3}" cy="${py + 3}" r="1.1" fill="#d9f4ff" opacity=".85"/>
    <path d="M ${x - 8} ${y - 5.5} Q ${x} ${y - 10} ${x + 8} ${y - 5.5}" fill="none" stroke="#4c5563" stroke-width="1.5" opacity=".5"/>
  </g>`
}

export function head(pose) {
  const { headX, headY, headRot, earL, earR } = pose
  return `<g transform="translate(${headX} ${headY}) rotate(${headRot} 100 142)">
    <g transform="rotate(${earL} 80 88)">
      <path d="M 62 92 C 52 76 50 56 58 47 C 68 50 80 63 87 76 Z" fill="url(#furHead)" filter="url(#brush)"/>
      <path d="M 64 83 C 59 73 58 63 62 57 C 67 60 74 69 78 78 Z" fill="${C.inner}" opacity=".5"/>
    </g>
    <g transform="rotate(${earR} 120 88)">
      <path d="M 138 92 C 148 76 150 56 142 47 C 132 50 120 63 113 76 Z" fill="url(#furHead)" filter="url(#brush)"/>
      <path d="M 136 83 C 141 73 142 63 138 57 C 133 60 126 69 122 78 Z" fill="${C.inner}" opacity=".5"/>
    </g>
    <g filter="url(#brush)">
      <ellipse cx="100" cy="104" rx="47" ry="42" fill="url(#furHead)"/>
      <path d="M 55 112 L 42 121 L 57 125 Z" fill="${C.cream}"/>
      <path d="M 145 112 L 158 121 L 143 125 Z" fill="${C.cream}"/>
      <path d="M 100 63 C 93 82 88 98 82 113 C 89 123 111 123 118 113 C 112 98 107 82 100 63 Z" fill="url(#creamG)"/>
      <ellipse cx="69" cy="122" rx="15.5" ry="10.5" fill="url(#creamG)"/>
      <ellipse cx="131" cy="122" rx="15.5" ry="10.5" fill="url(#creamG)"/>
      <ellipse cx="100" cy="127" rx="22" ry="15" fill="url(#creamG)"/>
      <path d="M 55 103 C 63 112 62 123 56 131 C 50 124 49 113 55 103 Z" fill="${C.fur3}" opacity=".5"/>
      <path d="M 145 103 C 137 112 138 123 144 131 C 150 124 151 113 145 103 Z" fill="${C.fur3}" opacity=".5"/>
      <ellipse cx="77" cy="77" rx="17" ry="8.5" transform="rotate(-28 77 77)" fill="#c9d3e0" opacity=".22"/>
      <path d="M 60 92 C 63 113 74 130 90 139" fill="none" stroke="#4e5665" stroke-width="8" opacity=".09" stroke-linecap="round"/>
      ${dabs(HEAD_DABS, C.cream, 0.36)}
      ${dabs(HEAD_DABS, C.fur2, 0.17)}
    </g>
    <g>
      <ellipse cx="80" cy="86" rx="9" ry="5.2" fill="${C.cream}" opacity=".9" transform="rotate(-14 80 86)"/>
      <ellipse cx="120" cy="86" rx="9" ry="5.2" fill="${C.cream}" opacity=".9" transform="rotate(14 120 86)"/>
      ${eye(82, 103, pose)}
      ${eye(118, 103, pose)}
      <g fill="none" stroke="${C.glass}" stroke-width="2.4" stroke-linecap="round">
        <circle cx="82" cy="103" r="14.4"/>
        <circle cx="118" cy="103" r="14.4"/>
        <path d="M 96.6 101 Q 100 97.4 103.4 101"/>
        <path d="M 67.6 100 L 57 96"/>
        <path d="M 132.4 100 L 143 96"/>
      </g>
      ${pose.chinPaw ? `<g transform="rotate(-18 90 141)">
        <ellipse cx="90" cy="141" rx="9.4" ry="8.2" fill="url(#creamG)" stroke="#cfc4b2" stroke-width="1.1"/>
        <path d="M 86 144 L 86 147 M 90 144.5 L 90 147.5 M 94 144 L 94 147" stroke="#c9bca8" stroke-width="1" stroke-linecap="round"/>
      </g>` : ''}
      <path d="M 73 95 Q 82 89 91 95" fill="none" stroke="${C.gold}" stroke-width="1.1" opacity=".55"/>
      <path d="M 109 95 Q 118 89 127 95" fill="none" stroke="${C.gold}" stroke-width="1.1" opacity=".55"/>
      <ellipse cx="70" cy="122" rx="7.5" ry="4" fill="${C.blush}" opacity=".5"/>
      <ellipse cx="130" cy="122" rx="7.5" ry="4" fill="${C.blush}" opacity=".5"/>
      <path d="M 93 114 Q 100 110.4 107 114 Q 105 121 100 122.6 Q 95 121 93 114 Z" fill="${C.dark}"/>
      <path d="M 97 113 Q 100 112 103 113" fill="none" stroke="#6b6268" stroke-width="1" opacity=".8"/>
      <path d="M 100 122.4 L 100 126" stroke="${C.dark}" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M 92 128 Q 100 ${128 + pose.mouth} 108 128" fill="none" stroke="${C.dark}" stroke-width="1.8" stroke-linecap="round"/>
      ${pose.tongue > 0 ? `<ellipse cx="100" cy="130" rx="5.4" ry="4.2" fill="#e78f9b"/><path d="M 96 130 L 104 130" stroke="#c96f7d" stroke-width="1" opacity=".6"/>` : ''}
      <circle cx="76" cy="128" r="0.9" fill="${C.fur2}" opacity=".5"/>
      <circle cx="124" cy="128" r="0.9" fill="${C.fur2}" opacity=".5"/>
    </g>
  </g>`
}

export function arm(p, side) {
  const sx = side === 'l' ? 72 : 128
  const sy = 158
  const paw = side === 'l' ? p.pawL : p.pawR
  const bend = side === 'l' ? -7 : 7
  const mx = (sx + paw.x) / 2 + bend
  const my = (sy + paw.y) / 2 + 4
  return `<path d="M ${sx} ${sy} Q ${mx} ${my} ${paw.x} ${paw.y}" fill="none" stroke="#5c6472" stroke-width="12.6" stroke-linecap="round"/>
    <path d="M ${sx} ${sy} Q ${mx} ${my} ${paw.x} ${paw.y}" fill="none" stroke="#8b94a3" stroke-width="10.2" stroke-linecap="round"/>
    <g transform="rotate(${paw.rot} ${paw.x} ${paw.y})">
      <ellipse cx="${paw.x}" cy="${paw.y}" rx="9.2" ry="8" fill="url(#creamG)" stroke="#cfc4b2" stroke-width="1.1"/>
      <path d="M ${paw.x - 3.5} ${paw.y + 2.4} L ${paw.x - 3.5} ${paw.y + 5.2} M ${paw.x} ${paw.y + 3} L ${paw.x} ${paw.y + 5.8} M ${paw.x + 3.5} ${paw.y + 2.4} L ${paw.x + 3.5} ${paw.y + 5.2}" stroke="#c9bca8" stroke-width="1" stroke-linecap="round"/>
    </g>`
}

export function tail(pose) {
  return `<g transform="rotate(${pose.tail} 132 188)">
    <g filter="url(#brush)">
      <path d="M 126 191 C 150 196 170 181 173 158 C 175 145 169 135 160 136 C 151 137 149 148 152 158 C 156 171 147 181 134 185 C 129 187 125 189 124 191 Z" fill="url(#furBody)"/>
      <path d="M 164 145 C 169 149 169 157 166 165 C 163 173 157 179 150 181 C 157 172 160 160 158 151 Z" fill="${C.cream}" opacity=".95"/>
      ${dabs([[150, 170, 4, -20], [158, 160, 4, 30]], C.cream, 0.3)}
    </g>
  </g>`
}

export function scarf(pose, front) {
  if (!front) {
    return `<path d="M 61 144 Q 100 159 139 144 L 141 157 Q 100 172 59 157 Z" fill="url(#scarfG)" filter="url(#brush)"/>
      <path d="M 64 149 Q 100 163 136 149" fill="none" stroke="#b9cba6" stroke-width="2" opacity=".55" stroke-dasharray="3 4"/>`
  }
  return `<g transform="rotate(${pose.scarf} 126 154)">
      <path d="M 124 154 C 134 166 132 180 120 186 C 116 176 118 163 121 154 Z" fill="url(#scarfG)"/>
      <path d="M 122 161 C 126 169 125 176 121 180" fill="none" stroke="#b9cba6" stroke-width="1.8" opacity=".5" stroke-dasharray="2.5 3.5"/>
      <ellipse cx="124" cy="153" rx="6.5" ry="5" fill="${C.scarf2}"/>
    </g>
    <g transform="translate(100 160) rotate(-6)">
      <ellipse cx="0" cy="3" rx="4.4" ry="5.6" fill="${C.acorn}"/>
      <path d="M -5.4 0 Q 0 -5.2 5.4 0 Q 0 2.2 -5.4 0 Z" fill="${C.cap}"/>
      <path d="M 0 -4.4 L 0.6 -7" stroke="${C.cap}" stroke-width="1.6" stroke-linecap="round"/>
      <circle cx="-1.4" cy="3" r="0.8" fill="#e2b27a" opacity=".8"/>
    </g>`
}

export function body(pose) {
  return `<g transform="translate(${pose.bodyX} ${pose.bodyY}) rotate(${pose.bodyRot} 100 192)">
    <g filter="url(#brush)">
      <ellipse cx="100" cy="169" rx="39" ry="35" fill="url(#furBody)"/>
      <ellipse cx="100" cy="176" rx="27" ry="26" fill="url(#creamG)"/>
      <path d="M 74 168 Q 100 158 126 168" fill="none" stroke="${C.cream2}" stroke-width="2" opacity=".6"/>
      ${dabs(BODY_DABS, C.cream, 0.26)}
      ${dabs(BODY_DABS, C.fur2, 0.12)}
    </g>
    <ellipse cx="85" cy="205" rx="13" ry="8" fill="url(#creamG)"/>
    <ellipse cx="115" cy="205" rx="13" ry="8" fill="url(#creamG)"/>
    <path d="M 80 207 L 80 210 M 85 207.5 L 85 211 M 90 207 L 90 210 M 110 207 L 110 210 M 115 207.5 L 115 211 M 120 207 L 120 210" stroke="#cbbda9" stroke-width="1.1" stroke-linecap="round"/>
    ${arm(pose, 'l')}
    ${arm(pose, 'r')}
  </g>`
}

export function sleepBody(pose) {
  return `<g transform="translate(${pose.bodyX} ${pose.bodyY})">
    <g filter="url(#brush)">
      <ellipse cx="100" cy="195" rx="52" ry="23" fill="url(#furBody)"/>
      <ellipse cx="92" cy="201" rx="34" ry="14" fill="url(#creamG)" opacity=".9"/>
      <path d="M 42 196 C 30 186 34 176 46 176 C 58 176 64 186 56 196 Z" fill="url(#furBody)"/>
      ${dabs([[64, 188, 5, -40], [132, 188, 5, 40], [70, 205, 5, 10], [126, 205, 5, -10]], C.cream, 0.27)}
    </g>
    <g transform="translate(-4 68) rotate(-9 80 104) scale(0.94)">
      <g filter="url(#brush)">
        <path d="M 52 88 C 44 76 44 62 52 55 C 60 58 70 68 76 80 Z" fill="url(#furHead)"/>
        <path d="M 108 88 C 116 76 116 62 108 55 C 100 58 90 68 84 80 Z" fill="url(#furHead)"/>
        <ellipse cx="80" cy="104" rx="43" ry="38" fill="url(#furHead)"/>
        <path d="M 80 66 C 74 83 70 97 65 111 C 72 120 90 120 96 111 C 91 97 86 83 80 66 Z" fill="url(#creamG)"/>
        <ellipse cx="55" cy="120" rx="16" ry="11" fill="url(#creamG)"/>
        <ellipse cx="105" cy="120" rx="16" ry="11" fill="url(#creamG)"/>
        <ellipse cx="80" cy="125" rx="20" ry="14" fill="url(#creamG)"/>
      </g>
      <path d="M 67 103 Q 73 108 79 103 M 89 103 Q 95 108 101 103" fill="none" stroke="${C.dark}" stroke-width="2.2" stroke-linecap="round"/>
      <ellipse cx="57" cy="121" rx="6.5" ry="3.5" fill="${C.blush}" opacity=".5"/>
      <ellipse cx="103" cy="121" rx="6.5" ry="3.5" fill="${C.blush}" opacity=".5"/>
      <path d="M 74 113 Q 80 110 86 113 Q 84 119 80 120.5 Q 76 119 74 113 Z" fill="${C.dark}"/>
      <path d="M 80 120 L 80 123.5" stroke="${C.dark}" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M 74 126 Q 80 129 86 126" fill="none" stroke="${C.dark}" stroke-width="1.6" stroke-linecap="round"/>
      <g fill="none" stroke="${C.glass}" stroke-width="2.1" stroke-linecap="round" opacity=".9">
        <circle cx="73" cy="103" r="12.4"/><circle cx="98" cy="103" r="12.4"/><path d="M 85.4 101 Q 88 98 90.6 101"/>
      </g>
    </g>
    <ellipse cx="86" cy="205" rx="11" ry="7" fill="url(#creamG)"/>
    <ellipse cx="114" cy="205" rx="11" ry="7" fill="url(#creamG)"/>
  </g>`
}
