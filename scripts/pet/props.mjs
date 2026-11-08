import { C } from './shape.mjs'

export function bookMarkup(page = 0) {
  const flap = page > 0
    ? `<path d="M 100 173 C ${100 + page * 0.42} ${168 - page * 0.12} ${126 + page * 0.18} ${168 + page * 0.05} 134 174 L 134 192 C 124 188 108 188 100 193 Z" fill="#fbf5e7" stroke="#d9cbb3" stroke-width="1"/>`
    : ''
  return `<g>
    <path d="M 72 173 C 84 168 95 169 100 174 L 100 196 C 92 190 81 190 70 194 Z" fill="#4f6653"/>
    <path d="M 128 173 C 116 168 105 169 100 174 L 100 196 C 108 190 119 190 130 194 Z" fill="#4f6653"/>
    <path d="M 75 172 C 86 167 96 169 100 174 L 100 193 C 93 188 83 188 73 191 Z" fill="#fbf5e7" stroke="#d9cbb3" stroke-width="1"/>
    <path d="M 125 172 C 114 167 104 169 100 174 L 100 193 C 107 188 117 188 127 191 Z" fill="#fbf5e7" stroke="#d9cbb3" stroke-width="1"/>
    ${flap}
    <g stroke="#cbbfa9" stroke-width="1.1" stroke-linecap="round" opacity=".8">
      <path d="M 80 176 L 95 180 M 80 180 L 95 184 M 80 184 L 92 188"/>
      <path d="M 120 176 L 105 180 M 120 180 L 105 184 M 120 184 L 108 188"/>
    </g>
    <path d="M 100 174 L 100 193" stroke="#b9a98f" stroke-width="1.4"/>
  </g>`
}

export function typewriterMarkup(frame = 0) {
  const lift = frame % 2 === 1 ? -1 : 0
  const key = (x, y, on) =>
    `<circle cx="${x}" cy="${y + (on ? -1.3 : 0)}" r="2.3" fill="${on ? '#e8d9bd' : '#cbb896'}" stroke="#4e5a52" stroke-width="0.7"/>`
  return `<g transform="translate(0 ${lift})">
    <path d="M 84 166 L 116 166 L 114 184 L 86 184 Z" fill="#fbf5e7" stroke="#d9cbb3" stroke-width="1"/>
    <g stroke="#cbbfa9" stroke-width="1" opacity=".85"><path d="M 88 171 L 112 171 M 88 175 L 112 175 M 88 179 L 104 179"/></g>
    <rect x="74" y="183" width="52" height="20" rx="5" fill="#5b6a61"/>
    <rect x="78" y="185" width="44" height="8" rx="2.5" fill="#6f7f74"/>
    <path d="M 82 185 L 118 185" stroke="#9fb0a1" stroke-width="1.4"/>
    ${key(85, 195, frame % 4 === 0)}${key(93, 195, frame % 4 === 1)}${key(101, 195, frame % 4 === 2)}${key(109, 195, frame % 4 === 3)}${key(117, 195, false)}
    <rect x="82" y="199" width="36" height="3.4" rx="1.7" fill="#4e5a52"/>
    <path d="M 76 203 L 124 203 L 126 207 L 74 207 Z" fill="#4e5a52"/>
  </g>`
}

export function fishMarkup(frame = 0) {
  const wiggle = [-8, 4, 10, 2][frame % 4]
  return `<g transform="translate(100 184)">
    <ellipse cx="0" cy="0" rx="12.5" ry="6.4" fill="#9cc2d3" stroke="#6f97a9" stroke-width="1.2"/>
    <path d="M 11 0 L 20 ${wiggle - 4} L 18 ${wiggle + 4} Z" fill="#7fa9bc" stroke="#6f97a9" stroke-width="1"/>
    <path d="M -2 -5 Q 2 0 -2 5" fill="none" stroke="#6f97a9" stroke-width="1" opacity=".8"/>
    <circle cx="-7" cy="-1.6" r="1.5" fill="#2f3b44"/>
    <circle cx="-7.5" cy="-2.2" r="0.5" fill="#fff"/>
    <path d="M -6 3 Q -2 6 2 3" fill="none" stroke="#5f879a" stroke-width="0.9" opacity=".8"/>
    <circle cx="4" cy="-2" r="1.2" fill="#cfe6ee" opacity=".6"/>
  </g>`
}

export function crankMarkup(frame = 0) {
  const a = (frame * 28) % 360
  const gear = Array.from({ length: 8 }, (_, i) => {
    const ang = (a + i * 45) * (Math.PI / 180)
    return `<rect x="${119 + Math.cos(ang) * 8.5 - 1.5}" y="${183 + Math.sin(ang) * 8.5 - 1.5}" width="3" height="3" rx="0.8" fill="#b59a6c" transform="rotate(${(a + i * 45).toFixed(1)} ${119 + Math.cos(ang) * 8.5} ${183 + Math.sin(ang) * 8.5})"/>`
  }).join('')
  return `<g>
    <rect x="72" y="190" width="50" height="14" rx="4" fill="#6b5a44"/>
    <rect x="76" y="192" width="42" height="5" rx="2" fill="#847055"/>
    <circle cx="119" cy="183" r="9" fill="#c9ad7a" stroke="#7c6547" stroke-width="1.4"/>
    ${gear}
    <path d="M 119 183 L ${119 + Math.cos((a * Math.PI) / 180) * 11} ${183 + Math.sin((a * Math.PI) / 180) * 11}" stroke="#7c6547" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="119" cy="183" r="2.2" fill="#5c4a33"/>
    <g transform="translate(80 174)">
      <rect x="0" y="0" width="14" height="10" rx="1.5" fill="#fbf5e7" stroke="#d9cbb3"/>
      <path d="M 3 3 L 11 3 M 3 6 L 9 6" stroke="#cbbfa9" stroke-width="1"/>
    </g>
  </g>`
}

export function papersMarkup(frame = 0) {
  return `<g>
    <g transform="translate(56 ${160 - (frame % 3) * 3}) rotate(-12)">
      <rect x="0" y="0" width="13" height="16" rx="1.2" fill="#fbf5e7" stroke="#d9cbb3" stroke-width="0.9"/>
      <path d="M 3 4 L 10 4 M 3 7 L 9 7 M 3 10 L 10 10" stroke="#cbbfa9" stroke-width="0.8"/>
    </g>
    <g transform="translate(132 ${150 - ((frame + 1) % 3) * 4}) rotate(14)">
      <rect x="0" y="0" width="12" height="15" rx="1.2" fill="#fbf5e7" stroke="#d9cbb3" stroke-width="0.9"/>
      <path d="M 3 4 L 9 4 M 3 7 L 8 7 M 3 10 L 9 10" stroke="#cbbfa9" stroke-width="0.8"/>
    </g>
  </g>`
}
