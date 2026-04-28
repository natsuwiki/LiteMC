const mc = require('minecraft-protocol')
const { EventEmitter } = require('events')
const { buildAuthOptions } = require('./auth')

const VERSION = '1.3.0'

class LiteMcBot extends EventEmitter {
  constructor (config) {
    super()

    this.config = {
      ...config,
      username: config.username,
      auth: config.auth ?? 'offline',
      host: config.host,
      port: config.port ?? 25565,
      version: config.version ?? false,
      hideErrors: config.hideErrors ?? false,
      // 聊天型 Bot 默认只请求最小视距，降低世界数据压力
      viewDistance: config.viewDistance ?? 1,
      simulationDistance: config.simulationDistance ?? 1,
      // 聊天型 Bot 默认不加载 registry，减少不必要的世界数据处理
      loadRegistry: config.loadRegistry ?? false,
      // 默认仅上报协议解析错误，不强制断线；如需硬断开可在脚本中显式开启
      disconnectOnProtocolError: config.disconnectOnProtocolError ?? false
    }

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

    const authOpts = buildAuthOptions(this.config)
    const clientOpts = {
      ...authOpts,
      host: this.config.host,
      port: this.config.port,
      version: this.config.version || false,
      validateChannelProtocol: false,
      hideErrors: this.config.hideErrors
    }

    const client = mc.createClient(clientOpts)
    const connectionSerial = ++this._connectionSerial

    this._client = client
    this._setupHandlers(client, connectionSerial)

    if (!client.wait_connect) {
      this._onConnectAllowed(client, connectionSerial)
    }
  }

  disconnect (reason) {
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
    })

    client.on('disconnect', (packet) => {
      if (!isCurrentClient()) return
      this._client = null
      this._resetConnectionState()
      this.emit('kicked', packet.reason ?? 'disconnect')
    })

    client.on('kick_disconnect', (packet) => {
      if (!isCurrentClient()) return
      this._client = null
      this._resetConnectionState()
      this.emit('kicked', packet.reason ?? 'kicked')
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
      const viewDistance = Math.max(1, Number(this.config.viewDistance) || 1)
      const simulationDistance = Math.max(1, Number(this.config.simulationDistance) || viewDistance)

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
