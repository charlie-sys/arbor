import fs from 'fs'
import path from 'path'

const root = process.cwd()
const source = path.join(root, 'node_modules', 'pdfjs-dist')
const target = path.join(root, 'src', 'renderer', 'public', 'pdfjs')

fs.mkdirSync(target, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  fs.cpSync(path.join(source, dir), path.join(target, dir), { recursive: true, force: true })
}

const workerSource = path.join(source, 'build', 'pdf.worker.min.mjs')
const workerTarget = path.join(target, 'pdf.worker.polyfilled.mjs')
const worker = fs.readFileSync(workerSource, 'utf8')
const marker = '/* zotagent-pdfjs-polyfills */'
const polyfill = `${marker}
(function () {
  var map = Map.prototype;
  if (typeof map.getOrInsert !== 'function') {
    Object.defineProperty(map, 'getOrInsert', {
      configurable: true,
      writable: true,
      value: function (key, value) {
        if (!this.has(key)) this.set(key, value);
        return this.get(key);
      }
    });
  }
  if (typeof map.getOrInsertComputed !== 'function') {
    Object.defineProperty(map, 'getOrInsertComputed', {
      configurable: true,
      writable: true,
      value: function (key, compute) {
        if (!this.has(key)) this.set(key, compute(key));
        return this.get(key);
      }
    });
  }
  if (typeof Math.sumPrecise !== 'function') {
    Object.defineProperty(Math, 'sumPrecise', {
      configurable: true,
      writable: true,
      value: function (values) {
        var sum = 0;
        var compensation = 0;
        for (var value of values) {
          var number = Number(value);
          var next = sum + number;
          if (Math.abs(sum) >= Math.abs(number)) {
            compensation += sum - next + number;
          } else {
            compensation += number - next + sum;
          }
          sum = next;
        }
        return sum + compensation;
      }
    });
  }
})();
`
if (!worker.startsWith(marker)) {
  fs.writeFileSync(workerTarget, polyfill + worker, 'utf8')
}
console.log('PDF.js assets ready:', target)
