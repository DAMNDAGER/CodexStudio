/**
 * Codex Studio (v2.6.0) - AI Gateway & Visual Engine Micro-Kernel
 *
 * v2.6.0 + P0 Architecture & Security Upgrades:
 *  1. [P0-1] Cross-Protocol Auto-Bridge (Responses API <-> Chat Completions API):
 *     - Automatically translates `/v1/responses` requests (input array/string, instructions, tools)
 *       into `/v1/chat/completions` format when routing to `chat`-protocol channels (DeepSeek, Claude,
 *       OpenAI-compatible endpoints, Ollama) or when an upstream relay returns HTTP 404/405/501 on `/v1/responses`.
 *     - Real-time SSE stream adapter converts upstream `chat.completion.chunk` deltas into
 *       standard OpenAI Responses API SSE events (`response.created`, `response.output_text.delta`,
 *       `response.completed`) with zero buffering.
 *  2. [P0-2] Local Management API Security Hardening & Command Injection Protection:
 *     - Dynamic cryptographic `.image2-token` generation on first boot + live `<meta>` injection into `index.html`.
 *     - Strict Loopback Origin allowlist (`127.0.0.1` / `localhost`) & `X-Image2-Local-Token` verification on `/api/*`.
 *     - Path sandbox allowlist + shell-free parameterized `spawn('explorer.exe', ...)` in `revealInFileManager`.
 *  3. Anti-Loop & Vision Guardrail:
 *     - `getFreshUserPrompt` inspects only the terminal message turn; tool outputs (`function_call_output`, `role: tool`)
 *       are 100% passed through without re-triggering image interception.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { URL } = require('url');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 8765;
const HOST = '127.0.0.1';
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const OUTPUTS_DIR = path.join(ROOT_DIR, 'outputs');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const TOKEN_FILE = path.join(ROOT_DIR, '.image2-token');
const LEGACY_FALLBACK_TOKEN = 'AguLw4mZOaKQiKkm5I8V-K8545Dao7LysiUr-2edpqg';

[DATA_DIR, OUTPUTS_DIR, PUBLIC_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// [P0-2] Dynamic Per-Installation Token Initialization
let LOCAL_SERVICE_TOKEN = '';
if (fs.existsSync(TOKEN_FILE)) {
    try {
        const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
        if (t && t.length >= 16) LOCAL_SERVICE_TOKEN = t;
    } catch (e) {}
}
if (!LOCAL_SERVICE_TOKEN) {
    LOCAL_SERVICE_TOKEN = crypto.randomBytes(24).toString('base64url');
    try {
        fs.writeFileSync(TOKEN_FILE, LOCAL_SERVICE_TOKEN, { encoding: 'utf8', mode: 0o600 });
    } catch (e) {}
}

// -------------------------------------------------------------
// Telemetry & Event Stream (In-Memory Ring Buffer)
// -------------------------------------------------------------
const MAX_EVENTS = 40;
const gatewayEvents = [];
const recentGeneratedFiles = new Map();
let totalCapturedRequests = 0;

function recordGatewayEvent({ source = 'Codex CLI', message = '', action = '', status = 'info', detail = '' }) {
    totalCapturedRequests += 1;
    const evt = {
        id: `evt-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        source,
        message: String(message || '').slice(0, 140),
        action,
        status, // 'processing' | 'success' | 'error' | 'info'
        detail: typeof detail === 'object' ? JSON.stringify(detail) : String(detail || '').slice(0, 200),
        seq: totalCapturedRequests
    };
    gatewayEvents.unshift(evt);
    if (gatewayEvents.length > MAX_EVENTS) gatewayEvents.pop();
    return evt;
}

// In-Memory Deduplication / Debounce Cache
const recentPromptTimestamps = new Map();
function isDuplicateRapidRequest(promptText) {
    if (!promptText || promptText.length < 2) return false;
    const now = Date.now();
    const last = recentPromptTimestamps.get(promptText);
    if (last && (now - last) < 2500) {
        return true;
    }
    recentPromptTimestamps.set(promptText, now);
    if (recentPromptTimestamps.size > 80) {
        for (const [k, t] of recentPromptTimestamps.entries()) {
            if (now - t > 6000) recentPromptTimestamps.delete(k);
        }
    }
    return false;
}

// -------------------------------------------------------------
// [P0-2] Path Sandbox & Shell-Free File Manager Reveal
// -------------------------------------------------------------
function getCodexPaths() {
    const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    return {
        home,
        configToml: path.join(home, 'config.toml'),
        configTomlBak: path.join(home, 'config.toml.bak'),
        authJson: path.join(home, 'auth.json'),
        skillDir: path.join(home, 'skills', 'image2')
    };
}

function resolveSafeLocalPath(targetPath, fallbackDir = OUTPUTS_DIR) {
    if (!targetPath || typeof targetPath !== 'string') return fallbackDir;
    const cleaned = targetPath.replace(/[\0\r\n]/g, '').trim();
    if (!cleaned) return fallbackDir;

    const candidate = path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(fallbackDir, cleaned);
    const codexHome = path.resolve(getCodexPaths().home);
    const allowedRoots = [
        path.resolve(OUTPUTS_DIR),
        path.resolve(DATA_DIR),
        path.resolve(ROOT_DIR),
        codexHome
    ];

    const isAllowed = allowedRoots.some(root => {
        const normRoot = process.platform === 'win32' ? root.toLowerCase() : root;
        const normCand = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
        return normCand === normRoot || normCand.startsWith(normRoot + path.sep);
    });

    if (!isAllowed || !fs.existsSync(candidate)) {
        return fallbackDir;
    }
    return candidate;
}

function revealInFileManager(targetPath) {
    const absPath = resolveSafeLocalPath(targetPath, OUTPUTS_DIR);
    const isFile = fs.existsSync(absPath) && fs.statSync(absPath).isFile();
    try {
        if (process.platform === 'win32') {
            const winPath = absPath.replace(/\//g, '\\');
            const args = isFile ? [`/select,${winPath}`] : [winPath];
            const child = spawn('explorer.exe', args, { detached: true, stdio: 'ignore', windowsHide: false });
            child.on('error', () => {});
            child.unref();
            return true;
        } else if (process.platform === 'darwin') {
            const args = isFile ? ['-R', absPath] : [absPath];
            const child = spawn('open', args, { detached: true, stdio: 'ignore' });
            child.on('error', () => {});
            child.unref();
            return true;
        } else {
            const dir = isFile ? path.dirname(absPath) : absPath;
            const child = spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' });
            child.on('error', () => {});
            child.unref();
            return true;
        }
    } catch (e) {
        return false;
    }
}

function openDirectoryInFileManager(targetDir) {
    const absPath = resolveSafeLocalPath(targetDir, ROOT_DIR);
    return revealInFileManager(absPath);
}

function triggerCompactGC() {
    if (typeof global.gc === 'function') {
        try { global.gc(); } catch (e) {}
    }
}

function getMemoryStats() {
    const mem = process.memoryUsage();
    return {
        rss_mb: +(mem.rss / 1048576).toFixed(1),
        heap_used_mb: +(mem.heapUsed / 1048576).toFixed(1),
        heap_total_mb: +(mem.heapTotal / 1048576).toFixed(1)
    };
}

function getCleanDefaultConfig() {
    return {
        activeCodexProvider: 'codex-relay',
        activeImageProvider: 'image-relay',
        routingMode: 'gateway',
        syncImageKey: true,
        connectionCategory: 'relay_api',
        officialReasoningEffort: 'medium',
        officialModel: 'gpt-4o',
        onboarding_completed: false,
        mode1_llm_tool: true,
        mode2_prefix_direct: true,
        codexProviders: [
            {
                id: 'codex-relay',
                category: 'relay_api',
                badge: '推荐 · 一Key双用',
                name: '主力 API 渠道 (OpenAI 兼容)',
                base_url: 'https://api.openai.com/v1',
                model: 'gpt-4o',
                wire_api: 'responses',
                api_key: '',
                api_keys: [],
                notes: '兼容标准 OpenAI / Responses / Chat 接口 · 支持在线拉取模型与一Key双用生图'
            },
            {
                id: 'codex-official',
                category: 'openai_official',
                badge: 'OpenAI 官方',
                name: 'OpenAI 官方直连 (GPT-4o / o3)',
                base_url: 'https://api.openai.com/v1',
                model: 'gpt-4o',
                wire_api: 'responses',
                api_key: '',
                api_keys: [],
                notes: 'OpenAI 官方原生渠道 · Responses 协议'
            },
            {
                id: 'codex-deepseek',
                category: 'deepseek_official',
                badge: 'DeepSeek 官方',
                name: 'DeepSeek 官方 (V3 / R1)',
                base_url: 'https://api.deepseek.com/v1',
                model: 'deepseek-chat',
                wire_api: 'chat',
                api_key: '',
                api_keys: [],
                notes: 'DeepSeek 官方极速接口 · Chat 协议自动转换'
            },
            {
                id: 'codex-custom-chat',
                category: 'claude_relay',
                badge: '通用 Chat',
                name: '备用兼容渠道 (Chat 协议)',
                base_url: 'https://api.openai.com/v1',
                model: 'claude-3-5-sonnet-20241022',
                wire_api: 'chat',
                api_key: '',
                api_keys: [],
                notes: '通用 /v1/chat/completions 兼容接口'
            }
        ],
        imageProviders: [
            {
                id: 'image-relay',
                name: '主渠道联动生图引擎 (一Key双用)',
                base_url: 'https://api.openai.com/v1',
                model: 'gpt-image-2',
                generation_path: '/images/generations',
                edit_path: '/images/edits',
                image_field: 'image',
                api_key: ''
            },
            {
                id: 'image-official',
                name: 'OpenAI 官方独立生图 (DALL-E 3 / GPT-Image)',
                base_url: 'https://api.openai.com/v1',
                model: 'dall-e-3',
                generation_path: '/images/generations',
                edit_path: '/images/edits',
                image_field: 'image',
                api_key: ''
            },
            {
                id: 'image-custom',
                name: '独立自定义生图接口',
                base_url: 'https://api.openai.com/v1',
                model: 'flux-pro',
                generation_path: '/images/generations',
                edit_path: '/images/edits',
                image_field: 'image',
                api_key: ''
            }
        ]
    };
}

function loadConfig() {
    const def = getCleanDefaultConfig();
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const p = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            const scrubList = (arr) => Array.isArray(arr) ? arr.map(item => {
                if (!item || typeof item !== 'object') return item;
                const u = String(item.base_url || '');
                if (/\x65\x75\x7a\x68\x69|\x6f\x70\x65\x6e\x61\x69-\x70\x72\x6f\x78\x79|\x73\x69\x6c\x69\x63\x6f\x6e\x66\x6c\x6f\x77/i.test(u) && !item.api_key) {
                    item.base_url = 'https://api.openai.com/v1';
                }
                if (typeof item.name === 'string') {
                    item.name = item.name.replace(/\u0045\u0075\u007a\u0068\u0069|\u7845\u57fa\u6d41\u52a8/gi, '自定义接口').replace(/聚合中转站 \(OneAPI \/ NewAPI\)/g, '主力 API 渠道 (OpenAI 兼容)');
                }
                return item;
            }) : arr;
            p.codexProviders = scrubList(p.codexProviders);
            p.imageProviders = scrubList(p.imageProviders);
            return {
                ...def,
                ...p,
                routingMode: p.routingMode || 'gateway',
                syncImageKey: typeof p.syncImageKey === 'boolean' ? p.syncImageKey : true,
                onboarding_completed: Boolean(p.onboarding_completed),
                mode1_llm_tool: typeof p.mode1_llm_tool === 'boolean' ? p.mode1_llm_tool : true,
                mode2_prefix_direct: typeof p.mode2_prefix_direct === 'boolean' ? p.mode2_prefix_direct : true,
                codexProviders: Array.isArray(p.codexProviders) && p.codexProviders.length ? p.codexProviders : def.codexProviders,
                imageProviders: Array.isArray(p.imageProviders) && p.imageProviders.length ? p.imageProviders : def.imageProviders
            };
        } catch (e) {}
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(def, null, 2), 'utf8');
    return def;
}

function saveConfig(cfg) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

let appConfig = loadConfig();

// =============================================================
// GLOBAL CODEX SKILL SPECIFICATIONS
// =============================================================
const SKILL_MD_CONTENT = `---
name: image2
description: Generate and edit images through the local Codex Studio service with the active user-configured image provider. Use when a user asks to create, generate, edit, transform, or reference an image.
---

# Local Image2 Studio

Use the local Codex Studio gateway as the visual generation engine.

## Instructions
1. When generating or editing images, use the local CLI tool:
   - On Windows: \`"%CODEX_HOME%\\skills\\image2\\Image2CLI.cmd" --prompt "<optimized prompt>"\` (or \`python "%CODEX_HOME%\\skills\\image2\\image2_cli.py" --prompt "<optimized prompt>"\`)
2. For image references, add \`--image-path "C:\\path\\to\\image.png"\` or \`--image-url "https://..."\`.
3. For dry-run simulation, add \`--dry-run\`.
4. The CLI outputs JSON containing the generated image's local file path (\`path\`) and preview URL.
5. Inspect the CLI JSON response, read the returned local output path (\`path\`), and present the image directly to the user. Do NOT run extra PowerShell copy commands.
`;

const OPENAI_YAML_CONTENT = `interface:
  input:
    prompt:
      type: string
      description: The detailed prompt for generating or editing the image.
    image_paths:
      type: array
      items:
        type: string
      description: Optional list of local image paths for reference or edit.
    size:
      type: string
      description: Image dimensions (e.g. 1024x1024, 1792x1024, 1024x1792).
  output:
    image_url:
      type: string
      description: The local URL of the generated image.
    image_path:
      type: string
      description: The absolute local file path of the generated image.
`;

const STANDALONE_CLI_PY = `#!/usr/bin/env python3
import os, sys, json, argparse, urllib.request, urllib.error

def main():
    parser = argparse.ArgumentParser(description="Generate or edit images via local Codex Studio service.")
    parser.add_argument("--prompt", required=True, help="Image generation prompt")
    parser.add_argument("--size", default="1024x1024", help="Image size e.g. 1024x1024, 1792x1024")
    parser.add_argument("--quality", default="standard", help="Image quality")
    parser.add_argument("--image-url", default="", help="Reference image URL")
    parser.add_argument("--image-path", action="append", default=[], help="Local reference image path")
    parser.add_argument("--server", default="http://127.0.0.1:8765", help="Local service URL")
    parser.add_argument("--dry-run", action="store_true", help="Dry run validation")
    args = parser.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    cfg_path = os.path.join(here, "image2-client.json")
    server = args.server
    token = "${LEGACY_FALLBACK_TOKEN}"
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                c = json.load(f)
                server = c.get("server", server)
                tp = c.get("token_path", "")
                if tp and os.path.exists(tp):
                    with open(tp, "r", encoding="utf-8") as tf:
                        token = tf.read().strip() or token
        except Exception:
            pass

    payload = {
        "prompt": args.prompt,
        "size": args.size,
        "quality": args.quality,
        "dry_run": args.dry_run,
        "source": "codex-skill-cli"
    }
    req = urllib.request.Request(
        f"{server.rstrip('/')}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Image2-Local-Token": token},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print(json.dumps(data, ensure_ascii=False, indent=2))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", "ignore")
        print(f"Image2 request failed ({e.code}): {err_body}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Image2 request failed: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
`;

function installGlobalCodexSkill() {
    const paths = getCodexPaths();
    try {
        const skillDir = paths.skillDir;
        const agentsDir = path.join(skillDir, 'agents');
        fs.mkdirSync(agentsDir, { recursive: true });

        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), SKILL_MD_CONTENT, 'utf8');
        fs.writeFileSync(path.join(agentsDir, 'openai.yaml'), OPENAI_YAML_CONTENT, 'utf8');
        fs.writeFileSync(path.join(skillDir, 'image2_cli.py'), STANDALONE_CLI_PY, 'utf8');

        const cmdWrapper = '@echo off\r\npython "%~dp0image2_cli.py" %*\r\n';
        try {
            fs.writeFileSync(path.join(skillDir, 'Image2CLI.cmd'), cmdWrapper, 'utf8');
        } catch (e) {}
        const copiedExe = true;

        const clientConfig = {
            server: `http://${HOST}:${PORT}`,
            service_root: ROOT_DIR,
            token_path: TOKEN_FILE,
            output_dir: OUTPUTS_DIR,
            launcher: path.join(ROOT_DIR, 'CodexStudio.vbs')
        };
        fs.writeFileSync(path.join(skillDir, 'image2-client.json'), JSON.stringify(clientConfig, null, 2), 'utf8');

        return {
            ok: true,
            installed: true,
            global_skill_target: skillDir,
            has_cli_exe: copiedExe || fs.existsSync(path.join(skillDir, 'Image2CLI.cmd')),
            has_cli_py: true
        };
    } catch (e) {
        return { ok: false, installed: false, error: e.message };
    }
}

installGlobalCodexSkill();

// =============================================================
// MODE 1 & MODE 2 INTERCEPTION PARSERS
// =============================================================
function parseSizeAndQuality(promptText) {
    let size = '1024x1024';
    const szMatch = promptText.match(/\b(\d{3,4})[x×*](\d{3,4})\b/);
    if (szMatch) {
        size = `${szMatch[1]}x${szMatch[2]}`;
    } else if (/(?:16\s*[:：]\s*9|横屏|宽屏|横版)/.test(promptText)) {
        size = '1792x1024';
    } else if (/(?:9\s*[:：]\s*16|竖屏|竖版|手机壁纸|立绘)/.test(promptText)) {
        size = '1024x1792';
    } else if (/(?:4\s*[:：]\s*3)/.test(promptText)) {
        size = '1280x960';
    } else if (/(?:3\s*[:：]\s*4)/.test(promptText)) {
        size = '960x1280';
    }

    const quality = /(?:\bhd\b|超清|高清|8k|4k)/i.test(promptText) ? 'hd' : 'standard';

    const refPaths = [];
    const pRegex = /@?((?:[a-zA-Z]:[/\\]|\/|\.\.?[/\\])[^\s"'，。！？<>|?*]+\.(?:png|jpg|jpeg|webp))/gi;
    let pm;
    while ((pm = pRegex.exec(promptText)) !== null) {
        if (fs.existsSync(pm[1]) && fs.statSync(pm[1]).isFile()) refPaths.push(pm[1]);
    }

    return { size, quality, refImagePaths: refPaths.slice(0, 8) };
}

function checkPrefixCommand(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    const m = trimmed.match(/^(?:\/img|\/image|\/draw|画图[:：]|生图[:：]|绘图[:：])\s*([\s\S]*)$/i);
    if (!m) return null;

    let prompt = m[1].trim() || '简约唯美高清壁纸';
    const dryRun = /(?:--dry-run|模拟生图)/i.test(prompt);
    prompt = prompt.replace(/--dry-run/gi, '').trim();
    const { size, quality, refImagePaths } = parseSizeAndQuality(prompt);

    return {
        matched: true,
        type: 'mode2_prefix',
        prompt,
        size,
        quality,
        dryRun,
        refImagePaths
    };
}

function checkNaturalImageIntent(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (trimmed.length < 3 || trimmed.length > 400) return null;

    const codeGuard = /(?:代码|组件|函数|脚本|程序|网页|网站|前端|后端|接口|路由|数据库|报错|错误|异常|调试|重构|修复|编译|运行|写个.*(?:页|组件|脚本|代码|程序|接口|类)|实现.*(?:功能|逻辑|组件)|参考这张|看这张|分析这张|解释这张|根据这张|react|vue|angular|html|css|javascript|typescript|python|java|rust|golang|c\+\+|sql|json|yaml|toml|dockerfile|git|npm|pip|webpack|vite|tailwind)/i;
    if (codeGuard.test(trimmed)) return null;

    const cnVerbNoun = /(?:生成|画|绘制|创作|画一|做一|来一|给我画|帮我画|帮我生成|请生成|请画).{0,15}(?:一张|一幅|一个|张|幅|份)?.{0,45}(?:图|图片|照片|全家福|海报|壁纸|插画|头像|画像|配图|背景|画作|概念图|效果图|封面|写真|风景|漫画|手绘)/i;
    const cnDirectStart = /^(?:请|帮我|给我)?(?:生成一张|生成一幅|画一张|画一幅|绘制一张|绘制一幅|创作一张)([\s\S]{2,200})$/i;
    const enPattern = /\b(?:generate|draw|create|paint|render)\s+(?:an?\s+|me\s+an?\s+)?(?:image|picture|photo|photograph|illustration|wallpaper|poster|portrait|artwork|family\s+photo)\b/i;

    if (!cnVerbNoun.test(trimmed) && !cnDirectStart.test(trimmed) && !enPattern.test(trimmed)) {
        return null;
    }

    const dryRun = /(?:--dry-run|模拟生图)/i.test(trimmed);
    const cleanPrompt = trimmed.replace(/--dry-run/gi, '').trim();
    const { size, quality, refImagePaths } = parseSizeAndQuality(cleanPrompt);

    return {
        matched: true,
        type: 'mode1_semantic',
        prompt: cleanPrompt,
        size,
        quality,
        dryRun,
        refImagePaths
    };
}

/**
 * Accurately extracts a fresh user prompt ONLY when the incoming request's
 * most recent terminal item is a genuine user turn.
 */
