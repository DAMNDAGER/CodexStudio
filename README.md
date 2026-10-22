<div align="center">

#  Codex Studio (v2.5.0)

**专为 OpenAI Codex (CLI & Desktop) 打造的超轻量桌面级 API 网关、双引擎视觉拦截与 AI 创作工作台**  
*Ultra-Lightweight Desktop API Gateway, Dual-Engine Visual Bridge & Creative Studio for OpenAI Codex*

[![Version](https://img.shields.io/badge/Version-v2.5.0-0071E3?style=flat-square)](https://github.com/)
[![License](https://img.shields.io/badge/License-MIT-34C759?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-5E5CE6?style=flat-square)](#)
[![Memory](https://img.shields.io/badge/RAM_Footprint-~4MB_Micro--Kernel-BF5AF2?style=flat-square)](#)
[![Zero Dependency](https://img.shields.io/badge/Dependencies-Zero_(Pure_Stdlib)-FF9F0A?style=flat-square)](#)
[![Protocol](https://img.shields.io/badge/Protocol-Responses_API_%26_Chat_Completions-FF375F?style=flat-square)](#)

**[ 🇨🇳 简体中文](#-为什么要做-codex-studio解决-codex-开发者-5-大痛点) &nbsp;|&nbsp; [ 🇺🇸 English Documentation](#-english-documentation) &nbsp;|&nbsp; [ 🚀 30秒快速上手 / Quick Start](#-30-秒快速上手--quick-start)**

---

**「中转站一 Key 双用 + 编程/生图双模型在线拉取 + `/img` 0 Token 秒级生图 + 看图写代码 0 误判 + 照片一键资源管理器定位」**  
*One-Click Relay Setup · Dynamic Model Fetching · `/img` 0-Token Direct Draw · 0 False-Positive Vision Coding · Reveal in Explorer*

</div>

---

## 💡 为什么要做 Codex Studio？（解决 Codex 开发者 5 大痛点）

在使用 **OpenAI Codex CLI / Desktop** 结合第三方 API 中转站（OneAPI / NewAPI）、DeepSeek、Claude、硅基流动（SiliconFlow）或本地 Ollama 时，开发者经常遇到以下棘手痛点：

1. **手动改配置文件极其繁琐**：每次切换中转站或模型，都要去翻找并手动编辑 `~/.codex/config.toml` 和 `auth.json`，格式稍有不慎就报错；
2. **生图模型因渠道分组报 503 (`model_not_found`)**：不同中转站令牌分组支持的视觉模型各不相同（如 `gpt-image-2`、`gpt-image-1`、`flux-pro`、`dall-e-3`），写死模型名极易报 `HTTP 503 No available channel`；
3. **“看图写代码”与“画图”冲突误判 & 工具循环重发**：传统生图插件常把「参考这张 UI 截图写个 React 组件」误判为画图请求，白白浪费额度；或者在工具执行回传阶段（`function_call_output`）陷入重复发送请求的死循环；
4. **生成的照片找不到物理路径**：AI 画完图后保存在深层目录，想发给队友或拖进项目里得翻半天文件夹；
5. **缺少常驻托盘与优雅管理**：关掉窗口后后台进程无法唤回，端口被占用无法重启，缺少可视化的托盘控制与内存整理。

**Codex Studio** 将 **「类 CC Switch 的多渠道模型调度器」+「双引擎视觉拦截网关」+「Apple macOS Sequoia 风格独立桌面工作台」** 三合一，常驻内存仅 **~4MB**，真正实现**零依赖、免安装、双击即用**。

---

## 🏆 与同类开源项目横向对比 (Comparison)

| 核心能力 / Feature | CC Switch (`cc-switch`) | 传统代理 (`codex-proxy`) | 传统生图插件 (`codex-imagen`) | ** Codex Studio (本项目)** |
| :--- | :---: | :---: | :---: | :---: |
| **独立桌面软件窗口 + 右下角系统托盘** | ✅ 拥有 | ❌ 仅命令行 | ❌ 仅脚本 | **✅ Sequoia 独立窗口 + 原生托盘常驻** |
| **中转站编程模型在线拉取 (`/v1/models`)** | ✅ 拥有 | ❌ 手写配置 | ❌ 无 | **✅ 一键在线拉取并按常用度智能排序** |
| **生图引擎在线拉取模型 + 503 自动自愈** | ❌ 不支持生图 | ❌ 无 | ❌ 写死模型易报 503 | **✅ 分类下拉选取 + 503 自动探测回退** |
| **方案一：自然语言生图 + 看图写代码 0 误判** | ❌ 无 | ⚠️ 仅透传 | ❌ 极易误触发 | **✅ 终端消息精准判定 + 代码护栏** |
| **方案二：`/img` 显式指令 0 Token 秒生图** | ❌ 无 | ❌ 无 | ❌ 消耗对话 Token | **✅ 本地微内核毫秒级截获 (0 对话 Token)** |
| **多轮工具调用防死循环 (`getFreshUserPrompt`)** | ⚠️ 无视觉拦截 | ✅ 正常 | ❌ 易循环重发 | **✅ 严格区分用户新提问与工具回调** |
| **已生成照片一键打开资源管理器高亮定位** | ❌ 无 | ❌ 无 | ❌ 仅返回文本路径 | **✅ 一键 `explorer /select` 高亮选中照片** |
| **零环境免安装开箱即用** | 需安装运行库 | 需编译环境 | 需预装依赖 | **✅ Windows 免安装版 + 0 依赖双微内核** |

---

## ✨ 核心功能亮点 (Key Highlights)

### 1. 四大渠道模式 +「一 Key 双用」编程/生图双模型在线拉取
* **聚合中转站 (OneAPI / NewAPI / 通用中继)**：填入中转站 `Base URL` 与 `sk-...` 令牌，点击 **「🔄 在线拉取模型列表」**，自动拉取并分类展示 **「主力编程大模型」** 与 **「🎨 识别到的视觉生图模型」**；
* **HTTP 503 智能自愈回退 (Auto-Healing Fallback)**：当指定的生图模型在当前中转分组不可用（返回 `HTTP 503 model_not_found`）时，微内核自动向 `/v1/models` 嗅探当前分组支持的生图模型（如 `gpt-image-2`、`gpt-image-1`、`flux-pro`）并无感重试、自动保存；
* **全生态兼容**：支持 **官方账号 + 本地全局 `image2` Skill 混合模式**、**OpenAI / DeepSeek / 硅基流动 (SiliconFlow) / Claude 专线** 以及 **本地 Ollama / vLLM / LM Studio 一键免 Key 接入**；
* **原生双协议支持**：完美支持 OpenAI Codex 官方原生 **Responses API (`wire_api = "responses"`)** 与通用 **Chat Completions (`wire_api = "chat"`)**。

### 2. 双引擎视觉拦截架构（彻底告别看图写代码误判与死循环）
* **方案一（自然语言生图意图识别）**：直接对 Codex 说 `生成一张20世纪80年代中国家庭春节全家福`，网关自动调拨生图引擎；当说 `参考这张设计图帮我写一个 React 登录组件` 时，代码护栏生效，100% 透传给编程大模型写代码；
* **方案二（`/img`、`/draw`、`/image`、`画图:` 显式直达）**：输入 `/img 赛博朋克雨夜霓虹街道 16:9`，本地网关在进门瞬间毫秒级截获出图，**0 额外对话 Token 消耗**；
* **终端消息精准判定 (`getFreshUserPrompt`)**：严格逆序解析消息栈，仅在用户发起的新提问回合触发拦截；遇到工具执行输出（`function_call_output` / `role: tool`）时 **100% 透明透传**，彻底根除多轮工具调用时的循环重发问题。

### 3. 照片一键资源管理器定位 + 高清原图复制剪贴板
* 在 **AI 视觉工坊**、**本地作品画廊卡片**、**全屏大图灯箱 (Lightbox)** 中：
  * 点击 **「📂 打开文件位置」**：直接呼出 Windows 资源管理器并**自动高亮选中该张照片**（基于反斜杠规范化的 `explorer.exe /select,"<path>"`）；
  * 点击 **「🖼️ 复制图片」**：直接将高清 PNG 原图写入系统剪贴板，可在微信、飞书、Discord、B站或文档中直接 `Ctrl+V` 粘贴。

### 4. 透明本地存储看板 + 安全配置预设导出与导入
* **四大存储路径一键直达**：直观展示本地配置文件 (`data/config.json`)、作品目录 (`outputs/`)、Codex 核心配置 (`~/.codex/config.toml`) 与全局视觉 Skill (`~/.codex/skills/image2`) 的实时状态，每一行均支持一键打开对应文件夹；
* **零泄漏配置分享**：支持 **「📤 导出配置预设」**（自动剥离全部 API Key）与 **「📥 导入配置预设」**（自动保留本地既有密钥），方便在 GitHub Issue、社区或团队间安全共享中转站模板。

---

## 🚀 30 秒快速上手 / Quick Start

### 方式 A：Windows 独立免安装完整版（推荐普通用户，零环境要求）
1. 前往 [**Releases 页面**](../../releases) 下载最新的 **`CodexStudio-v2.5.0-Windows-x64.zip`** 并解压；
2. 直接双击根目录下的 **`CodexStudio.vbs`**（零黑框秒开独立软件窗口，并在桌面右下角自动生成蓝底 `C` 字系统托盘图标）；
3. 首次启动会自动弹出 **3 步新手教学与配置向导**：
   * **Step 1**：填入中转站地址（如 `https://your-relay.com/v1`）与 API Key，点击「🔄 在线拉取模型列表」选定编程模型与生图模型；
   * **Step 2**：确认开启「双引擎拦截（方案 1+2 双开）」；
   * **Step 3**：点击 **「🚀 一键保存并激活 Codex」**，自动写入 `~/.codex/config.toml` 并挂载全局 `image2` 视觉插件！

### 方式 B：跨平台源码版启动（macOS / Linux / Windows 开发者）
本项目采用**零外部依赖（Zero-Dependency）**设计，提供 100% 接口等价的 **Node.js** 与 **Python 3** 双微内核，无需执行 `npm install` 或 `pip install`：

```bash
# 克隆仓库
git clone https://github.com/<your-username>/CodexStudio.git
cd CodexStudio

# 任选其一启动（常驻内存仅 ~4MB）：
node server.js
# 或者使用 Python 3：
python3 server.py
```
启动后在浏览器访问 `http://127.0.0.1:8765` 即可打开工作台（Windows 下也可直接双击 `CodexStudio.vbs` 自动调用本机 Node/Python 并启动托盘）。

---

## 💻 Codex 终端实战指令示例 (Terminal Usage Examples)

```text
# 1. 【方案二】0 Token 毫秒级显式生图（绕过对话大模型，直接调用生图引擎）：
> /img 赛博朋克风格的雨夜霓虹街道，16:9 宽屏壁纸
> /draw 生成一张极简苹果风格的 3D 玻璃拟态狐狸图标

# 2. 【方案一】自然语言随口画图（智能语义识别）：
> 帮我生成一张中国20世纪80年代春节团聚的怀旧全家福

# 3. 【代码护栏】看图写代码（100% 正常输出代码，绝不误触生图）：
> 参考 @ui-design.png 帮我写一个带深色模式的 React 登录组件
```

---

<br>

# 🇺🇸 English Documentation

**Codex Studio** is an ultra-lightweight (~4MB RAM), zero-dependency desktop API gateway, model switcher (inspired by *CC Switch*), dual-engine visual interceptor, and Apple macOS Sequoia-styled creative studio purpose-built for **OpenAI Codex (CLI & Desktop App)**.

### 💡 Why Codex Studio? (Solving 5 Major Pain Points)
1. **Effortless Relay & Provider Switching**: Stop editing `~/.codex/config.toml` and `auth.json` by hand. Switch between **OneAPI / NewAPI relays**, **OpenAI Official**, **DeepSeek**, **Claude**, **SiliconFlow**, and local **Ollama / vLLM** in one click.
2. **Dynamic Model Fetching & HTTP 503 Auto-Healing**: Fetch available coding and image models directly from your relay's `/v1/models` endpoint. If an image model returns `HTTP 503 model_not_found`, Codex Studio automatically probes your relay for supported visual models (`gpt-image-2`, `gpt-image-1`, `flux-pro`, `dall-e-3`) and retries seamlessly.
3. **Zero False Positives on Vision Coding & Anti-Loop Guard**:
   * **Mode 1 (Semantic Intent + Code Guardrail)**: Natural language image requests trigger image generation, while *"Write React code based on this screenshot"* passes straight through to the coding LLM with **0% false positives**.
   * **Mode 2 (`/img`, `/draw`, `/image` Direct Prefix)**: Intercepted locally in `<5ms` with **0 conversational LLM tokens consumed**.
   * **Terminal Message Anti-Loop (`getFreshUserPrompt`)**: Strictly inspects the latest turn in the message stack. Tool outputs (`function_call_output` / `role: tool`) are 100% transparently passed through, completely eliminating infinite tool-call loops.
4. **One-Click Reveal in File Explorer & Native Clipboard Copy**: Click **"📂 Reveal in Explorer"** on any generated photo in the studio or gallery to launch Windows Explorer with the exact file highlighted (`explorer.exe /select`), or copy the raw HD PNG directly to your system clipboard.
5. **Zero-Leak Config Preset Sharing**: Export your provider configurations with API keys automatically stripped for safe sharing in GitHub Issues or teams, and import presets without overwriting your local keys.

### 📁 Project Structure

```text
CodexStudio/
├── CodexStudio.vbs        # Windows native 0-console launcher (Pure 7-bit ASCII, 4-stage runtime detection)
├── tray.ps1               # Windows native system tray daemon (Single-click restore, RAM GC, safe exit)
├── server.js              # Node.js zero-dependency micro-kernel (~4MB RAM, Responses & Chat API proxy)
├── server.py              # Python 3 zero-dependency micro-kernel (100% API-identical to server.js)
├── data/
│   └── config.json        # Local provider, routing, and onboarding state configuration
├── public/
│   └── index.html         # Apple macOS Sequoia HIG single-page desktop studio UI
├── outputs/               # Generated artworks and JSON metadata storage
├── LICENSE                # MIT License
└── README.md              # Bilingual documentation (CN / EN)
```

---

## 📄 License / 开源协议

Released under the [MIT License](./LICENSE). Free for personal and commercial use.  
本项目基于 [MIT License](./LICENSE) 开源。如果这个小工具对你的开发效率有帮助，欢迎点亮右上角的 ⭐ **Star** 支持！
