/**
 * Codex Studio (v2.5.0) - AI Gateway & Visual Engine Micro-Kernel
 *
 * v2.5.0 Key Upgrades:
 *  - Fix Repeat Request & Loop Trap: Added `getFreshUserPrompt` ensuring gateway
 *    ONLY intercepts when the newest terminal message is a fresh user prompt.
 *    Intermediate tool returns (function_call_output, role: tool) and assistant continuations
 *    are 100% transparently passed through to upstream LLM, preventing re-trigger loops.
 *  - 2.5-Second Request Deduplication: In-memory debounce prevents duplicate parallel generations.
 *  - Event Toast Notification Sanitization: Pass-through chat turns are logged silently as 'info',
 *    preventing screen notification spam during multi-turn Codex tool sessions.
 *  - gpt-image-2 and online relay image model prioritization & auto-fallback.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { URL } = require('url');
const { exec, spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 8765;
const HOST = '127.0.0.1';
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const OUTPUTS_DIR = path.join(ROOT_DIR, 'outputs');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const TOKEN_FILE = path.join(ROOT_DIR, '.image2-token');

[DATA_DIR, OUTPUTS_DIR, PUBLIC_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// Ensure service token exists
let LOCAL_SERVICE_TOKEN = 'AguLw4mZOaKQiKkm5I8V-K8545Dao7LysiUr-2edpqg';
if (fs.existsSync(TOKEN_FILE)) {
    try {
        const t = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
        if (t) LOCAL_SERVICE_TOKEN = t;
    } catch (e) {}
} else {
    try { fs.writeFileSync(TOKEN_FILE, LOCAL_SERVICE_TOKEN, 'utf8'); } catch (e) {}
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
// Cross-Platform File Manager Reveal & Folder Opening
// -------------------------------------------------------------
function revealInFileManager(targetPath) {
    if (!targetPath) targetPath = OUTPUTS_DIR;
    let absPath = path.isAbsolute(targetPath) ? targetPath : path.join(OUTPUTS_DIR, targetPath);
    if (!fs.existsSync(absPath)) {
        absPath = OUTPUTS_DIR;
    }
    const isFile = fs.existsSync(absPath) && fs.statSync(absPath).isFile();
    try {
        if (process.platform === 'win32') {
            const winPath = absPath.replace(/\//g, '\\');
            if (isFile) {
                exec(`explorer.exe /select,"${winPath}"`);
            } else {
                exec(`explorer.exe "${winPath}"`);
            }
            return true;
        } else if (process.platform === 'darwin') {
            if (isFile) {
                spawn('open', ['-R', absPath], { detached: true, stdio: 'ignore' });
            } else {
                spawn('open', [absPath], { detached: true, stdio: 'ignore' });
            }
            return true;
        } else {
            const dir = isFile ? path.dirname(absPath) : absPath;
            try { spawn('xdg-open', [dir], { detached: true, stdio: 'ignore' }).on('error', () => {}); } catch (e) {}
            return true;
        }
    } catch (e) {
        return false;
    }
}

function openDirectoryInFileManager(targetDir) {
    if (!targetDir) targetDir = OUTPUTS_DIR;
    let absPath = path.isAbsolute(targetDir) ? targetDir : path.join(ROOT_DIR, targetDir);
    if (!fs.existsSync(absPath)) {
        absPath = ROOT_DIR;
    }
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
                name: '聚合中转站 (OneAPI / NewAPI)',
                base_url: 'https://api.openai-proxy.org/v1',
                model: 'gpt-4o',
                wire_api: 'responses',
                api_key: '',
                api_keys: [],
                notes: '兼容所有标准中转站 · 支持在线拉取模型与一Key双用生图'
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
                id: 'codex-silicon',
                category: 'claude_relay',
                badge: 'Claude / 硅基',
                name: 'Claude 专线 / 硅基流动',
                base_url: 'https://api.siliconflow.cn/v1',
                model: 'claude-3-5-sonnet-20241022',
                wire_api: 'chat',
                api_key: '',
                api_keys: [],
                notes: 'Claude 3.5 Sonnet 及开源大模型聚合'
            }
        ],
        imageProviders: [
            {
                id: 'image-relay',
                name: '中转站联动生图引擎 (一Key双用)',
                base_url: 'https://api.openai-proxy.org/v1',
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
                id: 'image-flux',
                name: 'FLUX.1 Pro / 第三方独立生图接口',
                base_url: 'https://api.siliconflow.cn/v1',
                model: 'black-forest-labs/FLUX.1-pro',
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
   - On Windows: \`"%CODEX_HOME%\\skills\\image2\\Image2CLI.exe" --prompt "<optimized prompt>"\` (or \`python "%CODEX_HOME%\\skills\\image2\\image2_cli.py" --prompt "<optimized prompt>"\`)
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
    token = "AguLw4mZOaKQiKkm5I8V-K8545Dao7LysiUr-2edpqg"
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

        const cliCandidates = [
            path.join(ROOT_DIR, 'Image2Studio', 'Image2Studio', 'Image2CLI.exe'),
            path.join(ROOT_DIR, 'Image2Studio', 'Image2CLI.exe'),
            path.join(ROOT_DIR, 'Image2CLI.exe')
        ];
        let copiedExe = false;
        for (const cand of cliCandidates) {
            if (fs.existsSync(cand)) {
                try {
                    fs.copyFileSync(cand, path.join(skillDir, 'Image2CLI.exe'));
                    copiedExe = true;
                    break;
                } catch (e) {}
            }
        }

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
            has_cli_exe: copiedExe || fs.existsSync(path.join(skillDir, 'Image2CLI.exe')),
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
 *
 * If the latest item is a tool result (e.g. role: 'tool', function_call_output),
 * an assistant continuation, or an internal agent turn:
 * Returns null so the gateway NEVER re-intercepts old user messages on continuation turns!
 */