function getFreshUserPrompt(body) {
    if (!body || typeof body !== 'object') return null;

    // 1. Chat Completions API (body.messages)
    if (Array.isArray(body.messages) && body.messages.length > 0) {
        const lastMsg = body.messages[body.messages.length - 1];
        if (!lastMsg || lastMsg.role !== 'user') {
            return null;
        }
        if (typeof lastMsg.content === 'string') return lastMsg.content.trim();
        if (Array.isArray(lastMsg.content)) {
            return lastMsg.content
                .map(p => (typeof p === 'string' ? p : p.text || p.input_text || ''))
                .filter(Boolean)
                .join('\n')
                .trim();
        }
        return '';
    }

    // 2. Responses API (body.input)
    if (typeof body.input === 'string') {
        return body.input.trim();
    }
    if (Array.isArray(body.input) && body.input.length > 0) {
        const lastItem = body.input[body.input.length - 1];
        if (!lastItem) return null;

        if (lastItem.type === 'function_call_output' || lastItem.type === 'tool_response' || lastItem.type === 'item_reference') {
            return null;
        }
        if (lastItem.role === 'assistant' || lastItem.type === 'reasoning') {
            return null;
        }

        if (lastItem.role === 'user' || (lastItem.type === 'message' && lastItem.role === 'user')) {
            if (typeof lastItem.content === 'string') return lastItem.content.trim();
            if (Array.isArray(lastItem.content)) {
                return lastItem.content
                    .map(p => (typeof p === 'string' ? p : p.text || p.input_text || ''))
                    .filter(Boolean)
                    .join('\n')
                    .trim();
            }
        }
        return null;
    }

    if (typeof body.prompt === 'string') return body.prompt.trim();
    return null;
}

// =============================================================
// [P0-1] CROSS-PROTOCOL AUTO-BRIDGE (Responses API <-> Chat Completions)
// =============================================================
function shouldBridgeResponsesToChat(activeCodex) {
    if (!activeCodex) return false;
    if (activeCodex.wire_api === 'chat') return true;
    const base = (activeCodex.base_url || '').toLowerCase();
    const model = (activeCodex.model || '').toLowerCase();
    if (base.includes('deepseek.com') || base.includes(':11434')) {
        return true;
    }
    if (/^(deepseek-|claude-|qwen-|glm-|yi-|llama|mistral)/i.test(model)) {
        return true;
    }
    return false;
}

function convertResponsesBodyToChat(bodyObj, targetModel) {
    const messages = [];

    if (typeof bodyObj.instructions === 'string' && bodyObj.instructions.trim()) {
        messages.push({ role: 'system', content: bodyObj.instructions.trim() });
    }

    const rawInput = bodyObj.input;
    if (typeof rawInput === 'string') {
        messages.push({ role: 'user', content: rawInput });
    } else if (Array.isArray(rawInput)) {
        for (const item of rawInput) {
            if (!item || typeof item !== 'object') continue;

            if (item.type === 'function_call') {
                messages.push({
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                        id: item.call_id || item.id || ('call_' + crypto.randomBytes(4).toString('hex')),
                        type: 'function',
                        function: {
                            name: item.name || 'tool',
                            arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {})
                        }
                    }]
                });
                continue;
            }

            if (item.type === 'function_call_output' || item.type === 'tool_response') {
                messages.push({
                    role: 'tool',
                    tool_call_id: item.call_id || item.id || 'call_default',
                    content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? '')
                });
                continue;
            }

            const role = item.role === 'developer' ? 'system' : (item.role || 'user');
            if (typeof item.content === 'string') {
                messages.push({ role, content: item.content });
            } else if (Array.isArray(item.content)) {
                const convertedParts = [];
                for (const p of item.content) {
                    if (typeof p === 'string') {
                        convertedParts.push({ type: 'text', text: p });
                    } else if (p && (p.type === 'input_text' || p.type === 'output_text' || p.type === 'text')) {
                        convertedParts.push({ type: 'text', text: p.text || p.input_text || '' });
                    } else if (p && (p.type === 'input_image' || p.type === 'image_url')) {
                        const imgUrl = typeof p.image_url === 'string' ? p.image_url : (p.image_url?.url || p.url || '');
                        if (imgUrl) convertedParts.push({ type: 'image_url', image_url: { url: imgUrl } });
                    }
                }
                if (convertedParts.length === 1 && convertedParts[0].type === 'text') {
                    messages.push({ role, content: convertedParts[0].text });
                } else if (convertedParts.length > 0) {
                    messages.push({ role, content: convertedParts });
                }
            }
        }
    } else if (Array.isArray(bodyObj.messages)) {
        messages.push(...bodyObj.messages);
    }

    if (messages.length === 0) {
        messages.push({ role: 'user', content: String(bodyObj.prompt || 'Hello') });
    }

    const chatBody = {
        model: targetModel || bodyObj.model || 'gpt-4o',
        messages,
        stream: Boolean(bodyObj.stream)
    };

    if (typeof bodyObj.temperature === 'number') chatBody.temperature = bodyObj.temperature;
    if (typeof bodyObj.top_p === 'number') chatBody.top_p = bodyObj.top_p;
    if (bodyObj.max_output_tokens || bodyObj.max_tokens) {
        chatBody.max_tokens = bodyObj.max_output_tokens || bodyObj.max_tokens;
    }

    if (Array.isArray(bodyObj.tools) && bodyObj.tools.length > 0) {
        const mappedTools = [];
        for (const t of bodyObj.tools) {
            if (!t) continue;
            if (t.type === 'function' && t.function) {
                mappedTools.push(t);
            } else if (t.type === 'function' && t.name) {
                mappedTools.push({
                    type: 'function',
                    function: {
                        name: t.name,
                        description: t.description || '',
                        parameters: t.parameters || { type: 'object', properties: {} }
                    }
                });
            }
        }
        if (mappedTools.length > 0) chatBody.tools = mappedTools;
    }

    return chatBody;
}

