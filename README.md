# Litemc 框架

> 轻量级 Minecraft Bot 框架，专注于聊天与连接，无三维功能负担。

- **GitHub**：https://github.com/natsuwiki/LiteMC.git
- **QQ 交流群**：778073951
- **作者**：ONEGAME
- **版本**：1.3

---

## 安装

### 1. 初始化项目

```bash
npm init -y
```

### 2. 安装 Litemc

```bash
npm install litemc
```

---

## 快速开始

创建 `index.js` 文件：

```js
const litemc = require('litemc')

const bot = litemc.createBot({
  username: 'Steve',
  auth: 'offline',
  host: 'mc.example.com',
  port: 25565,
  version: '1.20.1'
})

bot.on('login', () => {
  console.log('[Litemc] 已登录')
})

bot.on('message', (raw, payload) => {
  const text = litemc.parseChat(raw)
  console.log('[Chat]', text)
})
```

运行：

```bash
node index.js
```

---

## API

### `litemc.createBot(config)`

创建并返回一个 Bot 实例，默认自动连接。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `username` | string | — | 用户名（离线）或 Microsoft 邮箱（正版） |
| `auth` | string | `'offline'` | `'offline'` 或 `'microsoft'` |
| `host` | string | — | 服务器 IP 或域名 |
| `port` | number | `25565` | 服务器端口 |
| `version` | string | 自动协商 | MC 版本，如 `'1.20.1'` |
| `autoConnect` | boolean | `true` | 是否立即连接 |
| `profilesFolder` | string | `'./auth'` | 认证缓存文件夹路径 |
| `onMsaCode` | function | — | Microsoft 登录回调（可选） |
| `view` | number | `12` | 客户端请求视距（范围 1-32） |
| `sim` | number | `12` | 客户端请求模拟距离（范围 1-32） |
| `loadRegistry` | boolean | `false` | 是否加载 registry 维度编解码数据 |
| `disconnectOnProtocolError` | boolean | `false` | 协议解析错误时是否强制断开 |
| `hideErrors` | boolean | `false` | 是否隐藏底层协议错误输出 |
| `keepAliveTimeout` | number | `60000` | keep_alive 超时时间（毫秒），默认 60 秒，避免网络波动导致误断开 |
| `reconnect` | number | `0` | 断线自动重连次数，`0` 表示不重连 |
| `reconnectInterval` | number | `5000` | 重连间隔（毫秒） |

---

### Bot 方法

#### `bot.connect()`
手动连接服务器（当 `autoConnect: false` 时使用）。

#### `bot.disconnect([reason])`
断开连接。

#### `bot.chat(message)`
发送聊天消息。

#### `bot.checkPing([timeoutMs])`
按需检测一次延迟并返回 Promise，超时会抛错。  
示例：`const ms = await bot.checkPing(5000)`

---

### Bot 事件

| 事件 | 参数 | 说明 |
|------|------|------|
| `connect` | — | TCP 连接建立 |
| `login` | `{ username, entityId }` | 登录完成，可以发消息 |
| `message` | `(raw, payload)` | 收到聊天消息，raw 为原始数据，payload 包含发送者信息 |
| `ping` | `(ms)` | 当触发一次 ping 检测后返回结果（毫秒） |
| `ping_check` | — | 触发一次按需 ping 检测 |
| `death` | — | Bot 死亡（框架自动重生） |
| `respawn` | — | Bot 重生完成 |
| `kicked` | `(reason)` | 被踢出服务器 |
| `end` | `(reason)` | 连接断开 |
| `error` | `(err)` | 发生错误 |

---

### Bot 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `bot.username` | string | 实际登录的用户名 |
| `bot.ping` | number\|null | 当前延迟（ms），连接前为 null |
| `bot.isAlive` | boolean | Bot 是否存活 |

---

## 正版登录

```js
const bot = litemc.createBot({
  username: 'your@email.com',  // Microsoft 账号邮箱
  auth: 'microsoft',
  host: 'mc.example.com'
})
```

首次运行会显示 Microsoft 登录链接（代码已自动填充），在浏览器中完成认证后，token 会缓存在 `./auth/` 文件夹。后续登录会自动使用缓存，无需重新认证。

**首次登录提示示例：**

