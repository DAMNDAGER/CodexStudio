# Codex Studio (v2.6.0)

> **Windows Native Desktop API Gateway, Model Switcher & Dual-Engine Visual Studio for OpenAI Codex (CLI & Desktop App)**
>
> **专为 Windows 10/11 (x64) 打造的 OpenAI Codex 桌面级 API 网关、中转站模型调度器与双引擎视觉创作工作台**

[![Latest Release](https://img.shields.io/github/v/release/DAMNDAGER/CodexStudio?display_name=tag&style=flat-square&logo=github&color=0071E3)](https://github.com/DAMNDAGER/CodexStudio/releases/latest)
[![Platform](https://img.shields.io/badge/Platform-Windows_10_%7C_11_(x64)-0071E3?style=flat-square&logo=windows&logoColor=white)](#4-quick-start-windows-10--11)
[![License: MIT](https://img.shields.io/badge/License-MIT-34C759?style=flat-square)](./LICENSE)
[![RAM Footprint](https://img.shields.io/badge/RAM_Footprint-~4MB_Micro--Kernel-5E5CE6?style=flat-square)](#3-architecture--windows-runtime-priority)
[![Dependencies](https://img.shields.io/badge/Dependencies-Zero_(Pure_Stdlib)-FF9F0A?style=flat-square)](#3-architecture--windows-runtime-priority)
[![Protocols](https://img.shields.io/badge/Protocols-Responses_API_%E2%86%94_Chat_Completions-FF375F?style=flat-square)](#1-core-problems-solved)

**Quick Navigation / 快速导航：** [English Documentation](#-english-documentation) | [简体中文文档](#-简体中文文档) | [Download / 下载发行版](#-download-matrix--版本下载矩阵) | [Quick Start / 30秒上手](#4-quick-start-windows-10--11)

> **Core Highlights / 核心特性：**
> One-Click Full-Blooded GPT & Relay Setup · Dynamic Coding & Image Model Fetching · `/img` 0-Token Direct Draw · Vision Coding 0 False Positives · Cross-Protocol Auto-Bridge (`Responses API` ↔ `Chat Completions`) · One-Click Reveal in Windows Explorer
>
> 中转站一 Key 双用 · 极简一键满血激活 · 编程/生图双模型在线拉取 · `/img` 0 Token 秒级画图 · 看图写代码 0 误判 · `Responses` 与 `Chat` 跨协议自动桥接 · 照片一键资源管理器高亮定位

## 📦 Download Matrix / 版本下载矩阵

Please visit [**GitHub Releases**](https://github.com/DAMNDAGER/CodexStudio/releases/latest) to download the package that fits your environment:

请前往 [**GitHub Releases 页面**](https://github.com/DAMNDAGER/CodexStudio/releases/latest) 下载对应发行包：

| Package / 发行包名称 | Size / 体积 | Target Audience / 适用人群 | Runtime Requirement / 环境依赖 |
| :--- | :--- | :--- | :--- |
| [**`CodexStudio-v2.6.0-Windows-x64.zip`**](https://github.com/DAMNDAGER/CodexStudio/releases/latest/download/CodexStudio-v2.6.0-Windows-x64.zip) | ~28 MB | **Recommended for All Windows Users** / 推荐所有 Windows 用户下载（解压即用） | **None** (Bundled standalone runtime, no Node.js or Python needed / 内置独立运行环境，免安装) |
| [**`CodexStudio-v2.6.0-Source.zip`**](https://github.com/DAMNDAGER/CodexStudio/releases/latest/download/CodexStudio-v2.6.0-Source.zip) | ~95 KB | **Developers & Power Users** / 已安装 Node.js 或 Python 3 的开发者 | Requires `Node.js >= 16` or `Python >= 3.8` (Zero `npm`/`pip` packages needed / 纯标准库零第三方依赖) |

## 🇺🇸 English Documentation

**Codex Studio** is a zero-dependency desktop API gateway, multi-provider switcher (inspired by CC Switch), and visual creation studio built specifically for **OpenAI Codex CLI & Desktop App** on Windows 10/11. It listens locally on `http://127.0.0.1:8765/v1`, manages `%USERPROFILE%\.codex\config.toml` and `auth.json` with automatic backups, and bridges image generation into Codex without breaking screenshot-based coding workflows.

### 1. Core Problems Solved

1. **Zero Manual `config.toml` Editing & Express One-Click Setup**:
   Switching between OneAPI / NewAPI relays, OpenAI Official, DeepSeek, Claude, or local Ollama normally requires manual edits to `%USERPROFILE%\.codex\config.toml` and `auth.json`. Codex Studio backs up your config (`config.toml.bak`) and writes everything in one click. With **Express Full-Blooded Mode (`⚡ 一键满血激活`)**, simply enter your relay URL and API Key to automatically probe `/v1/models`, bind the highest-tier GPT coding model (`gpt-5-codex` / `gpt-4o`) and image model (`gpt-image-2`), and activate Codex immediately.
2. **Online Image Model Discovery & HTTP 503 Self-Healing**:
   Different API relay token groups expose different image models (`gpt-image-2`, `gpt-image-1`, `dall-e-3`, `flux-pro`). Hardcoding `dall-e-3` frequently triggers `HTTP 503 model_not_found / No available channel`. Codex Studio fetches `/v1/models` online to classify both coding LLMs and image models, and automatically probes and falls back to an available image model whenever an upstream `503` or `model_not_found` error occurs.
3. **Vision Coding 0 False Positives & Anti-Loop Protection (`getFreshUserPrompt`)**:
   - **Code Intent Guardrail**: Sending a UI screenshot and asking *"Write a React component based on this image"* is never misclassified as an image generation request—100% of coding prompts pass straight through to the coding LLM.
   - **Tool-Call Loop Prevention**: The gateway's `getFreshUserPrompt` parser inspects **only** the terminal item in `messages` / `input`. Tool execution callbacks (`type: "function_call_output"`, `role: "tool"`) and assistant continuations return `null` and pass through 100% untouched, combined with a 2.5-second request deduplication cache.
4. **Cross-Protocol Auto-Bridge (`Responses API` ↔ `Chat Completions API`)**:
   OpenAI Codex CLI defaults to the `/v1/responses` protocol, whereas many third-party relays, DeepSeek, Claude endpoints, and local Ollama instances only implement `/v1/chat/completions`. Codex Studio automatically translates `/v1/responses` payloads (including `input`, `instructions`, and streaming SSE chunks) into `/v1/chat/completions` requests when routing to `chat`-protocol providers or when an upstream relay returns `HTTP 404/405/501` on `/v1/responses`, converting upstream SSE deltas back into `response.output_text.delta` events in real time.
5. **One-Click Reveal in Windows Explorer & Native System Tray**:
   Generated PNG images and metadata sidecars are saved in `outputs\`. Clicking **Reveal in Explorer (`📂 打开文件位置`)** invokes a sandboxed, parameterized `explorer.exe /select,"<path>"` call to highlight the exact file in Windows File Explorer. Launching via `CodexStudio.vbs` runs completely silently (zero `cmd.exe` console flash) and docks a native `.NET NotifyIcon` (`tray.ps1`) in the Windows system tray.

### 2. Feature Comparison

| Feature / Capability | CC Switch (`cc-switch`) | CLI Proxies (`codex-proxy`) | Image Skills (`codex-imagen`) | **Codex Studio (v2.6.0)** |
| :--- | :---: | :---: | :---: | :---: |
| **Frameless Desktop App + System Tray** | Yes | No (CLI only) | No (Script only) | **Yes (`--app` Window + Native `.NET` Tray)** |
| **Memory Footprint (RAM)** | ~120 MB+ (Electron/WebView) | ~30 MB | N/A | **~4 MB Heap / ~24 MB RSS Micro-Kernel** |
| **Online `/v1/models` Model Discovery** | Coding models only | No | No | **Dual Discovery (Coding LLMs + Image Models)** |
| **HTTP 503 Image Model Self-Healing** | N/A | No | Hardcoded (Prone to 503) | **Auto-Probes `/v1/models` & Persists Working Model** |
| **Mode 1: Natural Language Draw + Code Guard** | No | Pass-through only | High false-positive rate | **Terminal-Turn Parser + Code Guardrail (0 Misjudgments)** |
| **Mode 2: `/img` & `/draw` 0-Token Direct Draw** | No | No | Consumes chat tokens | **Local `<5ms` Intercept (0 Conversational Tokens)** |
| **Multi-Turn Tool Loop Prevention** | N/A | Yes | Prone to infinite loops | **Strict `getFreshUserPrompt` Terminal Check + 2.5s Debounce** |
| **`Responses API` ↔ `Chat API` Auto-Bridge** | Config rewrite only | Partial | No | **Real-Time SSE & JSON Bidirectional Protocol Bridge** |
| **One-Click `explorer.exe /select` Highlight** | No | No | Text path only | **Yes (Canvas, Gallery Cards & Fullscreen Lightbox)** |

### 3. Architecture & Windows Runtime Priority

Double-clicking **`CodexStudio.vbs`** runs a pre-flight check against `http://127.0.0.1:8765/api/health`, cleans up stale port `8765` listeners, and boots the gateway using a 4-tier runtime detection chain:

1. **Priority 1 — Node.js Micro-Kernel (`node.exe server.js`)**: Pure Node.js standard library (`http`, `https`, `fs`, `crypto`, `child_process`), ~4 MB heap usage, real-time SSE streaming and cross-protocol bridging.
2. **Priority 2 — Python 3 Multi-Threaded Kernel (`python.exe server.py`)**: Powered by `ThreadingHTTPServer` and pure Python standard library (`http.server`, `urllib`, `threading`, `secrets`), featuring non-blocking SSE chunk streaming and 100% API parity with `server.js` (automatically skips Windows Store 0-byte Python stubs).
3. **Priority 3 — Windows Python Launcher (`py.exe -3 server.py`)**: Standard Windows Python launcher fallback.
4. **Priority 4 — Standalone Windows Binary (`Image2Studio\Image2Studio.exe`)**: Included in `CodexStudio-v2.6.0-Windows-x64.zip` for zero-dependency execution on clean Windows machines.

### 4. Quick Start (Windows 10 / 11)

#### Option A: Portable Full Package (`CodexStudio-v2.6.0-Windows-x64.zip`)
1. Download and extract [**`CodexStudio-v2.6.0-Windows-x64.zip`**](https://github.com/DAMNDAGER/CodexStudio/releases/latest/download/CodexStudio-v2.6.0-Windows-x64.zip).
2. Double-click **`CodexStudio.vbs`** in the root folder.
3. In the **Express Full-Blooded Mode (`⚡ 极简一键满血模式`)** card (or the 3-step Onboarding Wizard):
   - Enter your OneAPI / NewAPI relay Base URL and API Key.
   - Click **`⚡ 一键满血激活并写入 Codex`** (One-Click Activate).
   - Codex Studio automatically probes your relay's best coding and image models, writes `%USERPROFILE%\.codex\config.toml`, and installs the global `%USERPROFILE%\.codex\skills\image2` skill.

#### Option B: Lightweight Source Package (`CodexStudio-v2.6.0-Source.zip`)
1. Download and extract [**`CodexStudio-v2.6.0-Source.zip`**](https://github.com/DAMNDAGER/CodexStudio/releases/latest/download/CodexStudio-v2.6.0-Source.zip) (or run `git clone https://github.com/DAMNDAGER/CodexStudio.git`).
2. Double-click **`CodexStudio.vbs`** on Windows, or start manually from any terminal:

```bash
# Start with Node.js micro-kernel (Port 8765)
node server.js

# Or start with Python 3 multi-threaded micro-kernel (Port 8765)
python server.py
```

### 5. Codex CLI & Desktop Usage Examples

Once activated, use OpenAI Codex CLI or Desktop App as usual:

```text
# 1. Mode 2: Explicit prefix command (Intercepted locally in <5ms, 0 LLM chat tokens consumed)
> /img cyberpunk neon street in rainy night, 16:9, hd
> /draw minimalist 3D clay style fox avatar, 1024x1024

# 2. Mode 1: Natural language image generation (Automatically routed to image engine)
> Generate a warm 1980s Chinese family Lunar New Year reunion photo

# 3. Vision Coding with Code Guardrail (100% passed through to coding LLM, 0 false triggers)
> Based on @ui-screenshot.png, write a responsive React login component with Tailwind CSS
```

### 6. Security & Local Storage Architecture

- **Dynamic Per-Instance Token Handshake (`.image2-token`)**: On first startup, Codex Studio generates a cryptographically random 192-bit token stored in `.image2-token`, injects it into the studio UI via `<meta name="image2-local-token">`, and enforces `X-Image2-Local-Token` + Loopback Origin (`127.0.0.1` / `localhost`) verification across management `/api/*` endpoints to block CSRF and DNS-rebinding attacks.
- **Sandboxed File Explorer Integration**: All file reveal actions validate paths against an allowlisted directory sandbox (`outputs\`, `data\`, `%USERPROFILE%\.codex`) and invoke `explorer.exe` via shell-free parameterized process spawning.

```text
CodexStudio/
├── CodexStudio.vbs        # Windows silent launcher (4-tier engine detection, zero console flash)
├── tray.ps1               # Windows native system tray daemon (.NET NotifyIcon, pure 7-bit ASCII)
├── server.js              # Node.js zero-dependency micro-kernel gateway (Port 8765)
├── server.py              # Python 3 multi-threaded zero-dependency micro-kernel (Port 8765)
├── data/
│   └── config.json        # Local provider profiles, routing rules & onboarding state
├── public/
│   └── index.html         # Single-page desktop studio UI (macOS Sequoia dark/light design)
├── outputs/               # Generated PNG images and JSON metadata sidecars
├── LICENSE                # MIT License
└── README.md              # Bilingual English & Chinese documentation
```

## 🇨🇳 简体中文文档

**返回顶部 / Back to Top：** [Codex Studio (v2.6.0)](#codex-studio-v260)

**Codex Studio** 是一款专为 **OpenAI Codex (CLI 终端与 Desktop 桌面端)** 打造的超轻量桌面级 API 网关、多渠道模型切换器（CC Switch 风格）与双引擎视觉创作工作台。软件通过监听本地 `http://127.0.0.1:8765/v1` 接管并智能调度 Codex 请求，支持一键自动备份并写入 `%USERPROFILE%\.codex\config.toml`，彻底解决第三方中转站配置繁琐、生图报 `503` 错误、看图写代码误触发画图以及多轮工具调用死循环等核心痛点。

### 1. 解决 Codex 开发者的 6 大核心痛点

1. **告别手改 `config.toml` 与「⚡ 极简一键满血模式」**：
   无需手动翻找和编辑 `~/.codex/config.toml` 与 `auth.json`。只需在首页 **「⚡ 极简一键满血模式」** 中填入 OneAPI / NewAPI 中转站地址与 API Key，点击 **「⚡ 一键满血激活并写入 Codex」**，系统会自动向中转站探测并优选满血编程大模型（如 `gpt-5-codex`、`gpt-4o`、`o3`）与可用视觉生图模型（如 `gpt-image-2`、`dall-e-3`、`flux-pro`），自动备份原配置（`config.toml.bak`）并完成一 Key 双用绑定。
2. **生图模型在线拉取 + HTTP 503 智能自愈回退**：
   不同中转站令牌分组支持的视觉模型各不相同，写死 `dall-e-3` 极易报 `HTTP 503 No available channel / model_not_found`。Codex Studio 支持一键在线拉取 `/v1/models` 并通过正则引擎智能分离「编程模型」与「🎨 视觉生图模型」；当生图请求遇到 `503 / model_not_found` 时，微内核会自动探测当前渠道可用生图模型并无感重试、自动持久化保存可用模型。
3. **「看图写代码」0 误判 & 工具调用防死循环 (`getFreshUserPrompt`)**：
   - **代码护栏 (`codeGuard`)**：当你发送 UI 截图并提问「参考这张图写一个 React 登录组件」时，代码护栏精准识别编程意图，100% 透传给编程大模型，绝不误触发画图；
   - **终端消息判定与 2.5 秒防抖**：`getFreshUserPrompt` 严格只检查 `messages` / `input` 数组的最后一条终端记录。遇到工具执行回传（`function_call_output` / `role: "tool"`）或助手续写时直接返回 `null` 并 100% 原样透传，彻底根除多轮工具调用时的重复生图死循环。
4. **`Responses API` ↔ `Chat Completions` 跨协议自动桥接（P0 核心升级）**：
   Codex CLI 默认发送 `/v1/responses` 请求，而 DeepSeek、Claude、兼容接口及本地 Ollama 仅支持 `/v1/chat/completions`。Codex Studio 内置双向协议转换器：当切换到 `chat` 协议渠道或上游 `/v1/responses` 返回 `404/405/501` 时，网关自动将 `Responses` 请求体（含 `input`、`instructions`）无损转换为 `Chat Completions` 请求，并将上游返回的 SSE 流式分片实时转译为 Codex 所需的 `response.output_text.delta` 事件流，无需重启 Codex CLI 即可跨协议丝滑切换。
5. **已生成照片一键打开 Windows 资源管理器高亮定位**：
   所有生成的图片与元数据保存在本地 `outputs\` 目录。在视觉工坊、作品画廊或全屏灯箱中点击 **「📂 打开文件位置」**，后端通过沙箱路径校验与无 Shell 参数化调用 `explorer.exe /select,"<物理路径>"`，直接弹出 Windows 资源管理器并高亮选中该照片；点击 **「🖼️ 复制图片」** 可将高清 PNG 原图直接写入系统剪贴板。
6. **Windows 原生零黑框启动与右下角系统托盘常驻**：
   双击 `CodexStudio.vbs` 即可静默启动后台服务（全程零 `cmd.exe` 黑框闪烁），通过 Edge / Chrome `--app` 模式打开 macOS Sequoia 风格独立桌面窗口，并在任务栏右下角驻留原生 `.NET NotifyIcon` 托盘图标（`tray.ps1` 采用 100% 纯 7-bit ASCII 结合 `\uXXXX` 运行时解码，彻底杜绝中文 Windows GBK/CP936 乱码）。

### 2. 双引擎视觉拦截架构说明

Codex Studio 提供两种互补的生图触发引擎，可在界面中独立开启或关闭：

| 引擎模式 | 触发方式 | 底层执行机制 | Token 消耗 | 适用场景 |
| :--- | :--- | :--- | :--- | :--- |
| **方案一：自然语言无感生图** (`mode1_llm_tool`) | 直接输入「帮我画一张赛博朋克雨夜街景，16:9」 | `getFreshUserPrompt` 提取最新用户提问 → 通过 `codeGuard` 排除代码意图 → 匹配中英文画图语义并调用视觉引擎 | **0 对话 Token**（本地直接合成标准 SSE 响应流回传 Codex） | 日常自然对话创作、快速配图 |
| **方案二：显式指令秒级直达** (`mode2_prefix_direct`) | 以 `/img`、`/draw`、`/image`、`画图：` 开头 | 本地微内核在 `<5ms` 内毫秒级截获，自动解析宽高比（`16:9`、`9:16`、`1024x1024`）、画质（`hd`/`4k`）、`--dry-run` 及 `@本地参考图路径` | **0 对话 Token**（绕过上游对话大模型，秒级出图） | 明确生图需求、零额度损耗极速生图、垫图编辑 |

### 3. 四大接入通道全覆盖

- **⚡ 聚合中转站 (OneAPI / NewAPI · 一 Key 双用)**：同一个中转站地址与 API Key 同时驱动 Codex 编程与视觉生图，支持在线拉取模型列表与一键满血激活；
- **🛡️ 官方账号 + 本地混合生图**：保留 Codex 官方 ChatGPT Plus/Pro 登录态，同时自动在 `%USERPROFILE%\.codex\skills\image2` 挂载全局生图 Skill；
- **🌐 官方 / 专线 API (OpenAI / DeepSeek / Claude / 兼容接口)**：内置快捷地址预设，依靠跨协议桥接器无缝混用 `Responses` 与 `Chat` 渠道；
- **💻 本地大模型 (Ollama / vLLM / LM Studio)**：一键免 Key 接入本机 `http://127.0.0.1:11434/v1` 并自动嗅探本地 `/api/tags` 模型库。

### 4. Windows 30 秒快速上手

#### 方式一：下载 Windows 免安装完整版（推荐）
1. 前往 [GitHub Releases](https://github.com/DAMNDAGER/CodexStudio/releases/latest) 下载 [**`CodexStudio-v2.6.0-Windows-x64.zip`**](https://github.com/DAMNDAGER/CodexStudio/releases/latest/download/CodexStudio-v2.6.0-Windows-x64.zip) 并解压（内置独立运行环境，电脑无需安装 Node.js 或 Python）；
2. 双击根目录下的 **`CodexStudio.vbs`**；
3. 在首页 **「⚡ 极简一键满血模式」** 中填入中转站地址与 API Key，点击 **「⚡ 一键满血激活并写入 Codex」** 即可立即在 Codex 中使用。

#### 方式二：下载轻量纯源码包（开发者推荐）
1. 下载并解压 [**`CodexStudio-v2.6.0-Source.zip`**](https://github.com/DAMNDAGER/CodexStudio/releases/latest/download/CodexStudio-v2.6.0-Source.zip)；
2. Windows 用户直接双击 **`CodexStudio.vbs`**（自动按优先级检测本机 `node.exe` → `python.exe` → `py.exe -3` 并静默启动），或通过终端启动：

```bash
# 使用 Node.js 微内核启动（推荐，常驻内存仅 ~4MB）
node server.js

# 或使用 Python 3 多线程微内核启动（零第三方 pip 依赖）
python server.py
```

### 5. 右下角系统托盘 (`tray.ps1`) 快捷操作

程序启动后，Windows 右下角通知区域会常驻蓝底托盘图标：
- **左键单击 / 双击图标**：立即唤出或置顶 Codex Studio 独立桌面窗口；
- **右键菜单功能**：
  - **打开 Codex Studio 桌面工作台**
  - **打开新手配置与清理向导**
  - **整理微内核内存 (RAM GC)**：调用 `/api/system/gc` 触发垃圾回收并弹出实时内存通知
  - **在系统浏览器中打开**
  - **彻底关闭后台并退出 (Quit)**：调用 `/api/system/shutdown` 安全关闭后台服务并释放 `8765` 端口

## 📄 License / 开源协议

本项目基于 [MIT License](./LICENSE) 开源协议发布，欢迎自由使用、修改与分发。
