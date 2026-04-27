/**
 * Litemc 示例脚本
 */
//---启动时的必要脚本---
const litemc = require('litemc')

// 创建 Bot 实例
const bot = litemc.createBot({
  username: 'your-email@example.com',  // 用户名：离线模式填任意字符串，正版模式填 Microsoft 邮箱
  auth: 'microsoft',                   // 认证方式：'offline'（离线模式）或 'microsoft'（正版模式）
  host: 'yourserverIP',                   // 服务器地址：填写服务器 IP 或域名
  port: 25565,                         // 服务器端口：默认 25565
  version: '1.21.11',                   // Minecraft 版本：不填则自动协商
  autoConnect: true                    // 是否自动连接：默认 true，设为 false 则手动调用 bot.connect()
})

//---以下为可选脚本---
// 1.登录成功事件
bot.on('login', () => {
  console.log('[Litemc] 已登录')
})

// 接收聊天消息事件
// raw: 原始消息数据（字符串或对象）
// payload: 消息附加信息（包含发送者等）
bot.on('message', (raw, payload) => {
  let sender = ''

  // 从 payload 获取发送者信息
  if (payload?.senderName) {
    try {
      const senderData = JSON.parse(payload.senderName)
      sender = senderData.insertion || senderData.text || ''
    } catch {
      sender = payload.senderName
    }
  }

  // 使用框架提供的 parseChat 解析消息
  const text = litemc.parseChat(raw)

  // 格式化为 <玩家> 消息
  const chatMessage = sender ? `<${sender}> ${text}` : text
  console.log('[Chat]', chatMessage)
})

// 被踢出服务器事件
bot.on('kicked', (reason) => {
  console.log('[Kicked]', reason)
})

// 错误事件
bot.on('error', (err) => {
  console.error('[Error]', err.message)
})

// 连接结束事件
bot.on('end', (reason) => {
  console.log('[End]', reason)
})

// 死亡事件
bot.on('death', () => {
  console.log('[Litemc] Bot 已死亡')
})

// 重生事件
bot.on('respawn', () => {
  console.log('[Litemc] Bot 已重生')
})

// 延迟事件
bot.on('ping', (ms) => {
  console.log('[Ping]', ms, 'ms')
})

// 手动连接（当 autoConnect: false 时使用）
// bot.connect()

// 发送聊天消息
// bot.chat('Hello!')

// 断开连接
// bot.disconnect('手动断开')