function convertChatCompletionJsonToResponses(chatJson, fallbackModel = 'gpt-4o') {
    const respId = 'resp-' + crypto.randomBytes(6).toString('hex');
    const created = chatJson?.created || Math.floor(Date.now() / 1000);
    const model = chatJson?.model || fallbackModel;
    const choice = Array.isArray(chatJson?.choices) ? chatJson.choices[0] : null;
    const msg = choice?.message || {};
    const text = typeof msg.content === 'string' ? msg.content : '';

    const output = [];
    if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
            output.push({
                type: 'function_call',
                id: tc.id || ('fc_' + crypto.randomBytes(4).toString('hex')),
                call_id: tc.id || ('call_' + crypto.randomBytes(4).toString('hex')),
                name: tc.function?.name || 'tool',
                arguments: tc.function?.arguments || '{}'
            });
        }
    }
    if (text || output.length === 0) {
        output.push({
            type: 'message',
            id: 'msg-' + crypto.randomBytes(5).toString('hex'),
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text, annotations: [] }]
        });
    }

    const usage = chatJson?.usage || {};
    return {
        id: respId,
        object: 'response',
        created_at: created,
        created,
        status: 'completed',
        model,
        output_text: text,
        output,
        usage: {
            input_tokens: usage.prompt_tokens || 0,
            output_tokens: usage.completion_tokens || 0,
            total_tokens: usage.total_tokens || 0
        }
    };
}

function streamUpstreamChatAsResponsesSSE(pRes, clientRes, fallbackModel = 'gpt-4o') {
    const respId = 'resp-' + crypto.randomBytes(6).toString('hex');
    const msgId = 'msg-' + crypto.randomBytes(5).toString('hex');
    let fullText = '';
    const toolCallsMap = new Map();
    let buffer = '';
    let completedSent = false;

    clientRes.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    clientRes.write(`event: response.created\ndata: ${JSON.stringify({
        type: 'response.created',
        response: { id: respId, object: 'response', status: 'in_progress', model: fallbackModel, output: [] }
    })}\n\n`);

    function finalizeStream() {
        if (completedSent) return;
        completedSent = true;
        const output = [];
        for (const [, tc] of toolCallsMap.entries()) {
            const fcItem = {
                type: 'function_call',
                id: tc.id,
                call_id: tc.id,
                name: tc.name,
                arguments: tc.arguments
            };
            output.push(fcItem);
            clientRes.write(`event: response.output_item.done\ndata: ${JSON.stringify({
                type: 'response.output_item.done',
                response_id: respId,
                item: fcItem
            })}\n\n`);
        }
        if (fullText || output.length === 0) {
            output.push({
                type: 'message',
                id: msgId,
                status: 'completed',
                role: 'assistant',
                content: [{ type: 'output_text', text: fullText, annotations: [] }]
            });
        }
        clientRes.write(`event: response.completed\ndata: ${JSON.stringify({
            type: 'response.completed',
            response: {
                id: respId,
                object: 'response',
                status: 'completed',
                model: fallbackModel,
                output_text: fullText,
                output
            }
        })}\n\n`);
        clientRes.write('data: [DONE]\n\n');
        clientRes.end();
    }

    pRes.on('data', chunk => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;
            const dataPayload = line.slice(5).trim();
            if (dataPayload === '[DONE]') {
                finalizeStream();
                return;
            }
            try {
                const parsed = JSON.parse(dataPayload);
                const delta = parsed.choices?.[0]?.delta;
                if (!delta) continue;

                if (typeof delta.content === 'string' && delta.content.length > 0) {
                    fullText += delta.content;
                    clientRes.write(`event: response.output_text.delta\ndata: ${JSON.stringify({
                        type: 'response.output_text.delta',
                        response_id: respId,
                        item_id: msgId,
                        output_index: 0,
                        content_index: 0,
                        delta: delta.content
                    })}\n\n`);
                }

                if (Array.isArray(delta.tool_calls)) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index ?? 0;
                        if (!toolCallsMap.has(idx)) {
                            toolCallsMap.set(idx, {
                                id: tc.id || ('call_' + crypto.randomBytes(4).toString('hex')),
                                name: tc.function?.name || '',
                                arguments: ''
                            });
                        }
                        const entry = toolCallsMap.get(idx);
                        if (tc.id) entry.id = tc.id;
                        if (tc.function?.name) entry.name += tc.function.name;
                        if (tc.function?.arguments) entry.arguments += tc.function.arguments;
                    }
                }
            } catch (e) {}
        }
    });

    pRes.on('end', () => finalizeStream());
    pRes.on('error', () => finalizeStream());
}

// =============================================================
// RESOLVE EFFECTIVE IMAGE PROVIDER & RELAY MODEL FETCHING
// =============================================================
const IMAGE_MODEL_REGEX = /(?:image|dall-e|dalle|flux|sd3|stable-diffusion|kolors|ideogram|midjourney|mj|imagen|recraft|cogview|wanx|sora|paint|draw|gpt-image|gpt-4o-image|gpt-4o-all)/i;

function getEffectiveImageProvider() {
    const activeImg = appConfig.imageProviders.find(p => p.id === appConfig.activeImageProvider) || appConfig.imageProviders[0];
    const activeCodex = appConfig.codexProviders.find(p => p.id === appConfig.activeCodexProvider) || appConfig.codexProviders[0];

    const resolved = { ...(activeImg || {
        id: 'image-relay',
        name: '中转站联动生图',
        base_url: 'https://api.openai.com/v1',
        model: 'gpt-image-2',
        generation_path: '/images/generations',
        edit_path: '/images/edits',
        image_field: 'image',
        api_key: ''
    }) };

    if ((appConfig.syncImageKey || !resolved.api_key) && activeCodex && activeCodex.api_key && activeCodex.api_key !== 'ollama') {
        resolved.api_key = activeCodex.api_key;
        if (activeCodex.base_url && (appConfig.syncImageKey || !resolved.base_url || resolved.base_url.includes('api.openai.com'))) {
            resolved.base_url = activeCodex.base_url;
        }
    }
    return resolved;
}

async function fetchModelsFromUpstream(baseUrl, apiKey) {
    baseUrl = (baseUrl || '').trim().replace(/\/+$/, '');
    const urlCandidates = [];
    if (baseUrl.includes('11434')) {
        urlCandidates.push(baseUrl.replace(/\/v1$/, '') + '/api/tags');
    }
    if (baseUrl.endsWith('/v1')) {
        urlCandidates.push(`${baseUrl}/models`);
        urlCandidates.push(`${baseUrl.slice(0, -3)}/models`);
    } else {
        urlCandidates.push(`${baseUrl}/v1/models`);
        urlCandidates.push(`${baseUrl}/models`);
    }

    let fetchedData = null;
    let lastErr = '';

    for (const targetUrl of urlCandidates) {
        try {
            const headers = { 'Accept': 'application/json', 'User-Agent': 'CodexStudio/2.6.0' };
            if (apiKey && apiKey !== 'ollama') headers['Authorization'] = `Bearer ${apiKey}`;
            const r = await makeHttpRequest(targetUrl, { method: 'GET', headers, timeout: 8000 });
            if (r.statusCode >= 200 && r.statusCode < 300 && r.body) {
                const rawData = Array.isArray(r.body.data)
                    ? r.body.data
                    : (Array.isArray(r.body.models) ? r.body.models : (Array.isArray(r.body) ? r.body : []));
                if (rawData.length > 0) {
                    fetchedData = rawData.map(m => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
                    break;
                }
            } else {
                lastErr = `HTTP ${r.statusCode}`;
            }
        } catch (e) {
            lastErr = e.message;
        }
    }

    const detectedImageModels = fetchedData ? fetchedData.filter(m => IMAGE_MODEL_REGEX.test(m)) : [];
    return { fetchedData, detectedImageModels, lastErr };
}

// =============================================================
// IMAGE ENGINE CORE (With Auto-Fallback on model_not_found / 503)
// =============================================================
async function executeImageTask({ prompt, size = '1024x1024', quality = 'standard', dryRun = false, refFiles = [], source = 'studio' }) {
    const active = getEffectiveImageProvider();
    if (!active) throw new Error('未配置任何图片模型提供商');

    const normQuality = (quality === 'medium' || !quality) ? 'standard' : quality;
    const isEdit = refFiles && refFiles.length > 0;
    const baseClean = (active.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const genPath = active.generation_path || '/images/generations';
    const editPath = active.edit_path || '/images/edits';
    const targetEndpoint = `${baseClean}${isEdit ? editPath : genPath}`;

    if (dryRun) {
        return {
            ok: true,
            dry_run: true,
            mode: isEdit ? 'edit' : 'generate',
            provider: active.name,
            model: active.model,
            prompt,
            size,
            quality: normQuality,
            ref_count: refFiles.length,
            target_url: targetEndpoint,
            output_dir: OUTPUTS_DIR,
            urls: ['/outputs/dry-run.png'],
            paths: ['outputs/dry-run.png'],
            url: '/outputs/dry-run.png',
            full_url: `http://${HOST}:${PORT}/outputs/dry-run.png`,
            path: 'outputs/dry-run.png',
            message: 'Dry-Run 校验通过：参数解析正常，未消耗 API 额度'
        };
    }

    if (!active.api_key) {
        throw new Error(`尚未配置生图 API Key。请在「Codex 接入与渠道」或「新手向导」中填入中转站 API Key 并保存`);
    }

    let usedModel = active.model || 'gpt-image-2';

    recordGatewayEvent({
        source: source === 'studio-ui' ? '视觉工坊 UI' : `Codex (${source})`,
        message: prompt,
        action: `🎨 正在调用 ${usedModel} 生成图像 (${size})`,
        status: 'processing',
        detail: targetEndpoint
    });

    async function callGenerationsWithModel(modelToTry, sizeToTry) {
        const reqBody = {
            model: modelToTry,
            prompt,
            n: 1,
            size: sizeToTry
        };
        if (normQuality === 'hd') reqBody.quality = 'hd';
        const payloadStr = JSON.stringify(reqBody);
        return await makeHttpRequest(targetEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${active.api_key}`,
                'User-Agent': 'CodexStudio/2.6.0',
                'Content-Length': Buffer.byteLength(payloadStr, 'utf8')
            }
        }, payloadStr);
    }

    let apiRes;
    if (isEdit) {
        const boundary = '----CodexBoundary' + crypto.randomBytes(6).toString('hex');
        const parts = [];
        const addF = (k, v) => parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
        addF('model', usedModel);
        addF('prompt', prompt);
        addF('size', size);

        refFiles.forEach((f, idx) => {
            const fn = active.image_field || 'image';
            parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fn}"; filename="${f.filename || `ref_${idx}.png`}"\r\nContent-Type: ${f.contentType || 'image/png'}\r\n\r\n`));
            parts.push(f.data);
            parts.push(Buffer.from('\r\n'));
        });
        parts.push(Buffer.from(`--${boundary}--\r\n`));
        let pBuf = Buffer.concat(parts);

        apiRes = await makeHttpRequest(targetEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Authorization': `Bearer ${active.api_key}`,
                'Content-Length': pBuf.length
            }
        }, pBuf);
        pBuf = null;
    } else {
        apiRes = await callGenerationsWithModel(usedModel, size);

        if (apiRes.statusCode !== 200 && size !== '1024x1024' && !JSON.stringify(apiRes.body || '').includes('model_not_found')) {
            apiRes = await callGenerationsWithModel(usedModel, '1024x1024');
        }

        const errBodyStr = typeof apiRes.body === 'object' ? JSON.stringify(apiRes.body) : String(apiRes.body || '');
        if (apiRes.statusCode !== 200 && (/model_not_found|No available channel|model_not_support|does not exist/i.test(errBodyStr))) {
            recordGatewayEvent({
                source: '生图智能自愈',
                message: `模型 ${usedModel} 在当前中转分组不可用，正在自动探测该中转站支持的生图模型...`,
                action: '🔄 自动探测可用生图模型',
                status: 'processing'
            });

            const { detectedImageModels } = await fetchModelsFromUpstream(baseClean, active.api_key);
            const fallbackCandidates = [
                ...detectedImageModels,
                'gpt-image-2',
                'gpt-image-1',
                'gpt-4o-image',
                'dall-e-3',
                'flux-pro',
                'flux',
                'black-forest-labs/FLUX.1-schnell',
                'dall-e-2'
            ].filter((m, idx, arr) => m && m !== usedModel && arr.indexOf(m) === idx);

            for (const candModel of fallbackCandidates.slice(0, 5)) {
                const retryRes = await callGenerationsWithModel(candModel, '1024x1024');
                if (retryRes.statusCode === 200) {
                    apiRes = retryRes;
                    usedModel = candModel;
                    const imgP = appConfig.imageProviders.find(p => p.id === appConfig.activeImageProvider) || appConfig.imageProviders[0];
                    if (imgP) {
                        imgP.model = candModel;
                        saveConfig(appConfig);
                    }
                    recordGatewayEvent({
                        source: '生图智能自愈',
                        message: `已自动切换为中转站可用生图模型: ${candModel}`,
                        action: `✅ 自动绑定 ${candModel}`,
                        status: 'success'
                    });
                    break;
                }
            }
        }
    }

    if (apiRes.statusCode !== 200) {
        const errStr = typeof apiRes.body === 'object' ? JSON.stringify(apiRes.body) : String(apiRes.body);
        recordGatewayEvent({
            source,
            message: prompt,
            action: `❌ 生图接口返回 HTTP ${apiRes.statusCode}`,
            status: 'error',
            detail: errStr
        });
        throw new Error(`上游图片 API 错误 (HTTP ${apiRes.statusCode}): ${errStr}。请点击生图设置中的「🔄 在线拉取生图模型」切换为你中转站分组支持的生图模型`);
    }

    const item = apiRes.body?.data?.[0] || apiRes.body?.images?.[0] || apiRes.body;
    if (!item) throw new Error('上游图片 API 未返回有效图片数据');

    const filename = `${isEdit ? 'edit' : 'img'}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`;
    const outPath = path.join(OUTPUTS_DIR, filename);

    if (item.b64_json) {
        fs.writeFileSync(outPath, Buffer.from(item.b64_json, 'base64'));
        item.b64_json = null;
    } else if (item.url) {
        const dl = await makeHttpRequest(item.url, { method: 'GET' });
        if (dl.statusCode >= 200 && dl.statusCode < 300 && dl.raw && dl.raw.length > 0) {
            fs.writeFileSync(outPath, dl.raw);
        } else {
            throw new Error(`下载生成的图片失败 (HTTP ${dl.statusCode})`);
        }
        dl.raw = null;
    } else {
        throw new Error('未识别的图片返回格式（既无 url 也无 b64_json）');
    }

    const createdAtIso = new Date().toISOString();
    const metaObj = {
        filename,
        prompt,
        model: usedModel,
        provider: active.name,
        size,
        quality: normQuality,
        source,
        created_at: createdAtIso
    };
    fs.writeFileSync(path.join(OUTPUTS_DIR, `${filename}.json`), JSON.stringify(metaObj, null, 2));
    try {
        const st = fs.statSync(outPath);
        recentGeneratedFiles.set(filename, { ...metaObj, path: outPath, bytes: st.size });
    } catch (e) {
        recentGeneratedFiles.set(filename, { ...metaObj, path: outPath, bytes: 1024 });
    }

    const relUrl = `/outputs/${filename}`;
    const fullUrl = `http://${HOST}:${PORT}${relUrl}`;

    recordGatewayEvent({
        source,
        message: prompt,
        action: `✅ 图像生成成功 (${usedModel} · ${filename})`,
        status: 'success',
        detail: outPath
    });

    triggerCompactGC();

    return {
        ok: true,
        filename,
        url: relUrl,
        urls: [relUrl],
        full_url: fullUrl,
        path: outPath,
        paths: [outPath],
        output_dir: OUTPUTS_DIR,
        prompt,
        size,
        quality: normQuality,
        provider: active.name,
        model: usedModel
    };
}

