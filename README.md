# Codex Studio (v2.5.0)

**Windows Native Desktop API Gateway, Model Switcher & Dual-Engine Visual Studio for OpenAI Codex**  
**专为 Windows 10/11 打造的 OpenAI Codex 桌面级 API 网关、中转站模型调度器与双引擎视觉工作台**

> **Platform**: Windows 10 / Windows 11 (x64) | **License**: MIT | **Local Gateway**: `http://127.0.0.1:8765/v1` | **Dependencies**: Zero (`node.exe` / `python.exe` / Standalone `Image2Studio.exe`)

**[ 🇺🇸 English Documentation ](#english-documentation) &nbsp;|&nbsp; [ 🇨🇳 简体中文文档 ](#chinese-documentation)**

---

## English Documentation

**Codex Studio** is a Windows-native desktop companion utility for **OpenAI Codex (CLI & Desktop App)**. It runs a local API gateway on `http://127.0.0.1:8765/v1` that manages `%USERPROFILE%\.codex\config.toml`, dynamically fetches coding and image models from third-party API relays, and bridges image generation into Codex without breaking vision-based coding tasks.

### 1. Core Problems Solved

1. **Manual `config.toml` Editing**: Switching between OneAPI / NewAPI relays, OpenAI Official, DeepSeek, Claude, SiliconFlow, or local Ollama normally requires manual edits to `%USERPROFILE%\.codex\config.toml` and `auth.json`. Codex Studio updates and backs up (`config.toml.bak`) these files in one click.
2. **Relay Image Model `HTTP 503` Errors**: Different API relay token groups expose different image models (`gpt-image-2`, `gpt-image-1`, `dall-e-3`, `flux-pro`). Hardcoding `dall-e-3` often causes `HTTP 503 model_not_found / No available channel`. Codex Studio fetches `/v1/models` to list available image models and automatically falls back to a supported model if a `503` occurs.
3. **Vision Coding False Positives & Infinite Tool Loops**:
   * Sending a UI screenshot and asking *"Write a React component based on this image"* can be misclassified by naive regex plugins as an image generation request.
   * When Codex returns tool execution outputs (`function_call_output` / `role: "tool"`), naive interceptors re-trigger on historical user messages and enter an infinite loop.
   * Codex Studio's `getFreshUserPrompt` parser strictly checks only the latest message in the array, ignores tool output turns (`100%` pass-through), applies a code-intent guardrail, and enforces a 2.5-second duplicate-request debounce.
4. **Locating Generated Images on Windows**: Generated PNG files are saved to the local `outputs\` directory. Clicking **Reveal in Explorer (`📂 打开文件位置`)** calls `explorer.exe /select,"<winPath>"` to open Windows File Explorer with the exact photo highlighted.
5. **Background Process & System Tray Management**: Launching via `CodexStudio.vbs` starts the backend silently (zero `cmd.exe` black window), opens a frameless desktop window via Edge/Chrome `--app` mode, and places a native `.NET NotifyIcon` (`tray.ps1`) in the Windows system tray.

---

### 2. Feature Comparison

| Feature | CC Switch (`cc-switch`) | CLI Proxies (`codex-proxy`) | Image Skills (`codex-imagen`) | **Codex Studio (This Project)** |
| :--- | :---: | :---: | :---: | :---: |
| **Target OS** | Cross-platform | CLI only | CLI only | **Windows 10 / 11 (x64) Native** |
| **Frameless Desktop Window & Windows Tray** | Yes | No | No | **Yes (`--app` Window + `tray.ps1` NotifyIcon)** |
| **Dynamic `/v1/models` Fetching** | Coding models only | No | No | **Both Coding LLMs & Image Models** |
| **HTTP 503 Image Model Auto-Fallback** | N/A | No | No | **Auto-probes `/v1/models` & retries** |
| **Mode 1: Natural Language Draw + Code Guardrail** | No | Pass-through only | High false positives | **Yes (0 false positives on screenshot coding)** |
| **Mode 2: `/img` & `/draw` 0-Token Direct Draw** | No | No | Uses LLM tokens | **Yes (Local intercept in `<5ms`, 0 LLM tokens)** |
| **Tool-Call Anti-Loop (`getFreshUserPrompt`)** | N/A | Yes | Prone to loops | **Yes (Strict `function_call_output` pass-through)** |
| **One-Click `explorer.exe /select` File Highlight** | No | No | Text path only | **Yes (Studio Canvas, Gallery & Lightbox)** |

---

### 3. Windows Architecture & Runtime Priority

When you double-click **`CodexStudio.vbs`** on Windows, it performs a pre-flight check on `http://127.0.0.1:8765/api/health`, cleans up any stale process holding port `8765`, and starts the local gateway using a 4-stage detection chain:

1. **Priority 1 — Node.js Micro-Kernel (`node.exe server.js`)**: Zero `npm` dependencies, uses standard library `http`/`https`/`fs`/`crypto`/`child_process`, ~4 MB heap usage.
2. **Priority 2 — Python 3 Executable (`python.exe server.py`)**: Zero `pip` dependencies, 100% API-identical to `server.js` (verifies real Python vs. Windows Store 0-byte stub).
3. **Priority 3 — Windows Python Launcher (`py.exe -3 server.py`)**: Uses the official Windows Python launcher if installed.
4. **Priority 4 — Standalone Windows Runtime (`Image2Studio\Image2Studio.exe`)**: Bundled in `CodexStudio-v2.5.0-Windows-x64.zip` so users without Node.js or Python installed can run out of the box.

---

### 4. Quick Start (Windows 10 / 11)

#### Option A: Windows Portable Full Package (`CodexStudio-v2.5.0-Windows-x64.zip`)
*Requires **no** Node.js or Python installation.*
1. Download and extract `CodexStudio-v2.5.0-Windows-x64.zip`.
2. Double-click **`CodexStudio.vbs`**.
3. Follow the 3-step Onboarding Wizard:
   * **Step 1**: Choose your connection mode (Relay API, Official Hybrid, Direct API, or Local Ollama), enter your Base URL and API Key, and click **Fetch Models (`🔄 在线拉取模型列表`)** to select your coding model and image model.
   * **Step 2**: Keep Dual-Engine Interception (**Mode 1 + Mode 2**) enabled.
   * **Step 3**: Click **Apply & Activate Codex (`🚀 一键保存并激活 Codex`)** to write `%USERPROFILE%\.codex\config.toml` and install the global `%USERPROFILE%\.codex\skills\image2` skill.

#### Option B: Lightweight Source Package (`CodexStudio-v2.5.0-Source.zip`)
*For Windows developers who already have Node.js or Python 3 installed.*
1. Extract `CodexStudio-v2.5.0-Source.zip` (or clone this repository).
2. Double-click **`CodexStudio.vbs`** (or run `node server.js` / `python server.py` in PowerShell/CMD and open `http://127.0.0.1:8765`).

---

### 5. Codex Terminal Usage Examples

Once synced to `%USERPROFILE%\.codex\config.toml`, use Codex normally in your terminal or IDE:

```text
# 1. Mode 2: Explicit prefix command (Intercepted locally, 0 conversational LLM tokens used)
> /img cyberpunk neon street in rainy night, 16:9
> /draw minimalist 3D clay style fox icon, 1024x1024

# 2. Mode 1: Natural language image request (Routed to image generation engine)
> Generate a nostalgic 1980s Chinese family Lunar New Year reunion photo

# 3. Code Guardrail: Vision coding with screenshot (100% passed through to coding LLM)
> Based on @ui-screenshot.png, write a responsive React login component with Tailwind CSS
```

---

### 6. Project Directory Structure

```text
CodexStudio/
├── CodexStudio.vbs        # Windows native zero-console launcher (Pure 7-bit ASCII)
├── tray.ps1               # Windows native system tray daemon (.NET System.Windows.Forms)
├── server.js              # Node.js zero-dependency micro-kernel gateway (Port 8765)
├── server.py              # Python 3 zero-dependency micro-kernel gateway (Port 8765)
├── data/
│   └── config.json        # Local provider, routing, and onboarding configuration
├── public/
│   └── index.html         # Single-page desktop studio UI (macOS Sequoia dark/light theme)
├── outputs/               # Generated PNG images and JSON metadata sidecars
├── LICENSE                # MIT License
└── README.md              # English & Chinese documentation
```

---
---

## Chinese Documentation

**[ ⬆️ Back to Top / 返回顶部 ](#codex-studio-v250)**

**Codex Studio** 是一款专为 **Windows 10 / Windows 11 (x64)** 平台打造的 **OpenAI Codex (CLI & 桌面端)** 本地 API 网关、多渠道模型切换器与双引擎视觉创作工作台。软件通过监听本地 `http://127.0.0.1:8765/v1` 接管 Codex 请求，支持一键写入 `%USERPROFILE%\.codex\config.toml`，并彻底解决中转站生图报错、看图写代码误判及工具调用死循环问题。

### 1. 解决的 5 大真实痛点

1. **告别手动修改 `config.toml`**：切换 OneAPI / NewAPI 聚合中转站、OpenAI 官方、DeepSeek、Claude、硅基流动（SiliconFlow）或本地 Ollama 时，无需再手动编辑 `%USERPROFILE%\.codex\config.toml` 和 `auth.json`，一键点击即可自动备份（`config.toml.bak`）并写入配置。
2. **中转站生图模型在线拉取与 HTTP 503 自动回退自愈**：不同中转站的令牌分组支持的生图模型不同（如 `gpt-image-2`、`gpt-image-1`、`dall-e-3`、`flux-pro`）。点击 **「🔄 在线拉取模型列表」** 可同时拉取并分类展示「主力编程大模型」与「🎨 识别到的视觉生图模型」；若当前生图模型返回 `HTTP 503 model_not_found / No available channel`，微内核会自动向 `/v1/models` 探测可用生图模型并无感重试、自动保存。
3. **看图写代码 0 误判 & 工具调用防死循环 (`getFreshUserPrompt`)**：
   * **代码护栏**：发送 UI 截图并输入「参考这张图写一个 React 组件」时，代码护栏生效，100% 透传给编程大模型输出代码，绝不误触发画图；
   * **防死循环重发**：严格检查消息数组（`messages` / `input`）的最后一条记录。当检测到工具执行回调（`type === "function_call_output"` 或 `role === "tool"`）时，直接返回 `null` 并 100% 原样透传给上游大模型，配合 2.5 秒重复指令防抖，彻底杜绝多轮工具调用时的循环重发问题。
4. **已生成照片一键打开 Windows 资源管理器定位**：所有生成的图片均保存在本地 `outputs\` 目录。在视觉工坊、作品画廊卡片或全屏灯箱中点击 **「📂 打开文件位置」**，后端会自动将路径规范化为 Windows 反斜杠格式并调用 `explorer.exe /select,"<物理路径>"`，直接弹出资源管理器并高亮选中该张照片；点击 **「🖼️ 复制图片」** 可将高清 PNG 原图直接写入系统剪贴板。
5. **Windows 原生零黑框启动与右下角托盘常驻**：双击 `CodexStudio.vbs` 即可静默拉起后台服务，通过 Edge / Chrome 的 `--app` 模式打开无地址栏的独立桌面窗口，并在任务栏右下角驻留蓝底 `C` 字系统托盘图标（`tray.ps1`）。

---

### 2. 四大接入模式与核心功能

* **⚡ 聚合中转站 (OneAPI / NewAPI · 一 Key 双用)**：同一个中转站 API Key 与 Base URL 同时驱动 Codex 编程与视觉生图，支持 OpenAI 原生 `Responses API` (`wire_api = "responses"`) 与通用 `Chat Completions` (`wire_api = "chat"`) 协议；
* **🛡️ 官方账号 + 本地混合生图**：保留 Codex 官方 Plus/Pro 网页登录态，同时自动在 `%USERPROFILE%\.codex\skills\image2` 挂载全局生图 Skill；
* **🌐 官方 / 专线 API (OpenAI / DeepSeek / Claude / 硅基流动)**：内置快捷地址胶囊与常用模型预设；
* **💻 本地大模型 (Ollama / vLLM / LM Studio)**：一键免 Key 接入本机 `http://127.0.0.1:11434/v1`；
* **🗄️ 本地存储透明看板 & 无泄漏配置导出/导入**：在设置页实时展示 `data\config.json`、`outputs\`、`%USERPROFILE%\.codex\config.toml`、`%USERPROFILE%\.codex\skills\image2` 四大路径状态，每一行均可点击 **「📂 打开位置」** 直达文件夹；支持一键导出自动剥离了 API Key 的配置预设 JSON，以及保留本地既有密钥的安全导入。

---

### 3. Windows 平台快速上手

#### 方式一：下载 Windows 免安装完整版 (`CodexStudio-v2.5.0-Windows-x64.zip`)
*内置独立运行环境（含 `Image2Studio\Image2Studio.exe`），电脑无需安装 Node.js 或 Python。*
1. 在 GitHub Releases 下载 **`CodexStudio-v2.5.0-Windows-x64.zip`** 并解压到任意英文或中文路径；
2. 双击根目录下的 **`CodexStudio.vbs`**；
3. 在自动弹出的 **3 步新手向导** 中填入中转站地址与 API Key -> 点击「🔄 在线拉取模型列表」选择编程与生图模型 -> 点击 **「🚀 一键保存并激活 Codex」** 即可开始使用。

#### 方式二：下载轻量纯源码包 (`CodexStudio-v2.5.0-Source.zip`)
*仅 87 KB，适合电脑上已安装 Node.js 或 Python 3 的 Windows 开发者。*
1. 解压 `CodexStudio-v2.5.0-Source.zip`；
2. 直接双击 **`CodexStudio.vbs`**（脚本会自动检测本机 `node.exe` 或 `python.exe` 并在后台静默拉起 `server.js` / `server.py`，同时启动右下角托盘与独立桌面窗口）。

---

### 4. Windows 右下角系统托盘 (`tray.ps1`) 操作说明

启动后，Windows 任务栏右下角通知区域会出现蓝底 `C` 字图标：
* **左键单击 / 双击图标**：立即重新呼出 Codex Studio 独立桌面软件窗口；
* **右键菜单**：
  * **打开 Codex Studio 桌面工作台**
  * **打开新手配置与清理向导**
  * **整理微内核内存 (RAM GC)**：调用 `/api/system/gc` 释放内存并弹出通知提示
  * **在系统浏览器中打开**
  * **彻底关闭后台并退出 (Quit)**：安全关闭后台守护进程并释放 `8765` 端口

---

## License

Released under the MIT License. See the `LICENSE` file in the root directory for details.