```
=== Microsoft 登录 ===
请在浏览器中打开以下链接（代码已自动填充）：
https://www.microsoft.com/link?otc=ABC123

或者手动访问： https://www.microsoft.com/link
并输入代码： ABC123

等待授权中...
```

---

## 特性

- ✅ 连接 / 断开服务器
- ✅ 发送聊天消息
- ✅ 监听所有聊天消息（玩家聊天 + 系统消息）
- ✅ 死亡自动重生（控制台打印提示）
- ✅ 自动接受资源包
- ✅ 按需延迟检测（`bot.checkPing()` / `ping_check`）
- ✅ 正版（Microsoft）+ 离线双模式
- ✅ 支持 1.8 ~ 最新版本协议
- ✅ 智能认证流程（首次登录稳定，后续快速）
- ❌ 无三维移动 / 视角 / 物品栏等功能（轻量设计）

---

## 插件系统

```js
// 定义插件
const myPlugin = {
  init (bot) {
    // 插件初始化
    bot.on('message', (raw) => {
      const text = litemc.parseChat(raw)
      if (text.includes('hello')) {
        bot.chat('Hello from plugin!')
      }
    })
  },
  unload (bot) {
    // 插件卸载时的清理工作
  }
}

// 加载插件
bot.loadPlugin('myPlugin', myPlugin)

// 获取插件
bot.getPlugin('myPlugin')

// 卸载插件
bot.unloadPlugin('myPlugin')
```

---

## 控制台命令

框架内置控制台输入支持：

- 直接输入消息发送到服务器
- 输入 `exit` 退出程序

---

## 高级配置

### 自定义登录回调

```js
const bot = litemc.createBot({
  username: 'your@email.com',
  auth: 'microsoft',
  host: 'mc.example.com',
  onMsaCode: (data) => {
    console.log('请访问:', data.verification_uri)
    console.log('输入代码:', data.user_code)
  }
})
```

### 手动控制连接

```js
const bot = litemc.createBot({
  username: 'Steve',
  auth: 'offline',
  host: 'mc.example.com',
  autoConnect: false  // 不自动连接
})

// 稍后手动连接
setTimeout(() => {
  bot.connect()
}, 5000)
```

### 轻量模式（默认行为）

```js
const bot = litemc.createBot({
  username: 'Steve',
  auth: 'offline',
  host: 'mc.example.com',
  // 以下是默认值，可按需覆盖
  view: 12,
  sim: 12,
  loadRegistry: false,
  disconnectOnProtocolError: false
})
```

### 按需检测一次 ping

```js
// 方式 1：直接调用
const ms = await bot.checkPing(5000)
console.log('当前延迟:', ms, 'ms')

// 方式 2：事件触发（结果仍通过 ping 事件返回）
bot.emit('ping_check')
```

---

## 断线自动重连

Bot 支持断线自动重连，适用于网络不稳定或服务器重启的场景。

```js
const bot = litemc.createBot({
  username: 'Steve',
  auth: 'offline',
  host: 'mc.example.com',
  keepAliveTimeout: 90000,   // 90 秒 keep_alive 超时（默认 60 秒）
  reconnect: 5,              // 最多重连 5 次（0 = 不重连）
  reconnectInterval: 10000   // 每次重连间隔 10 秒
})
```

**说明：**
- `keepAliveTimeout`：底层 `minecraft-protocol` 默认 30 秒超时，框架已改为 60 秒。高延迟或不稳定环境建议适当增大。
- `reconnect`：设置为 `0`（默认）表示不自动重连。
- 主动调用 `bot.disconnect()` 不会触发重连。
- 每次成功登录后，重连计数器自动归零。
- 重连期间会触发 `reconnecting` 日志输出，登录成功后继续正常使用。

---

## 常见问题

### Q: 首次登录时出现连接错误？
A: 首次 Microsoft 登录时，如果出现 `ECONNRESET` 错误，请再次运行程序即可。这是认证流程的正常现象，第二次运行会使用缓存快速连接。

### Q: 如何清除认证缓存？
A: 删除项目目录下的 `auth` 文件夹即可。

### Q: 支持哪些 Minecraft 版本？
A: 支持 1.8 到最新版本的所有协议。框架会自动协商版本，也可以手动指定 `version` 参数。

---

## 许可证

MIT License

---

## 贡献

欢迎提交 Issue 和 Pull Request！

GitHub: https://github.com/natsuwiki/LiteMC.git
