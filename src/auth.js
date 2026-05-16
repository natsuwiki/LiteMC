/**
 * Litemc 认证模块
 * 支持正版（Microsoft）和离线模式
 */

// 清除代理设置
process.env.NO_PROXY = '*'
process.env.no_proxy = '*'

/**
 * 构建 minecraft-protocol 所需的认证选项
 * @param {object} config - bot 配置
 * @returns {object} - mc.createClient 所需的选项
 */
function buildAuthOptions (config) {
  if (config.auth === 'offline') {
    return {
      username: config.username,
      auth: 'offline'
    }
  }

  // 正版模式 - 让 minecraft-protocol 内部处理完整认证流程
  // 按用户名 + 实例 ID 隔离 auth folder，支持同账号多开
  // 每个实例有独立的 MSAL token 缓存，避免并发读写冲突和 token 互相失效
  const path = require('path')
  const safeName = (config.username || 'default').replace(/[^a-zA-Z0-9@._-]/g, '_')
  const botId = config._botId ?? '0'
  const defaultFolder = path.join('./auth', safeName, `bot_${botId}`)

  const authOptions = {
    username: config.username,
    auth: 'microsoft',
    flow: config.flow ?? 'msal',  // 使用 msal 流程，速度快
    forceRefresh: config.forceRefresh ?? false,
    profilesFolder: config.profilesFolder ?? defaultFolder,
    msalConfig: {
      auth: {
        clientId: '00000000402b5328',
        authority: 'https://login.microsoftonline.com/consumers'
      }
    }
  }

  if (config.password) authOptions.password = config.password
  if (config.profilesFolder !== undefined) authOptions.profilesFolder = config.profilesFolder
  if (config.authTitle !== undefined) authOptions.authTitle = config.authTitle
  if (config.deviceType !== undefined) authOptions.deviceType = config.deviceType
  if (config.flow !== undefined) authOptions.flow = config.flow
  if (config.disableChatSigning !== undefined) authOptions.disableChatSigning = config.disableChatSigning

  // 设置默认的 onMsaCode 回调（用于后续登录时token刷新）
  if (!config.onMsaCode) {
    authOptions.onMsaCode = (data) => {
      console.log('\n=== Microsoft 登录 ===')
      console.log('请在浏览器中打开以下链接（代码已自动填充）：')
      console.log(`${data.verification_uri}?otc=${data.user_code}`)
      console.log('\n或者手动访问：', data.verification_uri)
      console.log('并输入代码：', data.user_code)
      console.log('\n等待授权中...\n')
    }
  } else {
    authOptions.onMsaCode = config.onMsaCode
  }

  return authOptions
}

module.exports = { buildAuthOptions }
