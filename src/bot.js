const mc = require('minecraft-protocol')
const { EventEmitter } = require('events')
const { buildAuthOptions } = require('./auth')

/**
 * 尝试从环境变量自动检测代理，并创建 http agent
 * 支持 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY 环境变量
 * @returns {object|null} http agent 或 null
 */
function _detectProxyAgent () {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy ||
    process.env.ALL_PROXY || process.env.all_proxy

  if (!proxyUrl) return null

  try {
    const { HttpsProxyAgent } = require('https-proxy-agent')
    console.log(`[Litemc] 检测到代理环境变量: ${proxyUrl}`)
    return new HttpsProxyAgent(proxyUrl)
  } catch {
    try {
      const { HttpProxyAgent } = require('http-proxy-agent')
      return new HttpProxyAgent(proxyUrl)
    } catch {
      console.warn(`[Litemc] 检测到代理环境变量 ${proxyUrl}，但未安装代理依赖包`)
      console.warn(`[Litemc] 请运行: npm install https-proxy-agent`)
      return null
    }
  }
}

const VERSION = '1.2.2'

// 全局实例计数器，用于多开 Bot 时分配唯一 ID
let _globalBotCounter = 0

class LiteMcBot extends EventEmitter {
  constructor (config) {
    super()

    // 为每个实例分配唯一 ID，用于隔离认证缓存
    const botId = String(++_globalBotCounter)

    this.config = {
      ...config,
      username: config.username,
      auth: config.auth ?? 'offline',
      host: config.host,
      port: config.port ?? 25565,
      version: config.version ?? false,
      hideErrors: config.hideErrors ?? false,
      // 默认视距（以区块计）。用于聊天型 Bot 时会影响需要拉取/模拟的世界数据范围
      // 兼容参数：新参数 `view` / `sim`，旧参数仍保留（viewDistance / simulationDistance）
      viewDistance: config.view ?? config.viewDistance ?? 12,
      simulationDistance: config.sim ?? config.simulationDistance ?? config.view ?? config.viewDistance ?? 12,
      // 聊天型 Bot 默认不加载 registry，减少不必要的世界数据处理
      loadRegistry: config.loadRegistry ?? false,
      // 默认仅上报协议解析错误，不强制断线；如需硬断开可在脚本中显式开启
      disconnectOnProtocolError: config.disconnectOnProtocolError ?? false,
      // keep_alive 超时时间（毫秒），默认 60 秒，避免网络波动导致误断开
      keepAliveTimeout: config.keepAliveTimeout ?? 60000,
      // 断线自动重连：关闭或设置重试次数（0 = 不重连）
      reconnect: config.reconnect ?? 0,
      // 重连间隔（毫秒）
      reconnectInterval: config.reconnectInterval ?? 5000,
      // 内部实例 ID，用于多开 Bot 时隔离 profilesFolder
      _botId: botId
    }

    // 重连相关状态
    this._reconnectAttempt = 0
    this._reconnectTimer = null
    this._intentionalDisconnect = false

    this._client = null
    this._connectionSerial = 0
    this._connected = false
    this._didEmitLogin = false
    this._lastKeepAliveTime = null
    this._entityId = null
    this._pendingPingCheck = null

    this.username = null
    this.ping = null
    this.registry = null
    this.isAlive = false
    this._serverVersion = null

    // 插件系统
    this._plugins = new Map()

    this._setupLitemcCommandHandler()
    this._setupPingCheckHandler()
    this._setupConsoleInput()
  }

  /**
   * 加载插件
   * @param {string} name - 插件名称
   * @param {object} plugin - 插件对象
   */
  loadPlugin (name, plugin) {
    if (this._plugins.has(name)) {
      console.warn(`[Litemc] 插件 '${name}' 已存在，将被覆盖`)
    }

    // 插件初始化，传入 bot 实例
    if (plugin.init && typeof plugin.init === 'function') {
      plugin.init(this)
    }

    this._plugins.set(name, plugin)
    console.log(`[Litemc] 插件 '${name}' 已加载`)
  }

  /**
   * 卸载插件
   * @param {string} name - 插件名称
   */
  unloadPlugin (name) {
    const plugin = this._plugins.get(name)
    if (!plugin) {
      console.warn(`[Litemc] 插件 '${name}' 不存在`)
      return
    }

    if (plugin.unload && typeof plugin.unload === 'function') {
      plugin.unload(this)
    }

    this._plugins.delete(name)
    console.log(`[Litemc] 插件 '${name}' 已卸载`)
  }