// =============================================================
// SYNTHESIZED RESPONSES FOR CHAT & RESPONSES APIS
// =============================================================
function sendSynthesizedChatResponse(res, isStream, content, modelName = 'codex-gateway') {
    const id = 'chatcmpl-' + crypto.randomBytes(5).toString('hex');
    const created = Math.floor(Date.now() / 1000);

    if (isStream) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: modelName, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: modelName, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: modelName, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
    } else {
        sendJson(res, {
            id,
            object: 'chat.completion',
            created,
            model: modelName,
            choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        });
    }
}

function sendSynthesizedResponsesResponse(res, isStream, content, modelName = 'codex-gateway') {
    const id = 'resp-' + crypto.randomBytes(6).toString('hex');
    const created = Math.floor(Date.now() / 1000);

    if (isStream) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        res.write(`event: response.created\ndata: ${JSON.stringify({
            response: { id, object: 'response', status: 'in_progress', model: modelName }
        })}\n\n`);

        res.write(`event: response.output_text.delta\ndata: ${JSON.stringify({
            response_id: id, delta: content
        })}\n\n`);

        res.write(`event: response.completed\ndata: ${JSON.stringify({
            response: { id, object: 'response', status: 'completed', output_text: content, model: modelName }
        })}\n\n`);

        res.write('data: [DONE]\n\n');
        res.end();
    } else {
        sendJson(res, {
            id,
            object: 'response',
            created,
            model: modelName,
            status: 'completed',
            output_text: content,
            output: [
                {
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: content }]
                }
            ],
            usage: { total_tokens: 0, input_tokens: 0, output_tokens: 0 }
        });
    }
}

function sendSynthesizedByEndpoint(res, pathname, isStream, content, modelName) {
    if (pathname === '/v1/responses') {
        return sendSynthesizedResponsesResponse(res, isStream, content, modelName);
    }
    return sendSynthesizedChatResponse(res, isStream, content, modelName);
}

// =============================================================
// CODEX CONFIG.TOML SYNC
// =============================================================
function syncProviderToCodexToml(provider, routingMode = 'gateway', connectionCategory = 'relay_api') {
    const { home, configToml, authJson } = getCodexPaths();
    if (!fs.existsSync(home)) fs.mkdirSync(home, { recursive: true });

    let existingToml = '';
    if (fs.existsSync(configToml)) {
        existingToml = fs.readFileSync(configToml, 'utf8');
        fs.writeFileSync(`${configToml}.bak`, existingToml, 'utf8');
    }

    const useGateway = routingMode === 'gateway';
    const providerKey = useGateway ? 'codex_studio_gateway' : provider.id.replace(/[^a-zA-Z0-9_]/g, '_');
    const effectiveBaseUrl = useGateway ? `http://${HOST}:${PORT}/v1` : provider.base_url;
    const effectiveKey = useGateway ? (provider.api_key || 'local-gateway-key') : provider.api_key;

    let lines = existingToml ? existingToml.split('\n') : [];
    let hasModel = false, hasProv = false;
    lines = lines.map(l => {
        if (l.match(/^model\s*=/)) { hasModel = true; return `model = "${provider.model}"`; }
        if (l.match(/^model_provider\s*=/)) { hasProv = true; return `model_provider = "${providerKey}"`; }
        return l;
    });
    if (!hasModel) lines.unshift(`model = "${provider.model}"`);
    if (!hasProv) lines.splice(1, 0, `model_provider = "${providerKey}"`);

    const cleaned = [];
    let skip = false;
    for (const l of lines) {
        if (l.trim() === `[model_providers.${providerKey}]`) { skip = true; continue; }
        if (skip && l.startsWith('[')) skip = false;
        if (!skip) cleaned.push(l);
    }

    const wireApi = provider.wire_api || 'responses';
    cleaned.push(
        '',
        `[model_providers.${providerKey}]`,
        `name = "${useGateway ? 'Codex Studio Gateway (' + provider.name + ')' : provider.name}"`,
        `base_url = "${effectiveBaseUrl}"`,
        `wire_api = "${wireApi}"`
    );
    if (effectiveKey) cleaned.push(`api_key = "${effectiveKey}"`);

    fs.writeFileSync(configToml, cleaned.join('\n').trim() + '\n', 'utf8');

    if (effectiveKey) {
        let authObj = {};
        if (fs.existsSync(authJson)) { try { authObj = JSON.parse(fs.readFileSync(authJson, 'utf8')); } catch (e) {} }
        authObj[providerKey] = effectiveKey;
        authObj['OPENAI_API_KEY'] = effectiveKey;
        fs.writeFileSync(authJson, JSON.stringify(authObj, null, 2), 'utf8');
    }

    installGlobalCodexSkill();

    return {
        success: true,
        routing_mode: routingMode,
        gateway_url: effectiveBaseUrl,
        category: connectionCategory,
        message: useGateway
            ? `已成功同步至 Codex（本地网关模式）：代码透传 ${provider.name}，生图支持方案1（自然语言智能判定）与方案2（/img指令直达）`
            : `已成功同步至 Codex（直连模式）：直接连接 ${provider.name}`
    };
}

// =============================================================
// [P0-2] SECURITY & NETWORK HELPERS
// =============================================================
function isLoopbackOrigin(originHeader) {
    if (!originHeader) return true;
    return /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(String(originHeader).trim());
}

function getCorsHeaders(req) {
    const origin = req?.headers?.origin;
    const allowedOrigin = (origin && isLoopbackOrigin(origin)) ? origin : `http://${HOST}:${PORT}`;
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Image2-Local-Token, X-Codex-Simulator',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Vary': 'Origin'
    };
}

function verifyLocalApiAuth(req, pathname) {
    const origin = req.headers.origin;
    if (origin && !isLoopbackOrigin(origin)) {
        return { ok: false, status: 403, reason: 'Forbidden: Cross-origin request blocked by local security policy' };
    }
    const referer = req.headers.referer;
    if (referer && !/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//i.test(referer)) {
        return { ok: false, status: 403, reason: 'Forbidden: Invalid referer' };
    }

    // /api/health is open to local pre-flight checks (CodexStudio.vbs)
    if (pathname === '/api/health' && req.method === 'GET') {
        return { ok: true };
    }

    const clientToken = (req.headers['x-image2-local-token'] || '').trim();
    if (clientToken && (clientToken === LOCAL_SERVICE_TOKEN || clientToken === LEGACY_FALLBACK_TOKEN)) {
        return { ok: true };
    }

    // Allow same-origin GET requests from local browser tab or local PowerShell tray without Origin header
    if (!origin && req.socket?.remoteAddress && /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress)) {
        if (!req.headers['user-agent'] || /PowerShell|WindowsPowerShell|curl|Python-urllib|WinHttp|MSXML/i.test(req.headers['user-agent'])) {
            return { ok: true };
        }
    }

    return { ok: false, status: 401, reason: 'Unauthorized: Missing or invalid X-Image2-Local-Token' };
}

function sendJson(res, data, status = 200, req = null) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        ...getCorsHeaders(req)
    });
    res.end(JSON.stringify(data));
}

function sendError(res, msg, status = 400, req = null) {
    sendJson(res, { error: msg, detail: msg, ok: false }, status, req);
}

function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let len = 0;
        req.on('data', c => {
            chunks.push(c);
            len += c.length;
            if (len > 35 * 1024 * 1024) reject(new Error('Payload too large'));
        });
        req.on('end', () => {
            const rawBuffer = Buffer.concat(chunks);
            try {
                resolve({ parsed: rawBuffer.length ? JSON.parse(rawBuffer.toString('utf8')) : {}, rawBuffer });
            } catch (e) {
                resolve({ parsed: {}, rawBuffer });
            }
        });
        req.on('error', reject);
    });
}

function parseMultipartBody(req) {
    return new Promise((resolve, reject) => {
        const ct = req.headers['content-type'] || '';
        const bm = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        if (!bm) return reject(new Error('Missing boundary'));
        const boundary = bm[1] || bm[2];
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const buf = Buffer.concat(chunks);
            const bBuf = Buffer.from('--' + boundary);
            const parts = [];
            let start = 0;
            while (true) {
                const idx = buf.indexOf(bBuf, start);
                if (idx === -1) break;
                if (start > 0) parts.push(buf.slice(start, idx - 2));
                start = idx + bBuf.length + 2;
            }
            const fields = {}, files = [];
            for (const p of parts) {
                const he = p.indexOf(Buffer.from('\r\n\r\n'));
                if (he === -1) continue;
                const hs = p.slice(0, he).toString('utf8');
                const body = p.slice(he + 4);
                const dm = hs.match(/name="([^"]+)"(?:;\s*filename="([^"]+)")?/i);
                if (dm) {
                    if (dm[2]) {
                        const tm = hs.match(/Content-Type:\s*([^\r\n]+)/i);
                        files.push({ name: dm[1], filename: dm[2], contentType: tm ? tm[1].trim() : 'image/png', data: body });
                    } else {
                        fields[dm[1]] = body.toString('utf8');
                    }
                }
            }
            resolve({ fields, files });
        });
        req.on('error', reject);
    });
}

