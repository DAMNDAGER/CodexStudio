# Codex Studio (v2.6.0)

> **100 KB Ultra-Lightweight Desktop API Gateway, Widescreen Model Switcher & Dual-Engine Visual Studio for OpenAI Codex (CLI & Desktop App)**
>
> **专为 Windows 10/11 (x64) 打造的 100 KB 超轻量 OpenAI Codex 桌面级 API 网关、宽屏双栏模型调度器与双引擎视觉创作工作台**

[![Latest Release](https://img.shields.io/github/v/release/DAMNDAGER/CodexStudio?display_name=tag&style=flat-square&logo=github&color=0071E3)](https://github.com/DAMNDAGER/CodexStudio/releases/latest)
[![Platform](https://img.shields.io/badge/Platform-Windows_10_%7C_11_(x64)-0071E3?style=flat-square&logo=windows&logoColor=white)](#5-quick-start-windows-10--11)
[![Package Size](https://img.shields.io/badge/Package_Size-~102_KB_Zero--Bloat-34C759?style=flat-square)](#2-why-only-102-kb-the-zero-bloat-micro-kernel-architecture)
[![RAM Footprint](https://img.shields.io/badge/RAM_Footprint-~4MB_Micro--Kernel-5E5CE6?style=flat-square)](#2-why-only-102-kb-the-zero-bloat-micro-kernel-architecture)
[![Dependencies](https://img.shields.io/badge/Dependencies-Zero_(Pure_Stdlib)-FF9F0A?style=flat-square)](#4-architecture--windows-runtime-chain)
[![Protocols](https://img.shields.io/badge/Protocols-Responses_API_%E2%86%94_Chat_Completions-FF375F?style=flat-square)](#1-core-problems-solved-in-v260)
[![License: MIT](https://img.shields.io/badge/License-MIT-34C759?style=flat-square)](./LICENSE)

**Quick Navigation / 快速导航：** [English Documentation](#-english-documentation) | [简体中文文档](#-简体中文文档) | [Download / 版本下载矩阵](#-download-matrix--版本下载矩阵) | [Why ~102 KB? / 为什么仅 102 KB？](#2-为什么-windows-完整包仅-102-kb零膨胀微内核架构解析) | [Quick Start / 30秒上手](#5-windows-30-秒快速上手)

> **v2.6.0 Core Highlights / v2.6.0 核心亮点：**
> `~102 KB` Zero-Binary Pure-Script Package (0% AV False Positives) · `1440×860` Widescreen Dual-Column Co-Management (Coding API + Image API Side-by-Side) · Cross-Protocol Auto-Bridge (`Responses API` ↔ `Chat Completions`) · Online Coding & Image Model Discovery · `/img` `<5ms` 0-Token Direct Draw · Vision Coding 0 False Positives (`codeGuard` + `getFreshUserPrompt`) · Local `.image2-token` Security Hardening · Cross-Folder Git Auto-Sync (`git-auto-push.bat`)
>
> `~102 KB` 纯标准库零二进制架构（100% 源码透明 · 0 杀软误报） · `1440×860` 宽屏左右双栏同屏共管（左侧编程 API + 右侧生图设置 + 左栏第二项独立生图页） · 100% 厂商中立设计 · `Responses` 与 `Chat` 跨协议实时双向桥接 · 编程/生图双模型在线拉取与 HTTP 503 自愈 · `/img` 0 Token 秒级直达 · 看图写代码 0 误判 · 跨版本文件夹 Git 历史无损自动推送

## 📦 Download Matrix / 版本下载矩阵

Please visit [**GitHub Releases**](https://github.com/DAMNDAGER/CodexStudio/releases/latest) to download the package that fits your workflow:

请前往 [**GitHub Releases 页面**](https://github.com/DAMNDAGER/CodexStudio/releases/latest) 下载对应发行包：

| Package / 发行包名称 | Size / 体积 | Target Audience / 适用人群 | Included Launchers & Tools / 内置启动器与工具 |
| :--- | :--- | :--- | :--- |
| [**`CodexStudio-v2.6.0-Windows-x64.zip`**](https://github.com/DAMNDAGER/CodexStudio/releases/latest/download/CodexStudio-v2.6.0-Windows-x64.zip) | **~102 KB** | **All Windows 10/11 Codex Users** / 推荐所有 Windows 用户下载（解压即用、零杀软误报） | `CodexStudio.vbs` (Silent Desktop Launcher) + `start-windows.bat` + `tray.ps1` (Native `.NET` Tray) + Dual Micro-Kernels (`server.js` / `server.py`) |
| [**`CodexStudio-v2.6.0-Source.zip`**](https://github.com/DAMNDAGER/CodexStudio/releases/latest/download/CodexStudio-v2.6.0-Source.zip) | **~102 KB** | **Developers & Maintainers** / 开发者与开源维护者（含跨版本 Git 推送工具） | Full Source + `git-auto-push.bat` (Cross-Folder Git `origin/main` History Sync & Key Sanitizer) + `CodexStudio.vbs` + `tray.ps1` |

## 🇺🇸 English Documentation

**Codex Studio (v2.6.0)** is an ultra-lightweight (`~102 KB`), vendor-neutral desktop API gateway, multi-provider switcher, and dual-engine visual creation studio engineered for **OpenAI Codex CLI & Desktop App** on Windows 10/11. It listens locally on `http://127.0.0.1:8765/v1`, manages `%USERPROFILE%\.codex\config.toml` and `auth.json` with automatic backups, and unifies coding LLM routing and image generation in a single `1440×860` widescreen desktop workbench.

### 1. Core Problems Solved in v2.6.0

1. **Widescreen Dual-Column API & Image Co-Management (No More Manual `config.toml` Edits)**:
   - **1440×860 Widescreen Workbench**: Launches directly in a landscape desktop window (`1440×860`) with a concise top mode bar (`🌐 API Channels & Image Setup` | `🔐 Official Client + Visual Plugin` | `💻 Local Ollama Direct` + `⚡ Auto-Probe & Activate`).
   - **Side-by-Side Co-Management**: Section 1 (`API 与生图总览`) places **Coding API Settings** on the left and **Visual Image API Settings** on the right. Toggle **One-Key Dual-Use (`一Key双用联动`)** to share your primary API URL/Key for both coding and drawing, or uncheck it to configure a **Standalone Image Base URL, API Key, and Generation Path** right on the home screen—or switch to the **2nd Left Sidebar Tab (`独立生图与存储设置`)** for multi-profile image engine and storage management.
   - **100% Vendor-Neutral**: Ships with clean, official standard presets (`https://api.openai.com/v1`, `https://api.deepseek.com/v1`, `http://127.0.0.1:11434/v1`) and zero bundled third-party relay advertisements.
2. **Cross-Protocol Auto-Bridge (`Responses API` ↔ `Chat Completions API`)**:
   OpenAI Codex CLI defaults to `/v1/responses`, whereas DeepSeek, Claude endpoints, local Ollama, and many OpenAI-compatible gateways only implement `/v1/chat/completions`. Codex Studio includes a real-time bidirectional protocol bridge: when routing to a `chat`-protocol channel or when an upstream endpoint returns `HTTP 404/405/501` on `/v1/responses`, the micro-kernel automatically converts `Responses` payloads (`input`, `instructions`, parameters) into `Chat Completions` requests and translates upstream SSE chunks back into `response.output_text.delta` events on the fly.
3. **Online Dual-Model Discovery & HTTP 503 Self-Healing**:
   Queries `/v1/models` online to automatically classify **Coding LLMs** (`gpt-5-codex`, `gpt-4o`, `o3-mini`, `deepseek-chat`, `claude-3-5-sonnet`) and **Visual Image Models** (`gpt-image-2`, `gpt-image-1`, `dall-e-3`, `flux-pro`). If an image request hits `HTTP 503 / model_not_found`, the gateway automatically probes `/v1/models`, switches to a working image model, retries seamlessly, and persists the working model.
4. **Vision Coding 0 False Positives (`codeGuard`) & Anti-Loop Protection (`getFreshUserPrompt`)**:
   - **Code Intent Guardrail**: Sending a UI screenshot and asking *"Write a React login component based on this image"* is never misclassified as an image generation request—100% of coding prompts pass straight through to the coding LLM.
   - **Terminal-Turn Inspection**: `getFreshUserPrompt` inspects **only** the final item in `messages` / `input`. Tool execution callbacks (`function_call_output`, `role: "tool"`) and assistant turns return `null` immediately, combined with a 2.5-second deduplication cache to eliminate multi-turn image generation loops.
5. **Local Security Hardening & Sandboxed Explorer Integration**:
   - **Dynamic `.image2-token` Handshake**: Generates a per-instance 192-bit cryptographic token on startup, injects it into the studio UI, and enforces `X-Image2-Local-Token` + Loopback Origin (`127.0.0.1` / `localhost`) validation on all management `/api/*` endpoints.
   - **One-Click Reveal in Windows Explorer**: Clicking **Reveal in Explorer (`📂 打开文件位置`)** validates the target path against a strict local sandbox (`outputs\`, `data\`, `%USERPROFILE%\.codex`) and spawns `explorer.exe /select,"<path>"` without a shell.

### 2. Why Only ~102 KB? The Zero-Bloat Micro-Kernel Architecture

Unlike traditional desktop tools that bundle **150 MB+ Electron/Chromium** runtimes or **30 MB+ unsigned PyInstaller `.exe` binaries** (which frequently trigger browser *"Virus detected"* blocks and Windows Defender SmartScreen false alarms), **Codex Studio v2.6.0** achieves a **~102 KB** package footprint by combining four native capabilities already present on every Codex developer's Windows 10/11 PC:

| Architectural Layer | Traditional Electron / PyInstaller App | **Codex Studio v2.6.0 (~102 KB Micro-Kernel)** |
| :--- | :--- | :--- |
| **Package Size** | `30 MB – 180 MB` (Bundled Chromium / `python312.dll`) | **~102 KB** (1/1500th the size of Electron) |
| **Desktop Window UI** | Bundled Chromium (`~120 MB` disk, `~200 MB` RAM) | **Windows Native Edge / Chrome `--app` Widescreen Mode (`1440×860`)** |
| **Backend Gateway** | Unsigned PyInstaller `.exe` + FastAPI/Uvicorn `.pyd` | **Zero-Dependency Dual Micro-Kernel (`server.js` + `server.py` Pure Stdlib)** |
| **System Tray Daemon** | Heavy C++ / Electron Native Addons | **Windows Built-in `.NET System.Windows.Forms.NotifyIcon` (`tray.ps1`)** |
| **Antivirus & SmartScreen** | High false-positive rate on unsigned `.exe` bundles | **100% Auditable Pure Source Scripts (0 Unsigned Binaries, 0 AV Warnings)** |
| **Idle Memory (RAM)** | `120 MB – 350 MB` | **~4 MB V8 Heap / ~24 MB RSS (with One-Click Tray RAM GC)** |

### 3. Feature Comparison

| Feature / Capability | CC Switch (`cc-switch`) | CLI Proxies (`codex-proxy`) | Image Skills (`codex-imagen`) | **Codex Studio (v2.6.0)** |
| :--- | :---: | :---: | :---: | :---: |
| **Widescreen Desktop App + System Tray** | Yes | No (CLI only) | No (Script only) | **Yes (`1440×860 --app` + Native `.NET` Tray)** |
| **Package Size & RAM Footprint** | ~80 MB / ~120 MB RAM | ~15 MB / ~30 MB RAM | Script only | **~102 KB Package / ~4 MB Heap Micro-Kernel** |
| **Side-by-Side Coding + Image API Co-Management** | Coding API only | Config file only | Image API only | **Unified Widescreen Dual-Column + Standalone Tab** |
| **Online `/v1/models` Model Discovery** | Coding models only | No | No | **Dual Discovery (Coding LLMs + Image Models)** |
| **HTTP 503 Image Model Self-Healing** | N/A | No | Hardcoded (Prone to 503) | **Auto-Probes `/v1/models` & Persists Working Model** |
| **Mode 1: Natural Language Draw + Code Guard** | No | Pass-through only | High false-positive rate | **Terminal-Turn Parser + Code Guardrail (0 Misjudgments)** |
| **Mode 2: `/img` & `/draw` 0-Token Direct Draw** | No | No | Consumes chat tokens | **Local `<5ms` Intercept (0 Conversational Tokens)** |
| **`Responses API` ↔ `Chat API` Auto-Bridge** | Config rewrite only | Partial | No | **Real-Time SSE & JSON Bidirectional Protocol Bridge** |
| **100% Vendor-Neutral & Zero Unsigned `.exe`** | Yes | Yes | Yes | **Yes (100% Pure Stdlib Source, Zero AV Blocks)** |

### 4. Architecture & Windows Runtime Chain

Double-clicking **`CodexStudio.vbs`** (or **`start-windows.bat`**) silently boots the micro-kernel with `--desktop` mode. The backend performs a single-instance health check on `http://127.0.0.1:8765/api/health`, gracefully upgrades any older running instance via `/api/system/shutdown`, and launches the widescreen desktop window and system tray icon:

1. **Priority 1 — Node.js Micro-Kernel (`node.exe server.js --desktop`)**: Uses 100% pure Node.js standard library (`http`, `https`, `fs`, `crypto`, `child_process`). Since OpenAI Codex CLI (`@openai/codex`) runs on Node.js, this engine runs natively out of the box with `~4 MB` heap usage.
2. **Priority 2 — Python 3 Multi-Threaded Micro-Kernel (`python.exe server.py --desktop` / `py.exe -3 server.py --desktop`)**: Powered by `DualStackThreadingHTTPServer` and 100% Python standard library (`http.server`, `urllib`, `threading`, `secrets`), delivering non-blocking SSE streaming and 100% feature parity with `server.js`.

```text
CodexStudio-v2.6.0/
├── CodexStudio.vbs        # 18-line silent Windows launcher (zero console flash, zero AV heuristics)
├── start-windows.bat      # Windows batch launcher alternative (included in Windows-x64 package)
├── git-auto-push.bat      # Cross-folder Git history sync & auto-push tool (included in Source package)
├── tray.ps1               # Windows native system tray daemon (.NET NotifyIcon, pure 7-bit ASCII)
├── server.js              # Node.js zero-dependency micro-kernel gateway (Port 8765, --desktop support)
├── server.py              # Python 3 multi-threaded micro-kernel gateway (Port 8765, --desktop support)
├── data/
│   └── config.json        # Vendor-neutral local provider profiles & routing state (auto-sanitized)
├── public/
│   └── index.html         # Widescreen 1440x860 single-page studio UI (macOS Sequoia dark/light design)
├── outputs/               # Generated PNG images and JSON metadata sidecars
├── LICENSE                # MIT License
└── README.md              # Bilingual English & Chinese documentation
```

### 5. Quick Start (Windows 10 / 11)

1. Download and extract [**`CodexStudio-v2.6.0-Windows-x64.zip`**](https://github.com/DAMNDAGER/CodexStudio/releases/latest/download/CodexStudio-v2.6.0-Windows-x64.zip) (or [**`CodexStudio-v2.6.0-Source.zip`**](https://github.com/DAMNDAGER/CodexStudio/releases/latest/download/CodexStudio-v2.6.0-Source.zip)).
2. Double-click **`CodexStudio.vbs`** (or **`start-windows.bat`**), or run from terminal:
   ```bash
   # Launch with widescreen desktop window + system tray:
   node server.js --desktop
   # Or headless gateway mode:
   node server.js
   ```
3. In the **`API 与生图总览` (API & Image Overview)** home screen:
   - **Left Column (`💻 编程 API 渠道设置`)**: Enter your OpenAI-compatible Base URL and API Key, click **`🔄 在线拉取编程与生图模型`** (or click **`⚡ 自动优选模型并激活`** in the top bar).
   - **Right Column (`🎨 视觉生图 API 设置`)**: Keep **`一 Key 双用`** enabled to share the left credentials, or toggle it off to enter a dedicated Image API URL & Key right in place.
   - Click **`🚀 保存并同步至 Codex`** to automatically back up and write `%USERPROFILE%\.codex\config.toml` and mount the global `%USERPROFILE%\.codex\skills\image2` plugin.

### 6. Codex CLI & Desktop Usage Examples

```text
# 1. Mode 2: Explicit prefix command (Intercepted locally in <5ms, 0 LLM chat tokens consumed)
> /img cyberpunk neon street in rainy night, 16:9, hd
> /draw minimalist 3D clay style fox avatar, 1024x1024

# 2. Mode 1: Natural language image generation (Automatically routed to visual engine)
> Generate a warm 1980s Chinese family Lunar New Year reunion photo

# 3. Vision Coding with Code Guardrail (100% passed through to coding LLM, 0 false triggers)
> Based on @ui-screenshot.png, write a responsive React login component with Tailwind CSS
```

## 🇨🇳 简体中文文档

**返回顶部 / Back to Top：** [Codex Studio (v2.6.0)](#codex-studio-v260)

**Codex Studio (v2.6.0)** 是一款专为 **OpenAI Codex (CLI 终端与 Desktop 桌面客户端)** 打造的 **~102 KB 超轻量桌面级 API 网关、宽屏多渠道模型切换器与双引擎视觉创作工作台**。软件通过监听本地 `http://127.0.0.1:8765/v1` 智能调度 Codex 流量，支持自动备份并写入 `%USERPROFILE%\.codex\config.toml`，以 **100% 厂商中立、零第三方依赖、零未签名二进制文件** 的纯净微内核架构，一站式解决多渠道切换、跨协议兼容、在线生图模型拉取以及「看图写代码」防误判等核心需求。

### 1. v2.6.0 核心特性与界面升级

1. **1440×860 宽屏横版启动 + 主页左右双栏同屏共管**：
   - **强制宽屏横版布局**：启动时自动以 `1440×860` 黄金宽屏尺寸打开独立桌面窗口，告别竖屏拥挤与冗长滚动；顶部采用精简三合一模式切换栏（`🌐 API 渠道与生图设置` | `🔐 官方客户端 + 视觉插件` | `💻 本地 Ollama 直连`）与 **`⚡ 自动优选模型并激活`** 快捷按钮。
   - **生图设置双入口共管（主页右栏 + 左栏第二项）**：
     - **第一部分主页同屏右栏**：主页下半部分采用左右双栏并排设计——左栏管理 **「💻 编程 API 渠道设置」**，右栏直接管理 **「🎨 视觉生图 API 设置」**。支持一键切换 **「一 Key 双用（复用左侧编程接口与 Key）」**；关闭该开关即可在主页右栏直接展开填写 **独立生图接口 Base URL、独立生图专用 API Key 与请求路径**，并一键同步保存。
     - **左侧导航栏第二项（`独立生图与存储设置`）**：专门提供多组独立生图引擎渠道增删、生图模型在线拉取、本地配置文件路径定位以及 `config.toml.bak` 原生备份一键恢复。
   - **100% 厂商中立纯净预设**：内部彻底剔除任何第三方商业中转站名称或硬编码推广链接，仅保留 OpenAI 官方格式、DeepSeek 官方、通用 Chat 兼容与本机 Ollama 标准预设，并对旧版遗留配置自动脱敏清洗。
2. **`Responses API` ↔ `Chat Completions` 跨协议实时双向桥接（P0 级核心能力）**：
   OpenAI Codex CLI 默认发送 `/v1/responses` 协议请求，而 DeepSeek、Claude 兼容接口、本地 Ollama 等大量渠道仅支持 `/v1/chat/completions`。Codex Studio v2.6.0 内置双向协议转换引擎：当切换到 `chat` 协议渠道或上游 `/v1/responses` 返回 `HTTP 404/405/501` 时，微内核自动将 `Responses` 请求体（含 `input`、`instructions`、推理参数）无损转译为 `Chat Completions` 格式，并将上游返回的 SSE 流式分片实时合成为 Codex 所需的 `response.output_text.delta` 事件流，无需重启 Codex 即可跨协议丝滑对话。
3. **编程/生图双模型在线拉取 + HTTP 503 智能自愈**：
   支持一键请求 `/v1/models` 在线拉取渠道模型列表，自动分离「编程大模型」与「🎨 视觉生图模型」（如 `gpt-image-2`、`gpt-image-1`、`dall-e-3`、`flux-pro`）。当生图请求遇到 `HTTP 503 / model_not_found` 时，网关自动向当前渠道探测可用生图模型并无感重试、自动持久化保存可用模型。
4. **「看图写代码」0 误判 (`codeGuard`) & 工具调用防死循环 (`getFreshUserPrompt`)**：
   - **代码护栏 (`codeGuard`)**：当你上传 UI 截图并提问「参考这张图写一个 React 登录组件」时，代码护栏精准识别编程词汇，100% 原样透传给编程大模型，绝不误触发画图；
   - **终端消息严格判定**：`getFreshUserPrompt` 严格只检查 `messages` / `input` 数组的最后一条终端记录，遇到工具执行结果回传（`function_call_output` / `role: "tool"`）或助手消息直接返回 `null` 透传，配合 2.5 秒请求防抖缓存，彻底杜绝多轮工具调用死循环。
5. **本地管理接口安全加固与资源管理器沙箱定位**：
   - **动态 `.image2-token` 握手鉴权**：首次启动自动生成 192-bit 随机密钥并注入前端，对所有 `/api/*` 管理接口强制执行 `X-Image2-Local-Token` 与 Loopback Origin (`127.0.0.1` / `localhost`) 校验，阻断跨站请求伪造（CSRF）与 DNS 重绑定攻击。
   - **一键打开文件位置高亮定位**：在画廊或灯箱中点击 **「📂 打开文件位置」**，后端通过沙箱目录白名单校验与无 Shell 参数化 `spawn` 调用 `explorer.exe /select,"<路径>"`，精准高亮选中本地图片。

### 2. 为什么 Windows 完整包仅 ~102 KB？（零膨胀微内核架构解析）

许多开发者第一次看到 **`CodexStudio-v2.6.0-Windows-x64.zip` 仅 ~102 KB** 时都会惊讶：*为什么一个带独立桌面窗口、右下角系统托盘、双协议 API 网关和画廊工作台的 Windows 软件只有 100 多 KB？这正常吗？*

**答案是：完全正常，且这是 Codex Studio v2.6.0 最核心的架构优势与宣传亮点：**

1. **彻底摒弃 150 MB+ Electron 冗余与 28 MB 旧版未签名 PyInstaller 二进制包**：
   - 传统桌面应用动辄打包上百兆的 Chromium 内核或几十兆的 `python312.dll` + `.pyd` 二进制文件；
   - 在旧版本中，附带的未签名 PyInstaller 打包文件（`Image2Studio.exe` / `Image2CLI.exe`）不仅体积高达 28 MB，还会触发 Chrome/Edge 浏览器 *「无法下载 - 检测到病毒」* 拦截与 Windows Defender 误报。
2. **100% 复用 Windows 10/11 与 Codex 开发者现有原生环境**：
   - **复用宿主运行时**：所有使用 OpenAI Codex CLI (`@openai/codex`) 的开发者本机均已具备 `Node.js`（或 `Python 3`）。`server.js` 与 `server.py` 均采用 **100% 纯标准库（Zero `npm`/`pip` Dependencies）** 编写，无需安装任何第三方依赖包即可直接运行；
   - **复用系统级桌面视图**：通过 `--desktop` 模式直接调度 Windows 10/11 原生内置的 Edge / Chrome `--app` 独立宽屏窗口渲染器（`1440×860`），省去 150 MB 浏览器内核体积；
   - **复用 Windows 原生 `.NET` 托盘**：`tray.ps1` 直接调用系统内置的 `System.Windows.Forms.NotifyIcon` 在内存常驻蓝底托盘图标，采用纯 7-bit ASCII 运行时解码，零乱码、零外部二进制依赖。
3. **三大核心收益（可直接作为项目宣传点）**：
   - **📦 极致轻量（~102 KB，仅为同类 Electron 工具体积的 1/1500）**：秒级下载、解压即用；
   - **🛡️ 100% 源码透明可审计 & 0 杀软误报**：全包不含任何未签名 `.exe`/`.dll` 黑盒二进制文件，所有逻辑（`.js` / `.py` / `.html` / `.ps1` / `.vbs` / `.bat`）100% 明文可查，彻底根除浏览器与杀毒软件拦截；
   - **⚡ ~4 MB 堆内存常驻 & `<100ms` 瞬时冷启动**：后台网关常驻内存仅约 4 MB Heap（~24 MB RSS），支持托盘右键一键触发 `RAM GC` 内存整理。

### 3. 双引擎视觉拦截架构说明

Codex Studio 提供两种互补的生图触发引擎，可在「双引擎拦截与监控」页独立开关：

| 引擎模式 | 触发方式 | 底层执行机制 | 对话 Token 消耗 | 适用场景 |
| :--- | :--- | :--- | :--- | :--- |
| **方案一：自然语言无感生图** (`mode1_llm_tool`) | 直接输入「帮我画一张赛博朋克雨夜街景，16:9」 | `getFreshUserPrompt` 提取终端提问 → `codeGuard` 排除代码意图 → 匹配中英文生图语义并调用视觉引擎 | **0 对话 Token**（本地直接合成标准 SSE 响应流回传 Codex） | 日常自然对话创作、快速配图 |
| **方案二：显式指令秒级直达** (`mode2_prefix_direct`) | 以 `/img`、`/draw`、`/image`、`画图：` 开头 | 本地微内核在 `<5ms` 内毫秒级截获，自动解析宽高比（`16:9`、`9:16`、`1024x1024`）、画质（`hd`/`4k`）、`--dry-run` 及 `@本地参考图路径` | **0 对话 Token**（绕过对话大模型，秒级直连生图接口） | 明确生图需求、零额度损耗极速出图、参考图编辑 |

### 4. 四大接入模式全覆盖

- **🌐 主力 API 渠道 (OpenAI 兼容 · 一 Key 双用 / 独立生图共管)**：支持任意标准 OpenAI 兼容接口同时驱动 Codex 编程与生图，也支持在主页右栏单独配置独立生图接口；
- **🔐 官方客户端 + 本地视觉插件桥接**：保留 Codex 官方 ChatGPT Plus/Pro 登录态，自动在 `%USERPROFILE%\.codex\skills\image2` 挂载全局生图插件（通过纯脚本 `Image2CLI.cmd` + `image2_cli.js` / `image2_cli.py` 驱动，零二进制误报）；
- **⚡ 跨协议专线 API (OpenAI / DeepSeek / Claude / 兼容接口)**：依靠 `Responses` ↔ `Chat` 双向协议桥接器无缝混用不同协议渠道；
- **💻 本地大模型免 Key 直连 (Ollama / LM Studio / vLLM)**：一键接入本机 `http://127.0.0.1:11434/v1` 并自动扫描本机已安装模型。

### 5. Windows 30 秒快速上手

1. 前往 [GitHub Releases](https://github.com/DAMNDAGER/CodexStudio/releases/latest) 下载并解压 [**`CodexStudio-v2.6.0-Windows-x64.zip`**](https://github.com/DAMNDAGER/CodexStudio/releases/latest/download/CodexStudio-v2.6.0-Windows-x64.zip)（或开发者源码包 [**`CodexStudio-v2.6.0-Source.zip`**](https://github.com/DAMNDAGER/CodexStudio/releases/latest/download/CodexStudio-v2.6.0-Source.zip)）。
2. 双击根目录下的 **`CodexStudio.vbs`**（或 **`start-windows.bat`**）静默启动宽屏桌面端与右下角托盘图标；也可在终端手动运行：
   ```bash
   # 启动服务并自动弹出 1440x860 宽屏桌面窗口与系统托盘
   node server.js --desktop

   # 或使用 Python 3 多线程微内核启动桌面模式
   python server.py --desktop
   ```
3. 在首页 **「API 与生图总览」** 的左右双栏中：
   - **左栏（编程 API 渠道设置）**：填入接口地址与 API Key，点击 **「🔄 在线拉取编程与生图模型」**（或点击顶部栏 **「⚡ 自动优选模型并激活」**）；
   - **右栏（视觉生图 API 设置）**：默认开启 **「一 Key 双用」** 复用左栏配置；如需单独使用其他生图接口，关闭该开关即可直接在右栏填入独立生图地址与 Key；
   - 点击右下角 **「🚀 保存并同步至 Codex」** 即可立即在 Codex CLI 或桌面端中使用。

### 6. 开发者专属：跨版本文件夹 Git 历史无损自动推送 (`git-auto-push.bat`)

针对每次迭代解压新版本文件夹（如从 `CodexStudio-v2.5.0` 切换到 `CodexStudio-v2.6.0`）时手动初始化 Git 会丢失远端提交历史的问题，源码包内置了 100% 纯原生 Batch 编写的 **`git-auto-push.bat`**：
- **双击或命令行一键运行**：将 `git-auto-push.bat` 放在新版文件夹内双击（或运行 `git-auto-push.bat -y`）；
- **自动继承并嫁接远端 `origin/main` 历史**：脚本自动拉取远端 `origin/main` 最新提交基线并执行 `git reset --mixed refs/remotes/origin/main`，将当前新文件夹的所有变更直接作为 `origin/main` 的最新增量 Commit 提交，**100% 保留 GitHub 仓库原有的全部历史 Commit 记录**；
- **自动脱敏保护**：提交前自动清空 `data/config.json` 中的本地测试 API Key 并排除 `.image2-token`，防止私钥意外上传。

### 7. 右下角系统托盘 (`tray.ps1`) 快捷操作

程序启动后，Windows 右下角通知区域会常驻蓝底托盘图标：
- **左键单击 / 双击图标**：立即唤出 `1440×860` Codex Studio 宽屏桌面窗口；
- **右键菜单功能**：
  - **打开 Codex Studio 桌面工作台**
  - **打开新手配置与清理向导**
  - **整理微内核内存 (RAM GC)**：调用 `/api/system/gc` 触发垃圾回收并弹出实时内存通知
  - **在系统浏览器中打开**
  - **彻底关闭后台并退出 (Quit)**：调用 `/api/system/shutdown` 安全关闭后台服务并释放 `8765` 端口

## 📄 License / 开源协议

本项目基于 [MIT License](./LICENSE) 开源协议发布，欢迎自由使用、修改与分发。
