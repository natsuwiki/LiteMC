/**
 * Litemc 启动横幅
 * 炫彩大字 "LiteMC"，蓝色向淡灰色过渡
 */

// ANSI 颜色代码
const RESET = '\x1b[0m'

// 蓝色 → 淡灰色渐变色阶（每列一个颜色）
const GRADIENT = [
  '\x1b[38;2;30;144;255m',   // 道奇蓝
  '\x1b[38;2;60;160;255m',
  '\x1b[38;2;90;175;255m',
  '\x1b[38;2;120;190;255m',
  '\x1b[38;2;150;200;255m',
  '\x1b[38;2;175;210;255m',
  '\x1b[38;2;195;215;255m',
  '\x1b[38;2;210;220;240m',
  '\x1b[38;2;220;225;235m',
  '\x1b[38;2;200;205;215m',  // 淡灰蓝
]

// 用 5x7 点阵表示 "LITEMC"（全大写）
const CHARS = {
  L: [
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,1,1,1,1],
  ],
  I: [
    [0,1,1,1,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,1,1,1,0],
  ],
  T: [
    [1,1,1,1,1],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
    [0,0,1,0,0],
  ],
  E: [
    [0,1,1,1,1],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,1,1,1,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [0,1,1,1,1],
  ],
  M: [
    [1,0,0,0,1],
    [1,1,0,1,1],
    [1,0,1,0,1],
    [1,0,1,0,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
  ],
  C: [
    [0,1,1,1,0],
    [1,0,0,0,1],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,1],
    [0,1,1,1,0],
  ],
}

const SPACE = ' '

function printBanner () {
  const letters = ['L','I','T','E','M','C']

  const rows = 7
  // 用上下半块合并两行为一行，7行 → 4行输出
  const pixelRows = rows
  const outputRows = Math.ceil(pixelRows / 2)
  const lines = Array.from({ length: outputRows }, () => '')

  for (let li = 0; li < letters.length; li++) {
    const char = CHARS[letters[li]]
    const colOffset = li * 5

    for (let outRow = 0; outRow < outputRows; outRow++) {
      const topRow = outRow * 2
      const botRow = outRow * 2 + 1

      for (let col = 0; col < 5; col++) {
        const totalCols = letters.length * 5 + (letters.length - 1)
        const gradientPos = (topRow * 5 + colOffset + col) / totalCols
        const colorIdx = Math.min(Math.floor(gradientPos * GRADIENT.length), GRADIENT.length - 1)
        const color = GRADIENT[colorIdx]

        const top = char[topRow]?.[col] ?? 0
        const bot = char[botRow]?.[col] ?? 0

        if (top && bot) {
          lines[outRow] += `${color}█${RESET}`
        } else if (top && !bot) {
          lines[outRow] += `${color}▀${RESET}`
        } else if (!top && bot) {
          lines[outRow] += `${color}▄${RESET}`
        } else {
          lines[outRow] += SPACE
        }
      }
      // 字母间距调整
      if (li === 3) {
        // LITE和MC之间增加额外空格
        lines[outRow] += '   '
      } else if (li === 0 || li === 1) {
        // L-I和I-T之间不加空格（字母本身有空白）
      } else if (li < letters.length - 1) {
        // T-E和M-C之间加1格
        lines[outRow] += ' '
      }
    }
  }

  console.log('')
  for (const line of lines) {
    console.log('  ' + line)
  }
  console.log('')
}

module.exports = { printBanner }