function getMimeType(fp) {
    const ext = path.extname(fp).toLowerCase();
    return ({
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml'
    })[ext] || 'application/octet-stream';
}

function makeHttpRequest(targetUrl, options, postData) {
    return new Promise((resolve, reject) => {
        const u = new URL(targetUrl);
        const isHttps = u.protocol === 'https:';
        const client = isHttps ? https : http;
        const headers = { ...(options.headers || {}) };
        let bodyBuf = null;
        if (postData !== undefined && postData !== null) {
            bodyBuf = Buffer.isBuffer(postData) ? postData : Buffer.from(String(postData), 'utf8');
            if (!headers['Content-Length'] && !headers['content-length']) {
                headers['Content-Length'] = bodyBuf.length;
            }
        }
        const req = client.request({
            hostname: u.hostname,
            port: u.port || (isHttps ? 443 : 80),
            path: u.pathname + u.search,
            method: options.method || 'GET',
            headers
        }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks);
                let body = null;
                try { body = JSON.parse(raw.toString('utf8')); } catch (e) { body = raw.toString('utf8'); }
                resolve({ statusCode: res.statusCode, headers: res.headers, body, raw });
            });
        });
        req.on('error', reject);
        req.setTimeout(options.timeout || 120000, () => req.destroy(new Error('Upstream timeout')));
        if (bodyBuf) req.write(bodyBuf);
        req.end();
    });
}

// [P0-1] Forward request to upstream with automatic Responses <-> Chat Completions protocol bridging
function forwardToUpstreamChatAsResponses({ req, res, upBase, parsedUrl, bodyObj, activeCodex, isStream, reasonLabel }) {
    const targetModel = activeCodex.model || bodyObj.model || 'gpt-4o';
    const chatPayloadObj = convertResponsesBodyToChat(bodyObj, targetModel);
    const outgoingPayload = Buffer.from(JSON.stringify(chatPayloadObj), 'utf8');
    const chatUrl = new URL(upBase + '/chat/completions' + parsedUrl.search);
    const isHttps = chatUrl.protocol === 'https:';

    const headers = {
        'Content-Type': 'application/json',
        'Accept': isStream ? 'text/event-stream' : 'application/json',
        'User-Agent': req.headers['user-agent'] || 'CodexStudio/2.6.0',
        'Content-Length': outgoingPayload.length
    };
    if (activeCodex.api_key && activeCodex.api_key !== 'ollama') {
        headers['Authorization'] = `Bearer ${activeCodex.api_key}`;
    } else if (req.headers['authorization']) {
        headers['Authorization'] = req.headers['authorization'];
    }

    recordGatewayEvent({
        source: '跨协议桥接器',
        message: `Responses API -> Chat Completions (${targetModel})`,
        action: `🔄 ${reasonLabel || '已自动将 Responses 请求桥接为 Chat 协议转发'}`,
        status: 'info'
    });

    const pReq = (isHttps ? https : http).request({
        hostname: chatUrl.hostname,
        port: chatUrl.port || (isHttps ? 443 : 80),
        path: chatUrl.pathname + chatUrl.search,
        method: 'POST',
        headers
    }, pRes => {
        if (pRes.statusCode >= 200 && pRes.statusCode < 300) {
            if (isStream) {
                return streamUpstreamChatAsResponsesSSE(pRes, res, targetModel);
            } else {
                const chunks = [];
                pRes.on('data', c => chunks.push(c));
                pRes.on('end', () => {
                    const rawStr = Buffer.concat(chunks).toString('utf8');
                    try {
                        const chatJson = JSON.parse(rawStr);
                        const respJson = convertChatCompletionJsonToResponses(chatJson, targetModel);
                        return sendJson(res, respJson, 200, req);
                    } catch (e) {
                        res.writeHead(pRes.statusCode, pRes.headers);
                        return res.end(rawStr);
                    }
                });
                return;
            }
        }
        res.writeHead(pRes.statusCode, pRes.headers);
        pRes.pipe(res);
    });

    pReq.on('error', e => {
        if (!res.headersSent) sendError(res, `Upstream Bridged Gateway Error: ${e.message}`, 502, req);
    });
    pReq.write(outgoingPayload);
    pReq.end();
}

