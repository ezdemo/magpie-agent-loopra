# Loopra Agent for Magpie

<img src="assets/loopra-logo.svg" alt="Loopra" width="80" height="80">

让 [Loopra](https://github.com/ezdemo/loopra) 出现在 Magpie 的 **Agent** 页面，使用 Magpie 管理的供应商、模型和路由组。适配 Loopra 的多渠道模型配置，同时兼容旧版单渠道字段。

这是按 [Magpie Agent 插件规范](https://usemagpie.ai/docs/zh/plugins#agents) 编写的 Agent 插件，不需要构建、安装依赖或启动额外服务。

## 安装与使用

需要已安装的 Loopra，以及支持 Agent 插件的 Magpie。已用 Magpie **0.1.1285** 完成真实插件加载、模型切换和断开恢复测试，配置字段按 Loopra **26.9.91** 源码适配。

```sh
magpie plugin add github:ezdemo/magpie-agent-loopra
```

也可以在 Magpie「插件 → 添加插件」中填写 `github:ezdemo/magpie-agent-loopra`。

1. 在 Magpie 里配置或登录你要使用的供应商。
2. 打开 **Agent → Loopra**，选择一个 Magpie 模型。
3. 重启 Loopra 后端服务；桌面端请退出后重新启动。新建会话，或在现有会话中选择 **Magpie** 渠道及其模型。

命令行也可以选择模型：

```sh
magpie models loopra
magpie loopra <供应商>/<模型>
```

模型 ID 原样保留为 `供应商/模型`，路由组为 `group/<组 ID>`。在 Loopra 的模型选择器中也能切换 Magpie 提供的模型。

断开连接：

```sh
magpie loopra default
```

也可关闭 Agent 页的连接开关。断开后重启 Loopra 服务以加载恢复的配置。

## 模型配置适配

配置文件：`~/.loopra/config.json`，Windows 对应 `%USERPROFILE%\.loopra\config.json`。Web、CLI 和 Electron Desktop 的核心服务共用此配置目录；使用自定义 Java `user.home` 时需相应调整插件的 `agent.config` 和 `agent.dir`。

| Magpie 输入 | Loopra 配置 |
| --- | --- |
| 选中的 `model.id` | 顶层 `model`，由 Magpie 写入 |
| `gateway.v1` | Magpie 渠道的 `baseUrl` |
| `gateway.key` | Magpie 渠道的 `apiKey`，按 Loopra 独立统计用量 |
| 固定渠道 ID `magpie` | `modelChannelId`、渠道的 `id` |
| `models[].id` | `modelChannels[].models[].name` |
| `models[].context` | `contextTokens`，未知时为 `-1` |
| `models[].output` | `maxTokens`，未知时沿用 Loopra 默认值 `32768` |
| `models[].images` | `imageInput`，仅明确支持时启用 |

渠道使用 `chat_completions`；上游供应商使用 Responses、Anthropic 等协议时，由 Magpie 网关转换。`specialCompatibility` 设为空，避免把原渠道的 OpenCode 等特殊兼容模式带到网关。插件还同步顶层 `baseUrl`、`apiKey`、`apiProtocol`、`specialCompatibility`、`availableModels`，供旧版 Loopra 使用。

Magpie 模型列表刷新时会重新调用 `connect`，同步列表与能力。插件不修改 Loopra 的推理强度、工具审批、项目目录或会话数据，也不推测模型价格。Loopra 配置文件不提供逐模型推理强度列表字段，因此不写入 Magpie 的 `efforts`。

## 原配置与已有会话

- **连接期间，`modelChannels` 临时替换为一个 Magpie 渠道。** Magpie 的 Agent 插件接口不提供原文件内容，无法合并原有渠道。原渠道由 Magpie 备份，断开后按原类型完整恢复；其他无关配置保留。
- 连接期间请在 Magpie 管理模型。手动修改被接管的字段（包括添加 Loopra 渠道）可能在同步或恢复时被替换。需要编辑原渠道时，先断开连接。
- 已有会话保存了自己的模型和渠道选择，修改全局默认值不会自动改写这些会话。请新建会话，或在会话里重新选择 Magpie 渠道与模型。
- 若原来为独立校验模型或图片理解回退指定了其他渠道，连接期间这些原渠道不可用。可在 Loopra 中重新选择 Magpie 渠道里的模型，或使用支持图片输入的主模型。
- 默认只适配模型连接；插件未声明资源库的 instructions / MCP / skills 同步。

## 本地开发与验证

插件运行于 Magpie 内置的 moejs，不使用 Node、文件系统、网络或第三方模块。只有测试需要 Node.js 22+。

```sh
git clone https://github.com/ezdemo/magpie-agent-loopra.git
cd magpie-agent-loopra
npm test
npm run test:integration
```

集成测试需要 PATH 中的 Magpie CLI；也可设置 `MAGPIE_BIN` 为其可执行文件的绝对路径。测试使用临时 HOME、USERPROFILE、应用数据目录和 XDG 目录，不改动实际 Loopra / Magpie 配置，不使用真实模型或登录信息。覆盖真实 moejs 加载、模型切换、多渠道与旧配置的断开恢复。

开发时可手动安装本地目录：

```sh
magpie plugin add .
```

更新：

```sh
magpie plugin update
```

许可证：[MIT](LICENSE)。