function getFreshUserPrompt(body) {
    if (!body || typeof body !== 'object') return null;

    // 1. Chat Completions API (body.messages)
    if (Array.isArray(body.messages) && body.messages.length > 0) {
        const lastMsg = body.messages[body.messages.length - 1];
        if (!lastMsg || lastMsg.role !== 'user') {
            // Not a fresh user turn! (It is a tool response, assistant message, or system message)
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

        // If the last item is a tool response or function call output -> NOT a fresh user prompt!
        if (lastItem.type === 'function_call_output' || lastItem.type === 'tool_response' || lastItem.type === 'item_reference') {
            return null;
        }
        // If the last item is from the assistant -> NOT a fresh user prompt!
        if (lastItem.role === 'assistant' || lastItem.type === 'reasoning') {
            return null;
        }

        // Only genuine user messages
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

// Fallback helper for display/logging only
function extractLastUserMessage(body) {
    const fresh = getFreshUserPrompt(body);
    if (fresh) return fresh;

    if (!body) return '';
    if (Array.isArray(body.messages)) {
        for (let i = body.messages.length - 1; i >= 0; i--) {
            const m = body.messages[i];
            if (m && m.role === 'user') {
                if (typeof m.content === 'string') return m.content;
                if (Array.isArray(m.content)) {
                    return m.content.map(p => p.text || p.input_text || '').filter(Boolean).join('\n');
                }
            }
        }
    }
    if (typeof body.input === 'string') return body.input;
    if (Array.isArray(body.input)) {
        for (let i = body.input.length - 1; i >= 0; i--) {
            const it = body.input[i];
            if (!it) continue;
            if (it.role === 'user') {
                if (typeof it.content === 'string') return it.content;
                if (Array.isArray(it.content)) {
                    const txt = it.content.map(p => (typeof p === 'string' ? p : p.text || p.input_text || '')).filter(Boolean).join('\n');
                    if (txt) return txt;
                }
            }
        }
    }
    return '';
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
        base_url: 'https://api.openai-proxy.org/v1',
        model: 'gpt-image-2',
        generation_path: '/images/generations',
        edit_path: '/images/edits',
        image_field: 'image',
        api_key: ''
    }) };

    if ((appConfig.syncImageKey || !resolved.api_key) && activeCodex && activeCodex.api_key && activeCodex.api_key !== 'ollama') {
        resolved.api_key = activeCodex.api_key;
        if (activeCodex.base_url && (appConfig.syncImageKey || !resolved.base_url || resolved.base_url.includes('openai-proxy.org') || resolved.base_url.includes('api.openai.com'))) {
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
            const headers = { 'Accept': 'application/json', 'User-Agent': 'CodexStudio/2.5.0' };
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
                'User-Agent': 'CodexStudio/2.5.0',
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

        // Retry with 1024x1024 if custom size was rejected
        if (apiRes.statusCode !== 200 && size !== '1024x1024' && !JSON.stringify(apiRes.body || '').includes('model_not_found')) {
            apiRes = await callGenerationsWithModel(usedModel, '1024x1024');
        }

        // SMART AUTO-FALLBACK: If relay returned model_not_found / No available channel (e.g. dall-e-3 not in user's group)
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
                    // Save discovered working model into appConfig!
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
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
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
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
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
// NETWORK HELPERS
// =============================================================
function sendJson(res, data, status = 200) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Image2-Local-Token',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
    });
    res.end(JSON.stringify(data));
}