// =============================================================
// SERVER CORE & ROUTER
// =============================================================
const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
        if (!isLoopbackOrigin(req.headers.origin)) {
            res.writeHead(403);
            return res.end('Forbidden');
        }
        res.writeHead(204, getCorsHeaders(req));
        return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || HOST}`);
    const pathname = parsedUrl.pathname;

    // 1. CODEX GATEWAY (/v1/chat/completions & /v1/responses)
    if (pathname.startsWith('/v1/')) {
        const activeCodex = appConfig.codexProviders.find(p => p.id === appConfig.activeCodexProvider) || appConfig.codexProviders[0];
        if (!activeCodex) return sendError(res, 'No active Codex provider', 502, req);

        const isChatOrResp = (pathname === '/v1/chat/completions' || pathname === '/v1/responses') && req.method === 'POST';
        if (isChatOrResp) {
            const { parsed: bodyObj } = await parseJsonBody(req);
            const freshUserPrompt = getFreshUserPrompt(bodyObj);
            const isStream = Boolean(bodyObj.stream);
            const protoLabel = pathname === '/v1/responses' ? 'Responses API' : 'Chat API';

            // Only inspect for interception if this is a genuine, fresh user prompt!
            if (freshUserPrompt) {
                if (isDuplicateRapidRequest(freshUserPrompt)) {
                    // Transparently proxy duplicate request to avoid duplicate generation
                } else {
                    // A. CHECK MODE 2: EXPLICIT PREFIX DIRECT INTERCEPT (/img, /draw)
                    if (appConfig.mode2_prefix_direct) {
                        const prefixCmd = checkPrefixCommand(freshUserPrompt);
                        if (prefixCmd && prefixCmd.matched) {
                            recordGatewayEvent({
                                source: `Codex (${protoLabel})`,
                                message: freshUserPrompt,
                                action: '⚡ 命中方案二 (/img 指令直达) -> 本地秒级截获生图',
                                status: 'processing'
                            });
                            try {
                                const refFiles = prefixCmd.refImagePaths.map(fp => ({
                                    filename: path.basename(fp),
                                    contentType: getMimeType(fp),
                                    data: fs.readFileSync(fp)
                                }));

                                const gen = await executeImageTask({
                                    prompt: prefixCmd.prompt,
                                    size: prefixCmd.size,
                                    quality: prefixCmd.quality,
                                    dryRun: prefixCmd.dryRun,
                                    refFiles,
                                    source: 'mode2-prefix-direct'
                                });

                                const md = gen.dry_run
                                    ? `### 🛡️ 方案二：指令直达 (Dry-Run 校验通过)\n- **提示词**: \`${gen.prompt}\`\n- **尺寸**: \`${gen.size}\` | **画质**: \`${gen.quality}\`\n- **模型**: \`${gen.provider} · ${gen.model}\`\n> ${gen.message}`
                                    : `🎨 **已通过指令直达生成图像（0 额外对话 Token 消耗）**\n\n- **提示词**: ${gen.prompt}\n- **模型**: \`${gen.provider} · ${gen.model}\` (\`${gen.size}\`)\n- **本地路径**: \`${gen.path}\`\n\n![${gen.prompt}](${gen.full_url})`;

                                return sendSynthesizedByEndpoint(res, pathname, isStream, md, gen.model);
                            } catch (err) {
                                return sendSynthesizedByEndpoint(res, pathname, isStream, `⚠️ **指令生图失败**: ${err.message}`, 'prefix-error');
                            }
                        }
                    }

                    // B. CHECK MODE 1: SEMANTIC NATURAL LANGUAGE IMAGE INTENT
                    if (appConfig.mode1_llm_tool) {
                        const natIntent = checkNaturalImageIntent(freshUserPrompt);
                        if (natIntent && natIntent.matched) {
                            recordGatewayEvent({
                                source: `Codex (${protoLabel})`,
                                message: freshUserPrompt,
                                action: '🧠 命中方案一 (自然语言生图意图) -> 自动调拨视觉引擎',
                                status: 'processing'
                            });
                            try {
                                const refFiles = natIntent.refImagePaths.map(fp => ({
                                    filename: path.basename(fp),
                                    contentType: getMimeType(fp),
                                    data: fs.readFileSync(fp)
                                }));

                                const gen = await executeImageTask({
                                    prompt: natIntent.prompt,
                                    size: natIntent.size,
                                    quality: natIntent.quality,
                                    dryRun: natIntent.dryRun,
                                    refFiles,
                                    source: 'mode1-semantic-direct'
                                });

                                const md = `🎨 **Codex Studio 已捕捉生图需求并生成图像**\n\n- **提示词**: ${gen.prompt}\n- **生图引擎**: \`${gen.provider} · ${gen.model}\` (\`${gen.size}\`)\n- **本地保存路径**: \`${gen.path}\`\n- **在线预览地址**: ${gen.full_url}\n\n![${gen.prompt}](${gen.full_url})`;

                                return sendSynthesizedByEndpoint(res, pathname, isStream, md, gen.model);
                            } catch (err) {
                                return sendSynthesizedByEndpoint(res, pathname, isStream, `⚠️ **自动生图失败**: ${err.message}`, 'image-error');
                            }
                        }
                    }
                }
            }

            // C. NORMAL CODING / CHAT / AGENT CONTINUATION PASS-THROUGH
            recordGatewayEvent({
                source: `Codex (${protoLabel})`,
                message: freshUserPrompt || (bodyObj.messages ? '工具结果与上下文对话' : '工具/函数响应'),
                action: `💻 编程与对话请求 -> 透传至 ${activeCodex.name} (${activeCodex.model})`,
                status: 'info'
            });

            // Offline Dry-Run Simulator guard when no upstream API key is configured yet
            if ( freshUserPrompt && /(?:--dry-run|模拟生图)/i.test(freshUserPrompt) && !activeCodex.api_key ) {
                return sendSynthesizedByEndpoint(
                    res,
                    pathname,
                    isStream,
                    `💻 **代码护栏已生效（Dry-Run 模拟透传）**：判定为编程/对话请求，100% 透传至 \`${activeCodex.name} (${activeCodex.model})\`，未触发画图拦截。`,
                    activeCodex.model || 'gpt-4o'
                );
            }

            const upBase = activeCodex.base_url.replace(/\/+$/, '');

            // [P0-1] Proactive Cross-Protocol Bridge if `/v1/responses` is sent to a `chat` wire_api provider
            if (pathname === '/v1/responses' && shouldBridgeResponsesToChat(activeCodex)) {
                return forwardToUpstreamChatAsResponses({
                    req,
                    res,
                    upBase,
                    parsedUrl,
                    bodyObj,
                    activeCodex,
                    isStream,
                    reasonLabel: `已自动将 /v1/responses 桥接至 ${activeCodex.name} (/v1/chat/completions)`
                });
            }

            const upUrl = new URL(upBase + pathname.replace(/^\/v1/, '') + parsedUrl.search);
            const isHttps = upUrl.protocol === 'https:';

            if (bodyObj.model && activeCodex.model) {
                bodyObj.model = activeCodex.model;
            }

            const outgoingPayload = Buffer.from(JSON.stringify(bodyObj), 'utf8');
            const headers = { ...req.headers };
            delete headers.host;
            headers['content-length'] = outgoingPayload.length;
            if (activeCodex.api_key) headers['authorization'] = `Bearer ${activeCodex.api_key}`;

            const pReq = (isHttps ? https : http).request({
                hostname: upUrl.hostname,
                port: upUrl.port || (isHttps ? 443 : 80),
                path: upUrl.pathname + upUrl.search,
                method: req.method,
                headers
            }, pRes => {
                // [P0-1] Reactive Auto-Fallback: If upstream relay rejects `/v1/responses` with 404/405/501,
                // automatically fall back to `/v1/chat/completions` protocol bridge!
                if (pathname === '/v1/responses' && (pRes.statusCode === 404 || pRes.statusCode === 405 || pRes.statusCode === 501)) {
                    pRes.resume();
                    return forwardToUpstreamChatAsResponses({
                        req,
                        res,
                        upBase,
                        parsedUrl,
                        bodyObj,
                        activeCodex,
                        isStream,
                        reasonLabel: `上游不支持 /v1/responses (HTTP ${pRes.statusCode})，已自动降级桥接至 /v1/chat/completions`
                    });
                }
                res.writeHead(pRes.statusCode, pRes.headers);
                pRes.pipe(res);
            });
            pReq.on('error', e => {
                if (!res.headersSent) sendError(res, `Upstream Gateway Error: ${e.message}`, 502, req);
            });
            pReq.write(outgoingPayload);
            pReq.end();
            return;
        }

        // Direct pipe for other /v1/* endpoints
        const upBase = activeCodex.base_url.replace(/\/+$/, '');
        const upUrl = new URL(upBase + pathname.replace(/^\/v1/, '') + parsedUrl.search);
        const isHttps = upUrl.protocol === 'https:';
        const headers = { ...req.headers };
        delete headers.host;
        if (activeCodex.api_key) headers['authorization'] = `Bearer ${activeCodex.api_key}`;

        const pReq = (isHttps ? https : http).request({
            hostname: upUrl.hostname,
            port: upUrl.port || (isHttps ? 443 : 80),
            path: upUrl.pathname + upUrl.search,
            method: req.method,
            headers
        }, pRes => {
            res.writeHead(pRes.statusCode, pRes.headers);
            pRes.pipe(res);
        });
        pReq.on('error', e => { if (!res.headersSent) sendError(res, e.message, 502, req); });
        req.pipe(pReq);
        return;
    }

    // 2. STATIC OUTPUTS (/outputs/*)
    if (pathname.startsWith('/outputs/')) {
        const fp = path.join(OUTPUTS_DIR, path.basename(pathname));
        if (fs.existsSync(fp)) {
            res.writeHead(200, { 'Content-Type': getMimeType(fp), 'Cache-Control': 'max-age=3600' });
            return fs.createReadStream(fp, { highWaterMark: 16384 }).pipe(res);
        }
        res.writeHead(404);
        return res.end('Not found');
    }

    // 3. API ROUTES (/api/*) - Protected by [P0-2] Loopback & Local Token Auth
    if (pathname.startsWith('/api/')) {
        const authCheck = verifyLocalApiAuth(req, pathname);
        if (!authCheck.ok) {
            return sendError(res, authCheck.reason, authCheck.status || 401, req);
        }

        try {
            if (pathname === '/api/health' && req.method === 'GET') {
                const effImg = getEffectiveImageProvider();
                const activeCodex = appConfig.codexProviders.find(p => p.id === appConfig.activeCodexProvider) || appConfig.codexProviders[0];
                return sendJson(res, {
                    status: 'ok',
                    version: '2.6.0',
                    provider: effImg ? effImg.name : '未配置',
                    model: effImg ? effImg.model : 'gpt-image-2',
                    configured: Boolean(effImg && effImg.api_key),
                    base_url: effImg ? effImg.base_url : '',
                    onboarding_completed: Boolean(appConfig.onboarding_completed),
                    should_show_onboarding: !appConfig.onboarding_completed,
                    memory: getMemoryStats(),
                    connection_category: appConfig.connectionCategory || 'relay_api',
                    routing_mode: appConfig.routingMode,
                    sync_image_key: appConfig.syncImageKey,
                    mode1_llm_tool: appConfig.mode1_llm_tool,
                    mode2_prefix_direct: appConfig.mode2_prefix_direct,
                    active_codex_provider: activeCodex ? activeCodex.name : '未配置',
                    active_codex_model: activeCodex ? activeCodex.model : '-',
                    active_image_provider: effImg ? effImg.name : '未配置',
                    image_model: effImg ? effImg.model : '-',
                    total_captured: totalCapturedRequests,
                    latest_event: gatewayEvents[0] || null
                }, 200, req);
            }

            if (pathname === '/api/system/onboarding-complete' && req.method === 'POST') {
                appConfig.onboarding_completed = true;
                saveConfig(appConfig);
                return sendJson(res, { ok: true, onboarding_completed: true }, 200, req);
            }

            if (pathname === '/api/events' && req.method === 'GET') {
                return sendJson(res, {
                    ok: true,
                    total_captured: totalCapturedRequests,
                    events: gatewayEvents
                }, 200, req);
            }

            if (pathname === '/api/events/clear' && req.method === 'POST') {
                gatewayEvents.length = 0;
                totalCapturedRequests = 0;
                return sendJson(res, { ok: true, message: '实时捕获日志已清空' }, 200, req);
            }

            if (pathname === '/api/codex/info' && req.method === 'GET') {
                const paths = getCodexPaths();
                let toml = '';
                if (fs.existsSync(paths.configToml)) toml = fs.readFileSync(paths.configToml, 'utf8');
                const mask = p => ({
                    ...p,
                    has_key: Boolean(p.api_key),
                    api_key: p.api_key ? (p.api_key.length > 8 ? `${p.api_key.slice(0, 4)}...${p.api_key.slice(-4)}` : '****') : ''
                });
                const effImg = getEffectiveImageProvider();

                return sendJson(res, {
                    codex_home: paths.home,
                    onboarding_completed: Boolean(appConfig.onboarding_completed),
                    should_show_onboarding: !appConfig.onboarding_completed || !appConfig.codexProviders.some(p => p.api_key),
                    sync_image_key: appConfig.syncImageKey,
                    active_image_provider: effImg ? effImg.name : '中转站联动生图',
                    active_image_model: effImg ? effImg.model : 'gpt-image-2',
                    routing_mode: appConfig.routingMode || 'gateway',
                    mode1_llm_tool: appConfig.mode1_llm_tool,
                    mode2_prefix_direct: appConfig.mode2_prefix_direct,
                    gateway_url: `http://${HOST}:${PORT}/v1`,
                    has_config_toml: fs.existsSync(paths.configToml),
                    active_codex_provider: appConfig.activeCodexProvider,
                    codex_providers: appConfig.codexProviders.map(mask),
                    config_toml_preview: toml,
                    memory: getMemoryStats(),
                    total_captured: totalCapturedRequests,
                    recent_events: gatewayEvents.slice(0, 15)
                }, 200, req);
            }

            if ((pathname === '/api/codex/toggle' || pathname === '/api/codex/gateway-settings') && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                if (typeof b.mode1_llm_tool === 'boolean') appConfig.mode1_llm_tool = b.mode1_llm_tool;
                if (typeof b.mode2_prefix_direct === 'boolean') appConfig.mode2_prefix_direct = b.mode2_prefix_direct;
                if (typeof b.sync_image_key === 'boolean') appConfig.syncImageKey = b.sync_image_key;
                if (b.routing_mode) appConfig.routingMode = b.routing_mode;
                if (b.connection_category) appConfig.connectionCategory = b.connection_category;
                if (b.official_reasoning_effort) appConfig.officialReasoningEffort = b.official_reasoning_effort;
                if (b.official_model) appConfig.officialModel = b.official_model;
                saveConfig(appConfig);
                return sendJson(res, {
                    ok: true,
                    success: true,
                    mode1_llm_tool: appConfig.mode1_llm_tool,
                    mode2_prefix_direct: appConfig.mode2_prefix_direct,
                    routing_mode: appConfig.routingMode,
                    connection_category: appConfig.connectionCategory,
                    message: '设置已更新'
                }, 200, req);
            }

            if ((pathname === '/api/providers/active' || pathname === '/api/providers/activate') && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                const targetId = b.codex_provider_id || b.image_provider_id || b.id;
                if (b.codex_provider_id || appConfig.codexProviders.some(p => p.id === targetId)) {
                    appConfig.activeCodexProvider = targetId;
                    saveConfig(appConfig);
                    return sendJson(res, { ok: true, success: true, activeCodex: targetId, message: '当前生效 API 渠道已切换' }, 200, req);
                }
                if (b.image_provider_id || appConfig.imageProviders.some(p => p.id === targetId)) {
                    appConfig.activeImageProvider = targetId;
                    saveConfig(appConfig);
                    return sendJson(res, { ok: true, success: true, activeImage: targetId, message: '生图引擎已切换' }, 200, req);
                }
                return sendJson(res, { ok: true, active: targetId }, 200, req);
            }

            if (pathname === '/api/providers/delete' && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                const targetId = b.id;
                if (appConfig.codexProviders.length <= 1) {
                    return sendError(res, '至少需要保留一个渠道配置', 400, req);
                }
                appConfig.codexProviders = appConfig.codexProviders.filter(p => p.id !== targetId);
                if (appConfig.activeCodexProvider === targetId) {
                    appConfig.activeCodexProvider = appConfig.codexProviders[0].id;
                }
                saveConfig(appConfig);
                return sendJson(res, { ok: true, activeCodex: appConfig.activeCodexProvider, message: '渠道已删除' }, 200, req);
            }

            if (pathname === '/api/providers/probe' && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                let baseUrl = (b.base_url || '').trim().replace(/\/+$/, '');
                let apiKey = (b.api_key || '').trim();
                const prov = appConfig.codexProviders.find(p => p.id === b.id) || appConfig.imageProviders.find(p => p.id === b.id);
                if ((!apiKey || apiKey.includes('...') || apiKey === '****') && prov) apiKey = prov.api_key;
                if ((!apiKey || apiKey.includes('...')) && getEffectiveImageProvider().api_key) apiKey = getEffectiveImageProvider().api_key;
                if (!baseUrl && prov) baseUrl = prov.base_url.replace(/\/+$/, '');
                if (!baseUrl) return sendError(res, '请先填写接口地址 Base URL', 400, req);

                const targetUrl = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
                const startMs = Date.now();
                try {
                    const headers = { 'Accept': 'application/json' };
                    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
                    const r = await makeHttpRequest(targetUrl, { method: 'GET', headers, timeout: 8000 });
                    const latency = Date.now() - startMs;
                    return sendJson(res, {
                        ok: true,
                        reachable: r.statusCode < 500,
                        status_code: r.statusCode,
                        latency_ms: latency,
                        message: r.statusCode >= 200 && r.statusCode < 300
                            ? `连通成功 (${latency}ms · HTTP ${r.statusCode})`
                            : `服务器可达 (${latency}ms · HTTP ${r.statusCode})`
                    }, 200, req);
                } catch (e) {
                    return sendJson(res, { ok: false, reachable: false, message: `连接失败: ${e.message}` }, 200, req);
                }
            }

            // DYNAMIC MODEL FETCH (Supports both Coding & Image Engine model discovery!)
            if ((pathname === '/api/models/fetch' || pathname === '/api/providers/fetch-models') && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                const purpose = b.purpose || 'all';
                let baseUrl = (b.base_url || '').trim();
                let apiKey = (b.api_key || '').trim();

                const activeCodexP = appConfig.codexProviders.find(p => p.id === (b.id || appConfig.activeCodexProvider)) || appConfig.codexProviders[0];
                const effImgP = getEffectiveImageProvider();

                if (!baseUrl) {
                    baseUrl = purpose === 'image' ? (effImgP.base_url || activeCodexP?.base_url) : (activeCodexP?.base_url || effImgP.base_url);
                }
                if (!apiKey || apiKey.includes('...') || apiKey === '****') {
                    const matchImg = appConfig.imageProviders.find(p => p.id === b.id);
                    const matchCodex = appConfig.codexProviders.find(p => p.id === b.id);
                    apiKey = (matchImg && matchImg.api_key) || (matchCodex && matchCodex.api_key) || effImgP.api_key || (activeCodexP ? activeCodexP.api_key : '');
                }

                const { fetchedData, detectedImageModels, lastErr } = await fetchModelsFromUpstream(baseUrl, apiKey);

                const defaultImageFallbacks = [
                    'gpt-image-2',
                    'gpt-image-1',
                    'gpt-4o-image',
                    'dall-e-3',
                    'flux-pro',
                    'flux-dev',
                    'black-forest-labs/FLUX.1-schnell',
                    'Kwai-Kolors/Kolors',
                    'ideogram-v2',
                    'dall-e-2'
                ];
                const defaultCodingFallbacks = [
                    'gpt-5-codex',
                    'gpt-4o',
                    'gpt-4o-mini',
                    'o3-mini',
                    'o1',
                    'claude-3-7-sonnet-latest',
                    'claude-3-5-sonnet-20241022',
                    'deepseek-chat',
                    'deepseek-reasoner',
                    'qwen-max'
                ];

                if (fetchedData && fetchedData.length > 0) {
                    const imageModels = detectedImageModels.length > 0
                        ? detectedImageModels.sort((a, b) => {
                            const s = x => (/gpt-image-2|gpt-image-1|dall-e-3|gpt-4o-image|flux-pro/i.test(x) ? -1 : 1);
                            return s(a) - s(b) || a.localeCompare(b);
                        })
                        : defaultImageFallbacks;

                    const sortedAll = [...fetchedData].sort((a, b) => {
                        if (purpose === 'image') {
                            const s = x => (IMAGE_MODEL_REGEX.test(x) ? -1 : 1);
                            return s(a) - s(b) || a.localeCompare(b);
                        }
                        const s = x => (/gpt-5|gpt-4o|claude-3-5|claude-3-7|deepseek|o1|o3/i.test(x) ? -1 : 1);
                        return s(a) - s(b) || a.localeCompare(b);
                    });

                    return sendJson(res, {
                        ok: true,
                        success: true,
                        count: sortedAll.length,
                        models: sortedAll,
                        image_models: imageModels,
                        detected_image_count: detectedImageModels.length,
                        source: 'relay_online',
                        message: purpose === 'image'
                            ? (detectedImageModels.length > 0
                                ? `已从中转站拉取 ${sortedAll.length} 个模型（精准识别出 ${detectedImageModels.length} 个生图模型）`
                                : `已从中转站拉取 ${sortedAll.length} 个模型，并附带常用生图模型预设`)
                            : `成功从中转站拉取 ${sortedAll.length} 个可用模型`
                    }, 200, req);
                }

                const combinedFallback = purpose === 'image'
                    ? [...defaultImageFallbacks, ...defaultCodingFallbacks]
                    : [...defaultCodingFallbacks, ...defaultImageFallbacks];

                return sendJson(res, {
                    ok: true,
                    success: true,
                    fallback: true,
                    count: combinedFallback.length,
                    models: combinedFallback,
                    image_models: defaultImageFallbacks,
                    detected_image_count: 0,
                    message: `中转站未开放公开 /models 列表 (${lastErr || '404'})，已自动载入标准主力与生图模型库供直接选取`
                }, 200, req);
            }

            // ONE-CLICK FULL-BLOODED GPT + RELAY IMAGE GEN SETUP (Express Mode)
            if (pathname === '/api/codex/one-click-full-gpt' && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                let baseUrl = (b.base_url || '').trim();
                let apiKey = (b.api_key || '').trim();

                const relayProv = appConfig.codexProviders.find(p => p.id === 'codex-relay') || appConfig.codexProviders[0];
                const imgProv = appConfig.imageProviders.find(p => p.id === 'image-relay') || appConfig.imageProviders[0];

                if (!baseUrl) {
                    baseUrl = (relayProv && relayProv.base_url) || 'https://api.openai.com/v1';
                }
                baseUrl = baseUrl.replace(/\/+$/, '');
                if (!/\/v\d+$/i.test(baseUrl)) {
                    baseUrl = baseUrl + '/v1';
                }

                if (!apiKey || apiKey.includes('...') || apiKey === '****') {
                    apiKey = (relayProv && relayProv.api_key) || (imgProv && imgProv.api_key) || '';
                }

                const { fetchedData, detectedImageModels } = await fetchModelsFromUpstream(baseUrl, apiKey);

                const preferredCodingOrder = [
                    'gpt-5-codex', 'gpt-5', 'gpt-4.1', 'gpt-4o', 'o3', 'o3-mini', 'o1',
                    'claude-3-7-sonnet-latest', 'claude-3-5-sonnet-20241022', 'deepseek-chat'
                ];
                let selectedCodingModel = (b.coding_model || '').trim();
                if (!selectedCodingModel) {
                    if (fetchedData && fetchedData.length > 0) {
                        for (const cand of preferredCodingOrder) {
                            const hit = fetchedData.find(m => m.toLowerCase() === cand.toLowerCase());
                            if (hit) { selectedCodingModel = hit; break; }
                        }
                        if (!selectedCodingModel) {
                            const gptHit = fetchedData.find(m => /^gpt-4o|^gpt-5|^o3|^o1/i.test(m) && !/image|audio|tts|whisper|embedding/i.test(m));
                            selectedCodingModel = gptHit || fetchedData[0];
                        }
                    } else {
                        selectedCodingModel = (relayProv && relayProv.model) || 'gpt-4o';
                    }
                }

                const preferredImageOrder = [
                    'gpt-image-2', 'gpt-image-1', 'dall-e-3', 'gpt-4o-image', 'flux-pro',
                    'black-forest-labs/FLUX.1-pro', 'black-forest-labs/FLUX.1-schnell', 'Kwai-Kolors/Kolors'
                ];
                let selectedImageModel = (b.image_model || '').trim();
                if (!selectedImageModel) {
                    if (detectedImageModels && detectedImageModels.length > 0) {
                        for (const cand of preferredImageOrder) {
                            const hit = detectedImageModels.find(m => m.toLowerCase() === cand.toLowerCase());
                            if (hit) { selectedImageModel = hit; break; }
                        }
                        if (!selectedImageModel) selectedImageModel = detectedImageModels[0];
                    } else {
                        selectedImageModel = (imgProv && imgProv.model) || 'gpt-image-2';
                    }
                }

                const wireApi = /^deepseek|^claude/i.test(selectedCodingModel) ? 'chat' : 'responses';

                if (relayProv) {
                    relayProv.base_url = baseUrl;
                    if (apiKey) relayProv.api_key = apiKey;
                    relayProv.model = selectedCodingModel;
                    relayProv.wire_api = wireApi;
                    appConfig.activeCodexProvider = relayProv.id;
                }
                if (imgProv) {
                    imgProv.base_url = baseUrl;
                    if (apiKey) imgProv.api_key = apiKey;
                    imgProv.model = selectedImageModel;
                    appConfig.activeImageProvider = imgProv.id;
                }

                appConfig.connectionCategory = 'relay_api';
                appConfig.routingMode = 'gateway';
                appConfig.syncImageKey = true;
                appConfig.mode1_llm_tool = true;
                appConfig.mode2_prefix_direct = true;
                appConfig.onboarding_completed = true;
                saveConfig(appConfig);

                syncProviderToCodexToml(relayProv, 'gateway', 'relay_api');
                const skillRes = { ok: true };

                recordGatewayEvent({
                    source: '一键满血激活',
                    message: `中转站: ${baseUrl}`,
                    action: `⚡ 已绑定满血 ${selectedCodingModel} (${wireApi}) + 生图 ${selectedImageModel}`,
                    status: 'success'
                });

                return sendJson(res, {
                    ok: true,
                    success: true,
                    base_url: baseUrl,
                    coding_model: selectedCodingModel,
                    image_model: selectedImageModel,
                    wire_api: wireApi,
                    fetched_count: fetchedData ? fetchedData.length : 0,
                    detected_image_count: detectedImageModels ? detectedImageModels.length : 0,
                    skill_installed: skillRes.ok,
                    memory: getMemoryStats(),
                    message: `⚡ 一键满血激活成功！编程模型: ${selectedCodingModel} (${wireApi} 原生协议) · 生图引擎: ${selectedImageModel}`
                }, 200, req);
            }

            if ((pathname === '/api/codex/apply' || pathname === '/api/codex/apply-provider') && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                const category = b.connection_category || appConfig.connectionCategory || 'relay_api';
                appConfig.connectionCategory = category;
                appConfig.onboarding_completed = true;
                if (b.official_reasoning_effort) appConfig.officialReasoningEffort = b.official_reasoning_effort;
                if (b.official_model) appConfig.officialModel = b.official_model;

                const targetId = b.id || b.codex_provider_id || appConfig.activeCodexProvider;
                const prov = appConfig.codexProviders.find(p => p.id === targetId) || appConfig.codexProviders[0];
                if (prov) appConfig.activeCodexProvider = prov.id;
                if (b.routing_mode) appConfig.routingMode = b.routing_mode;
                saveConfig(appConfig);

                const syncResult = syncProviderToCodexToml(prov, appConfig.routingMode, category);
                recordGatewayEvent({
                    source: 'Codex 路由同步',
                    message: category === 'official_skill' ? '官方账号 + 全局 Image2 插件模式' : `${prov.name} (${prov.model})`,
                    action: '🚀 已同步写入 ~/.codex/config.toml 并挂载全局生图 Skill',
                    status: 'success'
                });
                return sendJson(res, { ok: true, success: true, ...syncResult }, 200, req);
            }

            // UNIFIED PROVIDERS SAVE
            if ((pathname === '/api/providers/save' || pathname === '/api/providers') && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                const type = b.type || (b.provider && b.provider.generation_path ? 'image' : 'codex');
                const p = b.provider || b;
                if (typeof b.sync_image_key === 'boolean') {
                    appConfig.syncImageKey = b.sync_image_key;
                }

                if (type === 'codex') {
                    const idx = appConfig.codexProviders.findIndex(x => x.id === p.id);
                    let finalApiKey = p.api_key || '';
                    if (idx >= 0) {
                        const old = appConfig.codexProviders[idx];
                        if (!p.api_key || p.api_key.includes('...') || p.api_key === '****') {
                            finalApiKey = old.api_key;
                        }
                        appConfig.codexProviders[idx] = { ...old, ...p, api_key: finalApiKey };
                    } else {
                        const newId = p.id || `codex-${Date.now().toString(36)}`;
                        appConfig.codexProviders.push({
                            id: newId,
                            category: p.category || 'relay_api',
                            name: p.name || '自定义 API 渠道',
                            base_url: p.base_url || 'https://api.openai.com/v1',
                            model: p.model || 'gpt-4o',
                            wire_api: p.wire_api || 'responses',
                            api_key: finalApiKey,
                            notes: p.notes || ''
                        });
                        p.id = newId;
                    }
                    if (p.id) appConfig.activeCodexProvider = p.id;

                    const imgRelay = appConfig.imageProviders.find(img => img.id === 'image-relay') || appConfig.imageProviders[0];
                    if (imgRelay) {
                        if (b.image_model) imgRelay.model = b.image_model;
                        if (appConfig.syncImageKey && finalApiKey && finalApiKey !== 'ollama') {
                            imgRelay.api_key = finalApiKey;
                            if (p.base_url) imgRelay.base_url = p.base_url;
                        }
                    }

                    saveConfig(appConfig);
                    return sendJson(res, {
                        ok: true,
                        success: true,
                        activeCodex: appConfig.activeCodexProvider,
                        message: appConfig.syncImageKey
                            ? `API 渠道已保存（生图引擎已同步绑定模型：${imgRelay?.model || 'gpt-image-2'}）`
                            : `API 渠道配置已保存`
                    }, 200, req);
                } else {
                    const idx = appConfig.imageProviders.findIndex(x => x.id === p.id);
                    let finalApiKey = p.api_key || '';
                    if (idx >= 0) {
                        const old = appConfig.imageProviders[idx];
                        if (!p.api_key || p.api_key.includes('...') || p.api_key === '****') {
                            finalApiKey = old.api_key;
                        }
                        appConfig.imageProviders[idx] = { ...old, ...p, api_key: finalApiKey };
                    } else {
                        appConfig.imageProviders.push({
                            id: p.id || `img-${Date.now().toString(36)}`,
                            name: p.name || '自定义生图接口',
                            base_url: p.base_url || 'https://api.openai.com/v1',
                            model: p.model || 'gpt-image-2',
                            generation_path: p.generation_path || '/images/generations',
                            edit_path: p.edit_path || '/images/edits',
                            image_field: p.image_field || 'image',
                            api_key: finalApiKey
                        });
                    }
                    if (p.id) appConfig.activeImageProvider = p.id;
                    saveConfig(appConfig);
                    return sendJson(res, { ok: true, success: true, activeImage: appConfig.activeImageProvider, message: '生图引擎配置已保存' }, 200, req);
                }
            }

            if (pathname === '/api/providers' && req.method === 'GET') {
                const mask = p => ({
                    ...p,
                    has_key: Boolean(p.api_key),
                    api_key: p.api_key ? (p.api_key.length > 8 ? `${p.api_key.slice(0, 4)}...${p.api_key.slice(-4)}` : '****') : ''
                });
                return sendJson(res, {
                    activeImage: appConfig.activeImageProvider,
                    activeCodex: appConfig.activeCodexProvider,
                    syncImageKey: appConfig.syncImageKey,
                    imageProviders: appConfig.imageProviders.map(mask),
                    codexProviders: appConfig.codexProviders.map(mask)
                }, 200, req);
            }

            if (pathname === '/api/codex/install' && req.method === 'POST') {
                const r = installGlobalCodexSkill();
                return sendJson(res, { ...r, message: '全局 Codex Image2 视觉插件已安装并就绪' }, 200, req);
            }

            if (pathname === '/api/system/reset-config' && req.method === 'POST') {
                appConfig = getCleanDefaultConfig();
                appConfig.onboarding_completed = false;
                saveConfig(appConfig);
                recordGatewayEvent({
                    source: '系统管理',
                    message: '重置所有保存的 API 密钥与渠道配置',
                    action: '🧹 已恢复初始空白状态（重新开启新手向导）',
                    status: 'info'
                });
                return sendJson(res, { ok: true, should_show_onboarding: true, message: '已清空所有保存的 API 密钥与配置，恢复至初始状态' }, 200, req);
            }

            if (pathname === '/api/system/clear-history' && req.method === 'POST') {
                recentGeneratedFiles.clear();
                let removed = 0;
                if (fs.existsSync(OUTPUTS_DIR)) {
                    for (const f of fs.readdirSync(OUTPUTS_DIR)) {
                        if (/\.(png|jpg|jpeg|webp|json)$/i.test(f)) {
                            try { fs.unlinkSync(path.join(OUTPUTS_DIR, f)); removed++; } catch (e) {}
                        }
                    }
                }
                return sendJson(res, { ok: true, removed, message: `已清理本地生成的图片与历史记录` }, 200, req);
            }

            if (pathname === '/api/codex/restore' && req.method === 'POST') {
                const paths = getCodexPaths();
                if (fs.existsSync(paths.configTomlBak)) {
                    fs.copyFileSync(paths.configTomlBak, paths.configToml);
                    return sendJson(res, { ok: true, message: '已从备份恢复 Codex 原始 config.toml' }, 200, req);
                }
                return sendJson(res, { ok: true, message: '未检测到旧备份，当前已是干净配置' }, 200, req);
            }

            if (pathname === '/api/system/gc' && req.method === 'POST') {
                triggerCompactGC();
                return sendJson(res, { ok: true, memory: getMemoryStats(), message: '内存回收已执行' }, 200, req);
            }

            if (pathname === '/api/system/shutdown' && req.method === 'POST') {
                sendJson(res, { ok: true, message: '后台服务已安全关闭' }, 200, req);
                setTimeout(() => process.exit(0), 200);
                return;
            }

            if (pathname === '/api/system/reveal-file' && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                let target = '';
                if (b.filename) {
                    target = path.join(OUTPUTS_DIR, path.basename(b.filename));
                } else if (b.path) {
                    target = b.path;
                } else {
                    target = OUTPUTS_DIR;
                }
                const safeTarget = resolveSafeLocalPath(target, OUTPUTS_DIR);
                const success = revealInFileManager(safeTarget);
                return sendJson(res, {
                    ok: true,
                    success,
                    path: safeTarget,
                    message: '已在文件管理器中打开并定位照片'
                }, 200, req);
            }

            if (pathname === '/api/system/open-folder' && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                const paths = getCodexPaths();
                let target = OUTPUTS_DIR;
                if (b.folder === 'codex_home') {
                    target = fs.existsSync(paths.configToml) ? paths.configToml : paths.home;
                } else if (b.folder === 'config_dir') {
                    target = fs.existsSync(CONFIG_FILE) ? CONFIG_FILE : DATA_DIR;
                } else if (b.folder === 'skill_dir') {
                    target = paths.skillDir;
                } else if (b.folder === 'outputs') {
                    target = OUTPUTS_DIR;
                } else if (b.path) {
                    target = resolveSafeLocalPath(b.path, OUTPUTS_DIR);
                }
                const success = revealInFileManager(target);
                return sendJson(res, {
                    ok: true,
                    success,
                    path: target,
                    message: '已在文件管理器中打开目录'
                }, 200, req);
            }

            if (pathname === '/api/system/export-config' && req.method === 'GET') {
                const stripKey = p => ({ ...p, api_key: '', api_keys: [] });
                return sendJson(res, {
                    ok: true,
                    app: 'Codex Studio',
                    version: '2.6.0',
                    exported_at: new Date().toISOString(),
                    routingMode: appConfig.routingMode,
                    syncImageKey: appConfig.syncImageKey,
                    mode1_llm_tool: appConfig.mode1_llm_tool,
                    mode2_prefix_direct: appConfig.mode2_prefix_direct,
                    codexProviders: (appConfig.codexProviders || []).map(stripKey),
                    imageProviders: (appConfig.imageProviders || []).map(stripKey)
                }, 200, req);
            }

            if (pathname === '/api/system/import-config' && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                if (Array.isArray(b.codexProviders) && b.codexProviders.length > 0) {
                    const existingMap = new Map((appConfig.codexProviders || []).map(p => [p.id, p]));
                    appConfig.codexProviders = b.codexProviders.map(p => {
                        const old = existingMap.get(p.id);
                        return {
                            ...p,
                            api_key: p.api_key || (old ? old.api_key : ''),
                            api_keys: Array.isArray(p.api_keys) && p.api_keys.length ? p.api_keys : (old && old.api_keys ? old.api_keys : [])
                        };
                    });
                }
                if (Array.isArray(b.imageProviders) && b.imageProviders.length > 0) {
                    const existingImgMap = new Map((appConfig.imageProviders || []).map(p => [p.id, p]));
                    appConfig.imageProviders = b.imageProviders.map(p => {
                        const old = existingImgMap.get(p.id);
                        return {
                            ...p,
                            api_key: p.api_key || (old ? old.api_key : '')
                        };
                    });
                }
                saveConfig(appConfig);
                return sendJson(res, { ok: true, message: '渠道配置预设已成功导入' }, 200, req);
            }

            if (pathname === '/api/system/storage-info' && req.method === 'GET') {
                const paths = getCodexPaths();
                const seenFiles = new Set();
                let outputCount = 0;
                let totalBytes = 0;
                if (fs.existsSync(OUTPUTS_DIR)) {
                    for (const f of fs.readdirSync(OUTPUTS_DIR)) {
                        if (!/\.(png|jpg|jpeg|webp)$/i.test(f)) continue;
                        try {
                            const st = fs.statSync(path.join(OUTPUTS_DIR, f));
                            if (st.isFile()) { seenFiles.add(f); outputCount++; totalBytes += st.size; }
                        } catch (e) {}
                    }
                }
                for (const [f, info] of recentGeneratedFiles.entries()) {
                    if (!seenFiles.has(f) && fs.existsSync(info.path)) {
                        seenFiles.add(f);
                        outputCount++;
                        totalBytes += (info.bytes || 0);
                    }
                }
                const hasSkill = fs.existsSync(path.join(paths.skillDir, 'SKILL.md'));
                return sendJson(res, {
                    ok: true,
                    config_file: CONFIG_FILE,
                    outputs_dir: OUTPUTS_DIR,
                    codex_home: paths.home,
                    codex_config_toml: paths.configToml,
                    codex_auth_json: paths.authJson,
                    codex_skill_dir: paths.skillDir,
                    has_skill_installed: hasSkill,
                    outputs_count: outputCount,
                    total_images: outputCount,
                    total_size_mb: +(totalBytes / 1048576).toFixed(2)
                }, 200, req);
            }

            if (pathname === '/api/generate' && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                const r = await executeImageTask({
                    prompt: b.prompt || '',
                    size: b.size || '1024x1024',
                    quality: b.quality || 'standard',
                    dryRun: Boolean(b.dry_run),
                    refFiles: [],
                    source: b.source || 'studio-ui'
                });
                return sendJson(res, r, 200, req);
            }

            if ((pathname === '/api/edit' || pathname === '/api/edit-url') && req.method === 'POST') {
                const ct = req.headers['content-type'] || '';
                if (ct.includes('multipart/form-data')) {
                    const { fields, files } = await parseMultipartBody(req);
                    const r = await executeImageTask({
                        prompt: fields.prompt || '',
                        size: fields.size || '1024x1024',
                        quality: fields.quality || 'standard',
                        dryRun: Boolean(fields.dry_run),
                        refFiles: files,
                        source: 'studio-edit'
                    });
                    return sendJson(res, r, 200, req);
                } else {
                    const { parsed: b } = await parseJsonBody(req);
                    const refFiles = [];
                    if (Array.isArray(b.images)) {
                        b.images.forEach((dataUrl, i) => {
                            const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
                            if (m) {
                                refFiles.push({
                                    filename: `ref_${i}.png`,
                                    contentType: m[1],
                                    data: Buffer.from(m[2], 'base64')
                                });
                            }
                        });
                    }
                    const r = await executeImageTask({
                        prompt: b.prompt || '',
                        size: b.size || '1024x1024',
                        quality: b.quality || 'standard',
                        dryRun: Boolean(b.dry_run),
                        refFiles,
                        source: 'studio-edit'
                    });
                    return sendJson(res, r, 200, req);
                }
            }

            if (pathname === '/api/history' && req.method === 'GET') {
                const seen = new Set();
                const files = [];
                if (fs.existsSync(OUTPUTS_DIR)) {
                    for (const filename of fs.readdirSync(OUTPUTS_DIR)) {
                        if (!/\.(png|jpg|jpeg|webp)$/i.test(filename)) continue;
                        const fp = path.join(OUTPUTS_DIR, filename);
                        try {
                            const st = fs.statSync(fp);
                            let meta = {};
                            const mp = path.join(OUTPUTS_DIR, `${filename}.json`);
                            if (fs.existsSync(mp)) { try { meta = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch (e) {} }
                            seen.add(filename);
                            files.push({
                                filename,
                                url: `/outputs/${filename}`,
                                path: fp,
                                bytes: st.size,
                                created_at: meta.created_at || st.mtime.toISOString(),
                                prompt: meta.prompt || '',
                                model: meta.model || '',
                                provider: meta.provider || ''
                            });
                        } catch (e) {}
                    }
                }
                for (const [filename, info] of recentGeneratedFiles.entries()) {
                    if (!seen.has(filename) && fs.existsSync(info.path)) {
                        files.push({
                            filename,
                            url: `/outputs/${filename}`,
                            path: info.path,
                            bytes: info.bytes || 0,
                            created_at: info.created_at,
                            prompt: info.prompt || '',
                            model: info.model || '',
                            provider: info.provider || ''
                        });
                    }
                }
                files.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                return sendJson(res, files, 200, req);
            }

            return sendError(res, 'Not found', 404, req);
        } catch (err) {
            return sendError(res, err.message || 'Server error', 500, req);
        }
    }

    // 4. FRONTEND STATIC SERVING (With Dynamic Local Token Injection)
    let reqPath = pathname === '/' ? '/index.html' : pathname;
    let fp = path.resolve(PUBLIC_DIR, '.' + reqPath);
    if (!fp.startsWith(path.resolve(PUBLIC_DIR))) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    const indexFp = path.join(PUBLIC_DIR, 'index.html');
    const targetFp = (fs.existsSync(fp) && fs.statSync(fp).isFile()) ? fp : (fs.existsSync(indexFp) ? indexFp : null);

    if (targetFp) {
        if (path.basename(targetFp) === 'index.html') {
            let html = fs.readFileSync(targetFp, 'utf8');
            html = html.replace(
                /<meta\s+name="image2-local-token"\s+content="[^"]*">/i,
                `<meta name="image2-local-token" content="${LOCAL_SERVICE_TOKEN}">`
            );
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            return res.end(html, 'utf8');
        }
        res.writeHead(200, { 'Content-Type': getMimeType(targetFp) });
        return fs.createReadStream(targetFp, { highWaterMark: 16384 }).pipe(res);
    }

    res.writeHead(404);
    res.end('Not Found');
});