  /**
   * 获取已加载的插件
   * @param {string} [name] - 插件名称，不填则返回所有插件
   * @returns {object|Map}
   */
  getPlugin (name) {
    if (name) {
      return this._plugins.get(name)
    }
    return this._plugins
  }

  _setupConsoleInput () {
    // 避免重复初始化
    if (this._consoleReady) return
    this._consoleReady = true

    const readline = require('readline')

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })

    rl.on('line', (line) => {
      const msg = line.trim()

      if (!msg) return

      // 内置 exit 命令
      if (msg.toLowerCase() === 'exit') {
        console.log('[Litemc] 正在退出...')
        this.disconnect('exit command')
        process.exit(0)
        return
      }

      // 发送聊天消息
      if (this._connected && this._client) {
        try {
          this.chat(msg)
        } catch (err) {
          console.error('[Error]', err.message)
        }
      } else {
        console.log('[Litemc] 未连接到服务器')
      }
    })

    rl.on('close', () => {
      this.disconnect('console closed')
      process.exit(0)
    })

    // 首次登录后显示提示
    this.once('login', () => {
      console.log('[Litemc] 控制台就绪，直接输入消息发送，输入 exit 退出')
    })
  }

  _setupLitemcCommandHandler () {
    this.on('message', (text) => {
      if (this._detectLitemcCommand(text)) {
        this._handleLitemcCommand()
      }
    })
  }

  _setupPingCheckHandler () {
    this.on('ping_check', async () => {
      try {
        await this.checkPing()
      } catch (err) {
        this.emit('error', err)
      }
    })
  }

  _detectLitemcCommand (text) {
    if (!text || typeof text !== 'string') return false
    return text.toLowerCase().includes('!litemc')
  }

  async _handleLitemcCommand () {
    if (!this._connected || !this._client) return

    const version = this._serverVersion ?? this._client.version ?? 'Null'
    const username = this.username ?? 'Null'
    let ping = this.ping ?? 'Null'

    try {
      ping = await this.checkPing(5000)
    } catch {}

    const response = `[LiteMC] ${version} Litemc@${username} ONEGAME ping=${ping}ms`
    this.chat(response)
  }

  checkPing (timeoutMs = 10000) {
    if (!this._connected || !this._client) {
      return Promise.reject(new Error('[Litemc] Bot is not connected to the server'))
    }

    // 避免并发测量导致结果混乱：同一时刻只允许一个检测
    if (this._pendingPingCheck?.promise) {
      return this._pendingPingCheck.promise
    }

    const startedAt = Date.now()
    let timer = null

    const promise = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        if (this._pendingPingCheck?.startedAt !== startedAt) return
        this._pendingPingCheck = null
        reject(new Error('[Litemc] Ping check timeout'))
      }, Math.max(1000, Number(timeoutMs) || 10000))

      this._pendingPingCheck = {
        startedAt,
        resolve,
        reject,
        timer,
        promise: null
      }
    })

    this._pendingPingCheck.promise = promise
    return promise
  }

  connect () {
    if (this._client) {
      throw new Error('[Litemc] Bot is already connecting or connected')
    }

    // 重连时需要重置此标记，否则无法正常建立连接
    this._intentionalDisconnect = false

    const authOpts = buildAuthOptions(this.config)
    const clientOpts = {
      ...authOpts,
      host: this.config.host,
      port: this.config.port,
      version: this.config.version || false,
      validateChannelProtocol: false,
      hideErrors: this.config.hideErrors,
      // 将 keepAliveTimeout 传递给 minecraft-protocol，替换默认的 30 秒超时
      keepAlive: this.config.keepAliveTimeout,
      // 支持代理：优先使用用户传入的 agent，其次自动检测环境变量代理
      ...(this.config.agent ? { agent: this.config.agent } : (() => {
        const autoAgent = _detectProxyAgent()
        return autoAgent ? { agent: autoAgent } : {}
      })()),
      // 支持自定义 session server（中国大陆用户可用镜像服务器替换 sessionserver.mojang.com）
      ...(this.config.sessionServer ? { sessionServer: this.config.sessionServer } : {})
    }

    // 多开 Bot 时交错延迟：每个实例间隔 3 秒，避免正版认证并发读写 token 文件冲突
    // 同一账号多开时 Microsoft OAuth 有速率限制，需要充分间隔
    const botId = this.config._botId ?? '0'
    const staggerDelay = this.config.auth !== 'offline' ? (Number(botId) - 1) * 3000 : 0

    const connectionSerial = ++this._connectionSerial
    const startClient = () => {
      const client = mc.createClient(clientOpts)
      this._client = client
      this._setupHandlers(client, connectionSerial)

      if (!client.wait_connect) {
        this._onConnectAllowed(client, connectionSerial)
      }
    }

    if (staggerDelay > 0) {
      console.log(`[Litemc] 多 Bot 交错连接，等待 ${(staggerDelay / 1000).toFixed(0)} 秒... (Bot #${botId})`)
      setTimeout(startClient, staggerDelay)
    } else {
      startClient()
    }
  }

  disconnect (reason) {
    // 主动断开，标记不重连
    this._intentionalDisconnect = true
    clearTimeout(this._reconnectTimer)

    const client = this._client
    if (!client) return

    this._client = null
    this._resetConnectionState()
    client.end(reason ?? 'disconnect')
    this.emit('end', reason ?? 'disconnect')
  }

  chat (message) {
    if (!this._connected || !this._client) {
      throw new Error('[Litemc] Bot is not connected to the server')
    }

    if (!message || typeof message !== 'string') {
      throw new Error('[Litemc] Message must be a non-empty string')
    }

    if (typeof this._client.chat === 'function') {
      this._client.chat(message)
      return
    }

    this._client.write('chat', { message })
  }

  _onConnectAllowed (client = this._client, connectionSerial = this._connectionSerial) {
    if (!this._isCurrentClient(client, connectionSerial)) return

    try {
      const serverVersion = client.version
      this._serverVersion = serverVersion
      console.log('[Litemc] Server version:', serverVersion)

      if (this.config.loadRegistry) {
        const Registry = require('prismarine-registry')
        this.registry = Registry(serverVersion)

        if (!this.registry?.version) {
          console.warn(`[Litemc] Warning: incomplete registry data for version '${serverVersion}'`)
        } else {
          console.log('[Litemc] Registry loaded, MC version:', this.registry.version.minecraftVersion)
        }
      } else {
        this.registry = null
      }
    } catch (err) {
      console.error('[Litemc] Version setup failed:', err.message)
    }
  }

  _setupHandlers (client, connectionSerial) {
    let configurationComplete = false
    const isCurrentClient = () => this._isCurrentClient(client, connectionSerial)

    client.on('connect', () => {
      if (!isCurrentClient()) return
      this.emit('connect')
    })

    if (client.wait_connect) {
      client.once('connect_allowed', () => {
        this._onConnectAllowed(client, connectionSerial)
      })
    }

    client.on('success', (packet) => {
      if (!isCurrentClient()) return
      this.username = packet.username ?? client.username ?? this.config.username
    })

    client.on('state', (newState) => {
      if (!isCurrentClient()) return

      console.log('[Litemc] Protocol state:', newState)

      if (newState === 'play' && !configurationComplete) {
        configurationComplete = true
        console.log('[Litemc] Entered play state')
      }
    })

    client.on('login', (packet) => {
      if (!isCurrentClient()) return
      if (this._didEmitLogin) return

      this._connected = true
      this._didEmitLogin = true
      this.username = client.username ?? this.username ?? this.config.username
      this._entityId = packet.entityId
      this.isAlive = true

      // 登录成功，重置重连计数
      this._reconnectAttempt = 0

      this._sendClientSettings(client)
      this.emit('login', { username: this.username, entityId: packet.entityId })
    })

    client.on('systemChat', (data) => {
      if (!isCurrentClient()) return
      this._handleChatPacket(data.formattedMessage, data)
    })

    client.on('playerChat', (data) => {
      if (!isCurrentClient()) return
      const raw = data.unsignedContent ?? data.formattedMessage ?? data.plainMessage
      if (raw != null) this._handleChatPacket(raw, data)
    })

    client.on('disguised_chat', (packet) => {
      if (!isCurrentClient()) return
      this._handleChatPacket(packet.message, packet)
    })

    client.on('update_health', (packet) => {
      if (!isCurrentClient()) return

      if (packet.health > 0) {
        this.isAlive = true
        return
      }

      if (this.isAlive) {
        this.isAlive = false
        console.log('[Litemc] Bot died, respawning...')
        this.emit('death')
        this._respawnClient(client)
      }
    })

    client.on('respawn', () => {
      if (!isCurrentClient()) return
      this.isAlive = true
      console.log('[Litemc] Bot respawned')
      this.emit('respawn')
    })

    client.on('resource_pack_send', (packet) => {
      if (!isCurrentClient()) return
      this._acceptResourcePack(client, packet)
    })

    client.on('add_resource_pack', (packet) => {
      if (!isCurrentClient()) return
      this._acceptResourcePack(client, packet)
    })

    client.on('registry_data', (packet) => {
      if (!isCurrentClient()) return
      if (!this.config.loadRegistry) return

      try {
        if (this.registry?.loadDimensionCodec) {
          this.registry.loadDimensionCodec(packet.codec ?? packet)
        }
      } catch (err) {
        console.warn('[Litemc] Failed to load registry codec:', err.message)
      }
    })

    client.on('finish_configuration', () => {
      if (!isCurrentClient()) return
      console.log('[Litemc] Configuration finished')
    })

    client.on('ping', (packet) => {
      if (!isCurrentClient()) return

      try {
        client.write('pong', { id: packet.id })
      } catch {}
    })

    client.on('keep_alive', () => {
      if (!isCurrentClient()) return

      if (!this._pendingPingCheck) return

      const now = Date.now()
      const ping = now - this._pendingPingCheck.startedAt
      this.ping = ping

      clearTimeout(this._pendingPingCheck.timer)
      this._pendingPingCheck.resolve(ping)
      this._pendingPingCheck = null
      this.emit('ping', ping)
    })

    client.on('error', (err) => {
      if (!isCurrentClient()) return

      const errMsg = String(err?.message ?? err)

      // 检测 profile 获取失败（通常是账号未购买 MC 或多开 token 冲突）
      if (errMsg.includes('Failed to obtain profile data')) {
        console.error(`[Litemc] Bot #${this.config._botId}: 认证失败 - 无法获取 profile 数据`)
        console.error(`[Litemc] 可能原因：1) 该账号未购买 Minecraft Java 版  2) 同一账号多开导致 token 冲突`)
        console.error(`[Litemc] 多开提示：同一 Microsoft 账号无法同时在多个 Bot 上登录，建议使用不同账号`)
      }

      if (this._shouldHardDisconnectOnError(err)) {
        this.emit('error', err)
        this._hardDisconnectOnProtocolError(client, err)
        return
      }

      this.emit('error', err)
    })

    client.on('end', (reason) => {
      if (!isCurrentClient()) return
      this._client = null
      this._resetConnectionState()
      this.emit('end', reason)
      this._attemptReconnect('end')
    })

    client.on('disconnect', (packet) => {
      if (!isCurrentClient()) return
      this._client = null
      this._resetConnectionState()
      this.emit('kicked', packet.reason ?? 'disconnect')
      this._attemptReconnect('disconnect')
    })

    client.on('kick_disconnect', (packet) => {
      if (!isCurrentClient()) return
      this._client = null
      this._resetConnectionState()
      this.emit('kicked', packet.reason ?? 'kicked')
      this._attemptReconnect('kick')
    })
  }

  _isCurrentClient (client, connectionSerial) {
    return this._client === client && this._connectionSerial === connectionSerial
  }

  _shouldHardDisconnectOnError (err) {
    if (!this.config.disconnectOnProtocolError || !err) return false

    const msg = String(err.message ?? err)
    return (
      msg.includes('Parse error') ||
      msg.includes('partial packet') ||
      msg.includes('Chunk size is')
    )
  }

  _hardDisconnectOnProtocolError (client, err) {
    if (this._client !== client) return

    const reason = 'protocol_parse_error'
    const shortMsg = String(err?.message ?? err).slice(0, 240)
    console.error(`[Litemc] Fatal protocol parse error, force disconnecting: ${shortMsg}`)

    this._client = null
    this._resetConnectionState()

    // 先正常结束，再强制 destroy，尽快释放流与缓冲
    try { client.end(reason) } catch {}
    try { client.socket?.destroy() } catch {}

    this.emit('kicked', reason)
    this.emit('end', reason)
  }

  _resetConnectionState () {
    this._connected = false
    this._didEmitLogin = false
    this.isAlive = false
    this._lastKeepAliveTime = null
    this._entityId = null
    this._serverVersion = null

    if (this._pendingPingCheck) {
      clearTimeout(this._pendingPingCheck.timer)
      this._pendingPingCheck.reject(new Error('[Litemc] Ping check canceled: disconnected'))
      this._pendingPingCheck = null
    }
  }

  /**
   * 尝试自动重连
   * @param {string} reason - 断开原因
   */
  _attemptReconnect (reason) {
    // 主动断开不重连
    if (this._intentionalDisconnect) return

    const maxReconnect = this.config.reconnect
    if (!maxReconnect || maxReconnect <= 0) return

    this._reconnectAttempt++
    if (this._reconnectAttempt > maxReconnect) {
      console.log(`[Litemc] 已达到最大重连次数 (${maxReconnect})，停止重连`)
      this._reconnectAttempt = 0
      return
    }

    const interval = this.config.reconnectInterval
    console.log(`[Litemc] 将在 ${interval / 1000} 秒后重连 (第 ${this._reconnectAttempt}/${maxReconnect} 次)，原因: ${reason}`)

    this._reconnectTimer = setTimeout(() => {
      if (this._intentionalDisconnect) return
      if (this._client) return

      console.log(`[Litemc] 正在重连... (第 ${this._reconnectAttempt}/${maxReconnect} 次)`)
      try {
        this.connect()
      } catch (err) {
        console.error('[Litemc] 重连失败:', err.message)
        this.emit('error', err)
        // 继续尝试下一次
        this._attemptReconnect('reconnect_failed')
      }
    }, interval)
  }

  _handleChatPacket (raw, payload = raw) {
    // 直接发送原始数据，不做解析，让开发者自行处理
    this.emit('message', raw, payload)
  }

  /**
   * 解析聊天 JSON 为纯文本
   * @param {string|object} raw - 原始聊天数据
   * @returns {string} 解析后的纯文本
   */
  static parseChat (raw) {
    if (!raw) return ''

    let obj = raw
    if (typeof raw === 'string') {
      try {
        obj = JSON.parse(raw)
      } catch {
        return raw
      }
    }

    if (typeof obj !== 'object') return String(raw)

    let text = obj.text ?? obj.translate ?? ''

    if (Array.isArray(obj.extra)) {
      text += obj.extra.map(entry => this.parseChat(entry)).join('')
    }

    if (Array.isArray(obj.with)) {
      const args = obj.with.map(entry => this.parseChat(entry))
      text = text.replace(/%s/g, () => args.shift() ?? '')
      text = text.replace(/%\d+\$s/g, (match) => {
        const index = Number(match.match(/\d+/)[0]) - 1
        return args[index] ?? ''
      })
    }

    return text
  }

  _acceptResourcePack (client, packet) {
    console.log('[Litemc] Resource pack request detected, accepting...')

    try {
      const acceptPacket = { result: 3 }
      const loadedPacket = { result: 0 }

      if (packet.uuid) {
        acceptPacket.uuid = packet.uuid
        loadedPacket.uuid = packet.uuid
      }

      if (packet.hash) {
        acceptPacket.hash = packet.hash
        loadedPacket.hash = packet.hash
      }

      client.write('resource_pack_receive', acceptPacket)

      setTimeout(() => {
        if (this._client !== client) return

        try {
          client.write('resource_pack_receive', loadedPacket)
        } catch {}
      }, 500)
    } catch {}
  }

  _respawnClient (client = this._client) {
    try {
      client.write('client_command', { payload: 0 })
      return
    } catch {}

    try {
      client.write('client_command', { actionId: 0 })
      return
    } catch {}

    try {
      client.write('respawn', {})
    } catch {}
  }

  _sendClientSettings (client = this._client) {
    try {
      // Minecraft 客户端的视距/模拟距离通常在 1-32 范围内；超过范围可能导致协议/性能异常。
      // 这里对最终写入 settings 的值做兜底裁剪。
      let viewDistance = Number(this.config.viewDistance)
      if (!Number.isFinite(viewDistance)) viewDistance = 12
      viewDistance = Math.min(32, Math.max(1, Math.floor(viewDistance)))

      let simulationDistance = Number(this.config.simulationDistance)
      if (!Number.isFinite(simulationDistance)) simulationDistance = viewDistance
      simulationDistance = Math.min(32, Math.max(1, Math.floor(simulationDistance)))

      client.write('settings', {
        locale: 'en_US',
        viewDistance,
        simulationDistance,
        chatFlags: 0,
        chatColors: true,
        skinParts: 0x7f,
        mainHand: 1,
        enableTextFiltering: false,
        enableServerListing: true
      })
    } catch {}
  }
}

module.exports = { LiteMcBot, VERSION, parseChat: LiteMcBot.parseChat }
