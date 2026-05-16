/**
 * Litemc 认证模块
 * 支持正版（Microsoft）和离线模式
 */

const fs = require('fs')
const path = require('path')

/**
 * 构建 minecraft-protocol 所需的认证选项
 * 支持通过 config.agent 传入自定义 http agent（如代理），用于中国大陆等需要代理的网络环境
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
  const safeName = (config.username || 'default').replace(/[^a-zA-Z0-9@._-]/g, '_')
  const botId = config._botId ?? '0'
  const defaultFolder = path.join('./auth', safeName, `bot_${botId}`)

  // 自动迁移：如果新路径无缓存，但旧路径（./auth/）有缓存，自动复制
  _migrateOldAuthCache(defaultFolder, './auth')

  const authOptions = {
    username: config.username,
    auth: 'microsoft',
    flow: config.flow ?? 'msal',
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

/**
 * 自动迁移旧版 auth 缓存到新版路径
 * @param {string} newFolder - 新的 auth 文件夹路径
 * @param {string} oldRoot - 旧的 auth 根目录
 */
function _migrateOldAuthCache (newFolder, oldRoot) {
  try {
    if (fs.existsSync(newFolder) && fs.readdirSync(newFolder).length > 0) {
      return
    }

    const oldTokenFile = path.join(oldRoot, 'msa-token-cache.json')
    if (!fs.existsSync(oldTokenFile)) {
      return
    }

    fs.mkdirSync(newFolder, { recursive: true })

    const files = fs.readdirSync(oldRoot)
    let migrated = 0
    for (const file of files) {
      const srcPath = path.join(oldRoot, file)
      if (fs.statSync(srcPath).isFile()) {
        fs.copyFileSync(srcPath, path.join(newFolder, file))
        migrated++
      }
    }

    if (migrated > 0) {
      console.log(`[Litemc] 已自动迁移 ${migrated} 个缓存文件到 ${newFolder}`)
      console.log(`[Litemc] 旧缓存保留在 ${oldRoot}，可手动删除`)
    }
  } catch (err) {
    console.warn(`[Litemc] 缓存迁移警告: ${err.message}`)
  }
}

module.exports = { buildAuthOptions }