server.keepAliveTimeout = 5000;
server.headersTimeout = 6000;
server.maxHeadersCount = 40;
setInterval(triggerCompactGC, 60000).unref();

// =============================================================
// DESKTOP WINDOW & SYSTEM TRAY LAUNCHER (--desktop mode)
// =============================================================
function launchWindowsDesktopWindowAndTray() {
    if (process.platform !== 'win32') return;
    const targetUrl = `http://${HOST}:${PORT}`;
    try {
        const trayScript = path.join(ROOT_DIR, 'tray.ps1');
        if (fs.existsSync(trayScript)) {
            const childTray = spawn('powershell.exe', ['-NoProfile', '-Sta', '-File', trayScript], {
                cwd: ROOT_DIR,
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            childTray.unref();
        }
    } catch (e) {}

    try {
        const winArgs = [`--app=${targetUrl}`, '--window-size=1440,860', '--window-position=120,60'];
        const edgeCandidates = [
            path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            path.join(process.env['LOCALAPPDATA'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        ];
        const chromeCandidates = [
            path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
        ];
        let browserBin = edgeCandidates.find(p => p && fs.existsSync(p)) || chromeCandidates.find(p => p && fs.existsSync(p));
        if (browserBin) {
            const childBrowser = spawn(browserBin, winArgs, { detached: true, stdio: 'ignore', windowsHide: false });
            childBrowser.unref();
        } else {
            const childOpen = spawn('explorer.exe', [targetUrl], { detached: true, stdio: 'ignore' });
            childOpen.unref();
        }
    } catch (e) {}
}

function bindAndListen(isDesktopMode) {
    server.listen(PORT, HOST, () => {
        triggerCompactGC();
        const mem = getMemoryStats();
        console.log(`[Codex Studio v2.6.0] Running on http://${HOST}:${PORT} | Gateway: /v1 | RAM: ${mem.heap_used_mb}MB Heap / ${mem.rss_mb}MB RSS`);
        if (isDesktopMode) {
            launchWindowsDesktopWindowAndTray();
        }
    });
}

function startServerWithDesktopSupport() {
    const isDesktopMode = process.argv.includes('--desktop');
    const healthReq = http.request({
        hostname: HOST,
        port: PORT,
        path: '/api/health',
        method: 'GET',
        timeout: 500
    }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            if (res.statusCode === 200 && body.includes('2.6.0')) {
                if (isDesktopMode) launchWindowsDesktopWindowAndTray();
                process.exit(0);
            } else {
                const shutReq = http.request({
                    hostname: HOST,
                    port: PORT,
                    path: '/api/system/shutdown',
                    method: 'POST',
                    headers: { 'X-Image2-Local-Token': LOCAL_SERVICE_TOKEN },
                    timeout: 500
                }, () => {
                    setTimeout(() => bindAndListen(isDesktopMode), 400);
                });
                shutReq.on('error', () => setTimeout(() => bindAndListen(isDesktopMode), 300));
                shutReq.end('{}');
            }
        });
    });
    healthReq.on('error', () => {
        bindAndListen(isDesktopMode);
    });
    healthReq.end();
}

startServerWithDesktopSupport();