function sendError(res, msg, status = 400) {
    sendJson(res, { error: msg, detail: msg, ok: false }, status);
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

// =============================================================
// SERVER CORE & ROUTER
// =============================================================
const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Image2-Local-Token',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
        });
        return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || HOST}`);
    const pathname = parsedUrl.pathname;

    // 1. CODEX GATEWAY (/v1/chat/completions & /v1/responses)
    if (pathname.startsWith('/v1/')) {
        const activeCodex = appConfig.codexProviders.find(p => p.id === appConfig.activeCodexProvider) || appConfig.codexProviders[0];
        if (!activeCodex) return sendError(res, 'No active Codex provider', 502);

        const isChatOrResp = (pathname === '/v1/chat/completions' || pathname === '/v1/responses') && req.method === 'POST';
        if (isChatOrResp) {
            const { parsed: bodyObj } = await parseJsonBody(req);
            const freshUserPrompt = getFreshUserPrompt(bodyObj);
            const isStream = Boolean(bodyObj.stream);
            const protoLabel = pathname === '/v1/responses' ? 'Responses API' : 'Chat API';

            // Only inspect for interception if this is a genuine, fresh user prompt!
            // (If the last item in input/messages is a tool return, assistant continuation, or system message: skip interception!)
            if (freshUserPrompt) {
                // Check in-memory deduplication (e.g. double-submitted within 2.5s)
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
            // Log as audit event only (status: 'info'), without triggering alarming popup toasts!
            recordGatewayEvent({
                source: `Codex (${protoLabel})`,
                message: freshUserPrompt || (bodyObj.messages ? '工具结果与上下文对话' : '工具/函数响应'),
                action: `💻 编程与对话请求 -> 透传至 ${activeCodex.name} (${activeCodex.model})`,
                status: 'info'
            });

            const upBase = activeCodex.base_url.replace(/\/+$/, '');
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
                res.writeHead(pRes.statusCode, pRes.headers);
                pRes.pipe(res);
            });
            pReq.on('error', e => {
                if (!res.headersSent) sendError(res, `Upstream Gateway Error: ${e.message}`, 502);
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
        pReq.on('error', e => { if (!res.headersSent) sendError(res, e.message, 502); });
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

    // 3. API ROUTES (/api/*)
    if (pathname.startsWith('/api/')) {
        try {
            if (pathname === '/api/health' && req.method === 'GET') {
                const effImg = getEffectiveImageProvider();
                const activeCodex = appConfig.codexProviders.find(p => p.id === appConfig.activeCodexProvider) || appConfig.codexProviders[0];
                return sendJson(res, {
                    status: 'ok',
                    version: '2.5.0',
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
                });
            }

            if (pathname === '/api/system/onboarding-complete' && req.method === 'POST') {
                appConfig.onboarding_completed = true;
                saveConfig(appConfig);
                return sendJson(res, { ok: true, onboarding_completed: true });
            }

            if (pathname === '/api/events' && req.method === 'GET') {
                return sendJson(res, {
                    ok: true,
                    total_captured: totalCapturedRequests,
                    events: gatewayEvents
                });
            }

            if (pathname === '/api/events/clear' && req.method === 'POST') {
                gatewayEvents.length = 0;
                totalCapturedRequests = 0;
                return sendJson(res, { ok: true, message: '实时捕获日志已清空' });
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
                });
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
                });
            }

            if ((pathname === '/api/providers/active' || pathname === '/api/providers/activate') && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                const targetId = b.codex_provider_id || b.image_provider_id || b.id;
                if (b.codex_provider_id || appConfig.codexProviders.some(p => p.id === targetId)) {
                    appConfig.activeCodexProvider = targetId;
                    saveConfig(appConfig);
                    return sendJson(res, { ok: true, success: true, activeCodex: targetId, message: '当前生效 API 渠道已切换' });
                }
                if (b.image_provider_id || appConfig.imageProviders.some(p => p.id === targetId)) {
                    appConfig.activeImageProvider = targetId;
                    saveConfig(appConfig);
                    return sendJson(res, { ok: true, success: true, activeImage: targetId, message: '生图引擎已切换' });
                }
                return sendJson(res, { ok: true, active: targetId });
            }

            if (pathname === '/api/providers/delete' && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                const targetId = b.id;
                if (appConfig.codexProviders.length <= 1) {
                    return sendError(res, '至少需要保留一个渠道配置', 400);
                }
                appConfig.codexProviders = appConfig.codexProviders.filter(p => p.id !== targetId);
                if (appConfig.activeCodexProvider === targetId) {
                    appConfig.activeCodexProvider = appConfig.codexProviders[0].id;
                }
                saveConfig(appConfig);
                return sendJson(res, { ok: true, activeCodex: appConfig.activeCodexProvider, message: '渠道已删除' });
            }

            if (pathname === '/api/providers/probe' && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                let baseUrl = (b.base_url || '').trim().replace(/\/+$/, '');
                let apiKey = (b.api_key || '').trim();
                const prov = appConfig.codexProviders.find(p => p.id === b.id) || appConfig.imageProviders.find(p => p.id === b.id);
                if ((!apiKey || apiKey.includes('...') || apiKey === '****') && prov) apiKey = prov.api_key;
                if ((!apiKey || apiKey.includes('...')) && getEffectiveImageProvider().api_key) apiKey = getEffectiveImageProvider().api_key;
                if (!baseUrl && prov) baseUrl = prov.base_url.replace(/\/+$/, '');
                if (!baseUrl) return sendError(res, '请先填写接口地址 Base URL', 400);

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
                    });
                } catch (e) {
                    return sendJson(res, { ok: false, reachable: false, message: `连接失败: ${e.message}` });
                }
            }

            // DYNAMIC MODEL FETCH (Supports both Coding & Image Engine model discovery!)
            if ((pathname === '/api/models/fetch' || pathname === '/api/providers/fetch-models') && req.method === 'POST') {
                const { parsed: b } = await parseJsonBody(req);
                const purpose = b.purpose || 'all'; // 'codex' | 'image' | 'all'
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
                    });
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
                });
            }

            // APPLY TO CODEX CONFIG.TOML & GLOBAL SKILL
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
                return sendJson(res, { ok: true, success: true, ...syncResult });
            }

            // UNIFIED PROVIDERS SAVE (With Auto Sync to Image Provider + Image Model Override)
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
                            base_url: p.base_url || 'https://api.openai-proxy.org/v1',
                            model: p.model || 'gpt-4o',
                            wire_api: p.wire_api || 'responses',
                            api_key: finalApiKey,
                            notes: p.notes || ''
                        });
                        p.id = newId;
                    }
                    if (p.id) appConfig.activeCodexProvider = p.id;

                    // Sync key, base_url, and optional image_model to image-relay provider
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
                    });
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
                            base_url: p.base_url || 'https://api.openai-proxy.org/v1',
                            model: p.model || 'gpt-image-2',
                            generation_path: p.generation_path || '/images/generations',
                            edit_path: p.edit_path || '/images/edits',
                            image_field: p.image_field || 'image',
                            api_key: finalApiKey
                        });
                    }
                    if (p.id) appConfig.activeImageProvider = p.id;
                    saveConfig(appConfig);
                    return sendJson(res, { ok: true, success: true, activeImage: appConfig.activeImageProvider, message: '生图引擎配置已保存' });
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
                });
            }

            if (pathname === '/api/codex/install' && req.method === 'POST') {
                const r = installGlobalCodexSkill();
                return sendJson(res, { ...r, message: '全局 Codex Image2 视觉插件已安装并就绪' });
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
                return sendJson(res, { ok: true, should_show_onboarding: true, message: '已清空所有保存的 API 密钥与配置，恢复至初始状态' });
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
                return sendJson(res, { ok: true, removed, message: `已清理本地生成的图片与历史记录` });
            }

            if (pathname === '/api/codex/restore' && req.method === 'POST') {
                const paths = getCodexPaths();
                if (fs.existsSync(paths.configTomlBak)) {
                    fs.copyFileSync(paths.configTomlBak, paths.configToml);
                    return sendJson(res, { ok: true, message: '已从备份恢复 Codex 原始 config.toml' });
                }
                return sendJson(res, { ok: true, message: '未检测到旧备份，当前已是干净配置' });
            }

            if (pathname === '/api/system/gc' && req.method === 'POST') {
                triggerCompactGC();
                return sendJson(res, { ok: true, memory: getMemoryStats(), message: '内存回收已执行' });
            }

            if (pathname === '/api/system/shutdown' && req.method === 'POST') {
                sendJson(res, { ok: true, message: '后台服务已安全关闭' });
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
                const success = revealInFileManager(target);
                return sendJson(res, {
                    ok: true,
                    success,
                    path: target,
                    message: '已在文件管理器中打开并定位照片'
                });
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
                    target = b.path;
                }
                const success = revealInFileManager(target);
                return sendJson(res, {
                    ok: true,
                    success,
                    path: target,
                    message: '已在文件管理器中打开目录'
                });
            }

            if (pathname === '/api/system/export-config' && req.method === 'GET') {
                const stripKey = p => ({ ...p, api_key: '', api_keys: [] });
                return sendJson(res, {
                    ok: true,
                    app: 'Codex Studio',
                    version: '2.5.0',
                    exported_at: new Date().toISOString(),
                    routingMode: appConfig.routingMode,
                    syncImageKey: appConfig.syncImageKey,
                    mode1_llm_tool: appConfig.mode1_llm_tool,
                    mode2_prefix_direct: appConfig.mode2_prefix_direct,
                    codexProviders: (appConfig.codexProviders || []).map(stripKey),
                    imageProviders: (appConfig.imageProviders || []).map(stripKey)
                });
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
                return sendJson(res, { ok: true, message: '渠道配置预设已成功导入' });
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
                });
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
                return sendJson(res, r);
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
                    return sendJson(res, r);
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
                    return sendJson(res, r);
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
                return sendJson(res, files);
            }

            return sendError(res, 'Not found', 404);
        } catch (err) {
            return sendError(res, err.message || 'Server error', 500);
        }
    }

    // 4. FRONTEND STATIC SERVING
    let reqPath = pathname === '/' ? '/index.html' : pathname;
    let fp = path.join(PUBLIC_DIR, reqPath);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
        res.writeHead(200, { 'Content-Type': getMimeType(fp) });
        return fs.createReadStream(fp, { highWaterMark: 16384 }).pipe(res);
    }
    const indexFp = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexFp)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return fs.createReadStream(indexFp).pipe(res);
    }
    res.writeHead(404);
    res.end('Not Found');
});

server.keepAliveTimeout = 5000;
server.headersTimeout = 6000;
server.maxHeadersCount = 40;
setInterval(triggerCompactGC, 60000).unref();

server.listen(PORT, HOST, () => {
    triggerCompactGC();
    const mem = getMemoryStats();
    console.log(`[Codex Studio v2.5.0] Running on http://${HOST}:${PORT} | Gateway: /v1 | RAM: ${mem.heap_used_mb}MB Heap / ${mem.rss_mb}MB RSS`);
});
