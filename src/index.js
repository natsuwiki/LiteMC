/**
 * Litemc 框架入口
 * 轻量级 Minecraft Bot 框架
 *
 * GitHub : https://github.com/natsuwiki/Litemc-bot.git
 * QQ群   : 778073951
 * 作者   : ONEGAME
 */

const { LiteMcBot, VERSION, parseChat } = require('./bot')
const { printBanner } = require('./banner')

let _bannerPrinted = false

/**
 * 创建一个 Litemc Bot 实例
 *
 * @param {object} config
 * @param {string} config.username        - 用户名（离线模式）或 Microsoft 邮箱（正版模式）
 * @param {string} [config.auth='offline'] - 登录方式：'offline' | 'microsoft'
 * @param {string} config.host            - 服务器 IP 或域名
 * @param {number} [config.port=25565]    - 服务器端口
 * @param {string} [config.version]       - MC 版本，如 '1.20.1'（不填则自动协商）
 * @param {boolean} [config.autoConnect=true] - 是否立即连接
 *
 * @returns {LiteMcBot}
 *
 * @example
 * const litemc = require('litemc')
 * const bot = litemc.createBot({
 *   username: 'Steve',
 *   auth: 'offline',
 *   host: 'mc.example.com',
 *   port: 25565,
 *   version: '1.20.1'
 * })
 * bot.on('login', () => bot.chat('Hello!'))
 * bot.on('message', (text) => console.log('[Chat]', text))
 */
function createBot (config = {}) {
  // 只打印一次横幅
  if (!_bannerPrinted) {
    _bannerPrinted = true
    printBanner()
    _printInfo(config)
  }

  const bot = new LiteMcBot(config)

  const autoConnect = config.autoConnect !== false
  if (autoConnect) {
    try {
      bot.connect()
    } catch (err) {
      bot.emit('error', err)
    }
  }

  return bot
}

/**
 * 打印启动信息
 */
function _printInfo (config) {
  const CYAN  = '\x1b[36m'
  const WHITE = '\x1b[97m'
  const RESET = '\x1b[0m'

  const authLabel = config.auth ?? 'offline'
  const displayId = config.username ?? '未设置'

  console.log(`${CYAN}游戏版本：${WHITE}${config.version ?? '自动协商'}${RESET}`)
  console.log(`${CYAN}登录方式：${WHITE}${authLabel}${RESET}`)
  console.log(`${CYAN}ID：${WHITE}${displayId}${RESET}`)
  console.log(`\x1b[2mLitemc v${VERSION} | github:https://github.com/natsuwiki/LiteMC.git\x1b[0m`)
  console.log('')
}

module.exports = {
  createBot,
  VERSION,
  parseChat
}
