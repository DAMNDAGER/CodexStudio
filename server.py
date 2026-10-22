#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Codex AI Studio (v2.5.0) - Micro-Kernel in Pure Python (Zero pip dependencies)

v2.5.0 Key Upgrades:
 - Fix Repeat Request & Loop Trap: Added `get_fresh_user_prompt` ensuring gateway
   ONLY intercepts when the newest terminal message is a fresh user prompt.
   Intermediate tool returns (function_call_output, role: tool) and assistant continuations
   are 100% transparently passed through to upstream LLM, preventing re-trigger loops.
 - 2.5-Second Request Deduplication: In-memory debounce prevents duplicate parallel generations.
 - Event Toast Notification Sanitization: Pass-through chat turns are logged silently as 'info',
   preventing screen notification spam during multi-turn Codex tool sessions.
 - gpt-image-2 and online relay image model prioritization & auto-fallback.
"""

import os
import sys
import re
import json
import time
import shutil
import base64
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("PORT", 8765))
HOST = "127.0.0.1"
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT_DIR, "data")
OUTPUTS_DIR = os.path.join(ROOT_DIR, "outputs")
PUBLIC_DIR = os.path.join(ROOT_DIR, "public")
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")
TOKEN_FILE = os.path.join(ROOT_DIR, ".image2-token")

for d in (DATA_DIR, OUTPUTS_DIR, PUBLIC_DIR):
    os.makedirs(d, exist_ok=True)

# Ensure local service token
LOCAL_SERVICE_TOKEN = "AguLw4mZOaKQiKkm5I8V-K8545Dao7LysiUr-2edpqg"
if os.path.exists(TOKEN_FILE):
    try:
        with open(TOKEN_FILE, "r", encoding="utf-8") as tf:
            t = tf.read().strip()
            if t:
                LOCAL_SERVICE_TOKEN = t
    except Exception:
        pass
else:
    try:
        with open(TOKEN_FILE, "w", encoding="utf-8") as tf:
            tf.write(LOCAL_SERVICE_TOKEN)
    except Exception:
        pass

# Telemetry Ring Buffer
MAX_EVENTS = 40
gateway_events = []
recent_generated_files = {}
total_captured_requests = 0

def record_gateway_event(source="Codex CLI", message="", action="", status="info", detail=""):
    global total_captured_requests
    total_captured_requests += 1
    seq = total_captured_requests
    evt = {
        "id": f"evt-{int(time.time()*1000)}-{os.urandom(2).hex()}",
        "time": time.strftime("%H:%M:%S", time.localtime()),
        "source": source,
        "message": str(message or "")[:140],
        "action": action,
        "status": status,
        "detail": (json.dumps(detail) if isinstance(detail, (dict, list)) else str(detail or ""))[:200],
        "seq": seq
    }
    gateway_events.insert(0, evt)
    if len(gateway_events) > MAX_EVENTS:
        gateway_events.pop()
    return evt

# In-Memory Deduplication / Debounce Cache
recent_prompt_timestamps = {}
def is_duplicate_rapid_request(prompt_text):
    if not prompt_text or len(prompt_text) < 2:
        return False
    now = time.time()
    last = recent_prompt_timestamps.get(prompt_text)
    if last and (now - last) < 2.5:
        return True
    recent_prompt_timestamps[prompt_text] = now
    if len(recent_prompt_timestamps) > 80:
        for k in list(recent_prompt_timestamps.keys()):
            if now - recent_prompt_timestamps[k] > 6.0:
                del recent_prompt_timestamps[k]
    return False


# -------------------------------------------------------------
# Cross-Platform File Manager Reveal & Folder Opening
# -------------------------------------------------------------
def reveal_in_file_manager(target_path):
    if not target_path:
        target_path = OUTPUTS_DIR
    abs_path = os.path.abspath(target_path) if os.path.isabs(target_path) else os.path.join(OUTPUTS_DIR, target_path)
    if not os.path.exists(abs_path):
        abs_path = OUTPUTS_DIR
    is_file = os.path.isfile(abs_path)
    try:
        if sys.platform == "win32":
            win_path = abs_path.replace("/", "\\")
            if is_file:
                subprocess.Popen(f'explorer.exe /select,"{win_path}"', shell=True)
            else:
                subprocess.Popen(f'explorer.exe "{win_path}"', shell=True)
            return True
        elif sys.platform == "darwin":
            if is_file:
                subprocess.Popen(["open", "-R", abs_path])
            else:
                subprocess.Popen(["open", abs_path])
            return True
        else:
            d = os.path.dirname(abs_path) if is_file else abs_path
            try:
                subprocess.Popen(["xdg-open", d])
            except Exception:
                pass
            return True
    except Exception:
        return False

def open_directory_in_file_manager(target_dir):
    if not target_dir:
        target_dir = OUTPUTS_DIR
    abs_path = os.path.abspath(target_dir) if os.path.isabs(target_dir) else os.path.join(ROOT_DIR, target_dir)
    if not os.path.exists(abs_path):
        abs_path = ROOT_DIR
    return reveal_in_file_manager(abs_path)

def get_codex_paths():
    home = os.environ.get("CODEX_HOME") or os.path.join(os.path.expanduser("~"), ".codex")
    return {
        "home": home,
        "configToml": os.path.join(home, "config.toml"),
        "configTomlBak": os.path.join(home, "config.toml.bak"),
        "authJson": os.path.join(home, "auth.json"),
        "skillDir": os.path.join(home, "skills", "image2")
    }

def get_clean_default_config():
    return {
        "activeCodexProvider": "codex-relay",
        "activeImageProvider": "image-relay",
        "routingMode": "gateway",
        "syncImageKey": True,
        "connectionCategory": "relay_api",
        "officialReasoningEffort": "medium",
        "officialModel": "gpt-4o",
        "onboarding_completed": False,
        "mode1_llm_tool": True,
        "mode2_prefix_direct": True,
        "codexProviders": [
            {
                "id": "codex-relay",
                "category": "relay_api",
                "badge": "推荐 · 一Key双用",
                "name": "聚合中转站 (OneAPI / NewAPI)",
                "base_url": "https://api.openai-proxy.org/v1",
                "model": "gpt-4o",
                "wire_api": "responses",
                "api_key": "",
                "api_keys": [],
                "notes": "兼容所有标准中转站 · 支持在线拉取模型与一Key双用生图"
            },
            {
                "id": "codex-official",
                "category": "openai_official",
                "badge": "OpenAI 官方",
                "name": "OpenAI 官方直连 (GPT-4o / o3)",
                "base_url": "https://api.openai.com/v1",
                "model": "gpt-4o",
                "wire_api": "responses",
                "api_key": "",
                "api_keys": [],
                "notes": "OpenAI 官方原生渠道 · Responses 协议"
            },
            {
                "id": "codex-deepseek",
                "category": "deepseek_official",
                "badge": "DeepSeek 官方",
                "name": "DeepSeek 官方 (V3 / R1)",
                "base_url": "https://api.deepseek.com/v1",
                "model": "deepseek-chat",
                "wire_api": "chat",
                "api_key": "",
                "api_keys": [],
                "notes": "DeepSeek 官方极速接口 · Chat 协议自动转换"
            },
            {
                "id": "codex-silicon",
                "category": "claude_relay",
                "badge": "Claude / 硅基",
                "name": "Claude 专线 / 硅基流动",
                "base_url": "https://api.siliconflow.cn/v1",
                "model": "claude-3-5-sonnet-20241022",
                "wire_api": "chat",
                "api_key": "",
                "api_keys": [],
                "notes": "Claude 3.5 Sonnet 及开源大模型聚合"
            }
        ],
        "imageProviders": [
            {
                "id": "image-relay",
                "name": "中转站联动生图引擎 (一Key双用)",
                "base_url": "https://api.openai-proxy.org/v1",
                "model": "gpt-image-2",
                "generation_path": "/images/generations",
                "edit_path": "/images/edits",
                "image_field": "image",
                "api_key": ""
            },
            {
                "id": "image-official",
                "name": "OpenAI 官方独立生图 (DALL-E 3 / GPT-Image)",
                "base_url": "https://api.openai.com/v1",
                "model": "dall-e-3",
                "generation_path": "/images/generations",
                "edit_path": "/images/edits",
                "image_field": "image",
                "api_key": ""
            },
            {
                "id": "image-flux",
                "name": "FLUX.1 Pro / 第三方独立生图接口",
                "base_url": "https://api.siliconflow.cn/v1",
                "model": "black-forest-labs/FLUX.1-pro",
                "generation_path": "/images/generations",
                "edit_path": "/images/edits",
                "image_field": "image",
                "api_key": ""
            }
        ]
    }

def load_config():
    def_cfg = get_clean_default_config()
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                p = json.load(f)
            def_cfg.update(p)
            def_cfg["codexProviders"] = p.get("codexProviders") or def_cfg["codexProviders"]
            def_cfg["imageProviders"] = p.get("imageProviders") or def_cfg["imageProviders"]
            def_cfg["routingMode"] = p.get("routingMode", "gateway")
            def_cfg["syncImageKey"] = p.get("syncImageKey", True)
            def_cfg["onboarding_completed"] = bool(p.get("onboarding_completed", False))
            def_cfg["mode1_llm_tool"] = p.get("mode1_llm_tool", True)
            def_cfg["mode2_prefix_direct"] = p.get("mode2_prefix_direct", True)
            return def_cfg
        except Exception:
            pass
    save_config(def_cfg)
    return def_cfg

def save_config(cfg):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)

app_config = load_config()

# Global Skill Specifications
SKILL_MD_CONTENT = """---
name: image2
description: Generate and edit images through the local Codex Studio service with the active user-configured image provider. Use when a user asks to create, generate, edit, transform, or reference an image.
---

# Local Image2 Studio

Use the local Codex Studio gateway as the visual generation engine.

## Instructions
1. When generating or editing images, use the local CLI tool:
   - On Windows: `"%CODEX_HOME%\\skills\\image2\\Image2CLI.exe" --prompt "<optimized prompt>"` (or `python "%CODEX_HOME%\\skills\\image2\\image2_cli.py" --prompt "<optimized prompt>"`)
2. For image references, add `--image-path "C:\\path\\to\\image.png"` or `--image-url "https://..."`.
3. For dry-run simulation, add `--dry-run`.
4. The CLI outputs JSON containing the generated image's local file path (`path`) and preview URL.
5. Inspect the CLI JSON response, read the returned local output path (`path`), and present the image directly to the user. Do NOT run extra PowerShell copy commands.
"""

OPENAI_YAML_CONTENT = """interface:
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
"""

STANDALONE_CLI_PY = """#!/usr/bin/env python3
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
"""

def install_global_codex_skill():
    paths = get_codex_paths()
    try:
        skill_dir = paths["skillDir"]
        agents_dir = os.path.join(skill_dir, "agents")
        os.makedirs(agents_dir, exist_ok=True)

        with open(os.path.join(skill_dir, "SKILL.md"), "w", encoding="utf-8") as f:
            f.write(SKILL_MD_CONTENT)
        with open(os.path.join(agents_dir, "openai.yaml"), "w", encoding="utf-8") as f:
            f.write(OPENAI_YAML_CONTENT)
        with open(os.path.join(skill_dir, "image2_cli.py"), "w", encoding="utf-8") as f:
            f.write(STANDALONE_CLI_PY)

        cli_candidates = [
            os.path.join(ROOT_DIR, "Image2Studio", "Image2Studio", "Image2CLI.exe"),
            os.path.join(ROOT_DIR, "Image2Studio", "Image2CLI.exe"),
            os.path.join(ROOT_DIR, "Image2CLI.exe")
        ]
        copied_exe = False
        for cand in cli_candidates:
            if os.path.exists(cand):
                try:
                    shutil.copy2(cand, os.path.join(skill_dir, "Image2CLI.exe"))
                    copied_exe = True
                    break
                except Exception:
                    pass

        client_config = {
            "server": f"http://{HOST}:{PORT}",
            "service_root": ROOT_DIR,
            "token_path": TOKEN_FILE,
            "output_dir": OUTPUTS_DIR,
            "launcher": os.path.join(ROOT_DIR, "CodexStudio.vbs")
        }
        with open(os.path.join(skill_dir, "image2-client.json"), "w", encoding="utf-8") as f:
            json.dump(client_config, f, ensure_ascii=False, indent=2)

        return {
            "ok": True,
            "installed": True,
            "global_skill_target": skill_dir,
            "has_cli_exe": copied_exe or os.path.exists(os.path.join(skill_dir, "Image2CLI.exe")),
            "has_cli_py": True
        }
    except Exception as e:
        return {"ok": False, "installed": False, "error": str(e)}

install_global_codex_skill()

# Intent Parsers
def parse_size_and_quality(prompt_text):
    size = "1024x1024"
    sz_match = re.search(r"\b(\d{3,4})[x×*](\d{3,4})\b", prompt_text)
    if sz_match:
        size = f"{sz_match.group(1)}x{sz_match.group(2)}"
    elif re.search(r"(?:16\s*[:：]\s*9|横屏|宽屏|横版)", prompt_text):
        size = "1792x1024"
    elif re.search(r"(?:9\s*[:：]\s*16|竖屏|竖版|手机壁纸|立绘)", prompt_text):
        size = "1024x1792"
    elif re.search(r"(?:4\s*[:：]\s*3)", prompt_text):
        size = "1280x960"
    elif re.search(r"(?:3\s*[:：]\s*4)", prompt_text):
        size = "960x1280"

    quality = "hd" if re.search(r"(?:\bhd\b|超清|高清|8k|4k)", prompt_text, re.I) else "standard"
    ref_paths = []
    p_regex = re.compile(r"@?((?:[a-zA-Z]:[/\\]|/|\.\.?[/\\])[^\s\"'，。！？<>|?*]+\.(?:png|jpg|jpeg|webp))", re.I)
    for m in p_regex.finditer(prompt_text):
        fp = m.group(1)
        if os.path.exists(fp) and os.path.isfile(fp):
            ref_paths.append(fp)

    return size, quality, ref_paths[:8]

def check_prefix_command(text):
    if not text or not isinstance(text, str):
        return None
    trimmed = text.strip()
    m = re.match(r"^(?:/img|/image|/draw|画图[:：]|生图[:：]|绘图[:：])\s*([\s\S]*)$", trimmed, re.I)
    if not m:
        return None
    prompt = m.group(1).strip() or "简约唯美高清壁纸"
    dry_run = bool(re.search(r"(?:--dry-run|模拟生图)", prompt, re.I))
    prompt = re.sub(r"--dry-run", "", prompt, flags=re.I).strip()
    size, quality, ref_paths = parse_size_and_quality(prompt)
    return {
        "matched": True,
        "type": "mode2_prefix",
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "dry_run": dry_run,
        "ref_image_paths": ref_paths
    }

def check_natural_image_intent(text):
    if not text or not isinstance(text, str):
        return None
    trimmed = text.strip()
    if len(trimmed) < 3 or len(trimmed) > 400:
        return None

    code_guard = re.compile(r"(?:代码|组件|函数|脚本|程序|网页|网站|前端|后端|接口|路由|数据库|报错|错误|异常|调试|重构|修复|编译|运行|写个.*(?:页|组件|脚本|代码|程序|接口|类)|实现.*(?:功能|逻辑|组件)|参考这张|看这张|分析这张|解释这张|根据这张|react|vue|angular|html|css|javascript|typescript|python|java|rust|golang|c\+\+|sql|json|yaml|toml|dockerfile|git|npm|pip|webpack|vite|tailwind)", re.I)
    if code_guard.search(trimmed):
        return None

    cn_verb_noun = re.compile(r"(?:生成|画|绘制|创作|画一|做一|来一|给我画|帮我画|帮我生成|请生成|请画).{0,15}(?:一张|一幅|一个|张|幅|份)?.{0,45}(?:图|图片|照片|全家福|海报|壁纸|插画|头像|画像|配图|背景|画作|概念图|效果图|封面|写真|风景|漫画|手绘)", re.I)
    cn_direct_start = re.compile(r"^(?:请|帮我|给我)?(?:生成一张|生成一幅|画一张|画一幅|绘制一张|绘制一幅|创作一张)([\s\S]{2,200})$", re.I)
    en_pattern = re.compile(r"\b(?:generate|draw|create|paint|render)\s+(?:an?\s+|me\s+an?\s+)?(?:image|picture|photo|photograph|illustration|wallpaper|poster|portrait|artwork|family\s+photo)\b", re.I)

    if not cn_verb_noun.search(trimmed) and not cn_direct_start.search(trimmed) and not en_pattern.search(trimmed):
        return None

    dry_run = bool(re.search(r"(?:--dry-run|模拟生图)", trimmed, re.I))
    clean_prompt = re.sub(r"--dry-run", "", trimmed, flags=re.I).strip()
    size, quality, ref_paths = parse_size_and_quality(clean_prompt)
    return {
        "matched": True,
        "type": "mode1_semantic",
        "prompt": clean_prompt,
        "size": size,
        "quality": quality,
        "dry_run": dry_run,
        "ref_image_paths": ref_paths
    }

def get_fresh_user_prompt(body):
    """
    Accurately extracts a fresh user prompt ONLY when the incoming request's
    most recent terminal item is a genuine user turn.
    """
    if not isinstance(body, dict):
        return None

    # 1. Chat Completions API (body["messages"])
    msgs = body.get("messages")
    if isinstance(msgs, list) and len(msgs) > 0:
        last_msg = msgs[-1]
        if not isinstance(last_msg, dict) or last_msg.get("role") != "user":
            return None
        c = last_msg.get("content")
        if isinstance(c, str):
            return c.strip()
        if isinstance(c, list):
            return "\n".join((p if isinstance(p, str) else (p.get("text") or p.get("input_text") or "")) for p in c if p).strip()
        return ""

    # 2. Responses API (body["input"])
    inp = body.get("input")
    if isinstance(inp, str):
        return inp.strip()
    if isinstance(inp, list) and len(inp) > 0:
        last_item = inp[-1]
        if not isinstance(last_item, dict):
            return None

        # If terminal item is a tool output or assistant message -> NOT a fresh user prompt!
        if last_item.get("type") in ("function_call_output", "tool_response", "item_reference", "reasoning"):
            return None
        if last_item.get("role") == "assistant":
            return None

        if last_item.get("role") == "user" or (last_item.get("type") == "message" and last_item.get("role") == "user"):
            c = last_item.get("content")
            if isinstance(c, str):
                return c.strip()
            if isinstance(c, list):
                return "\n".join((p if isinstance(p, str) else (p.get("text") or p.get("input_text") or "")) for p in c if p).strip()
        return None

    if isinstance(body.get("prompt"), str):
        return body["prompt"].strip()
    return None

def extract_last_user_message(body):
    fresh = get_fresh_user_prompt(body)
    if fresh:
        return fresh
    if not isinstance(body, dict):
        return ""
    msgs = body.get("messages")
    if isinstance(msgs, list):
        for m in reversed(msgs):
            if isinstance(m, dict) and m.get("role") == "user":
                c = m.get("content")
                if isinstance(c, str):
                    return c
                if isinstance(c, list):
                    return "\n".join(p.get("text") or p.get("input_text") or "" for p in c if isinstance(p, dict))
    inp = body.get("input")
    if isinstance(inp, str):
        return inp
    if isinstance(inp, list):
        for it in reversed(inp):
            if isinstance(it, dict) and it.get("role") == "user":
                c = it.get("content")
                if isinstance(c, str):
                    return c
                if isinstance(c, list):
                    txt = "\n".join((p if isinstance(p, str) else (p.get("text") or p.get("input_text") or "")) for p in c if p)
                    if txt:
                        return txt
    return ""

# Effective Image Provider Resolution
IMAGE_MODEL_PATTERN = re.compile(r"(?:image|dall-e|dalle|flux|sd3|stable-diffusion|kolors|ideogram|midjourney|mj|imagen|recraft|cogview|wanx|sora|paint|draw|gpt-image|gpt-4o-image|gpt-4o-all)", re.I)

def get_effective_image_provider():
    img_list = app_config.get("imageProviders", [])
    codex_list = app_config.get("codexProviders", [])
    active_img = next((p for p in img_list if p.get("id") == app_config.get("activeImageProvider")), img_list[0] if img_list else None)
    active_codex = next((p for p in codex_list if p.get("id") == app_config.get("activeCodexProvider")), codex_list[0] if codex_list else None)

    resolved = dict(active_img) if active_img else {
        "id": "image-relay",
        "name": "中转站联动生图",
        "base_url": "https://api.openai-proxy.org/v1",
        "model": "gpt-image-2",
        "generation_path": "/images/generations",
        "edit_path": "/images/edits",
        "image_field": "image",
        "api_key": ""
    }

    sync_key = app_config.get("syncImageKey", True)
    if (sync_key or not resolved.get("api_key")) and active_codex and active_codex.get("api_key") and active_codex.get("api_key") != "ollama":
        resolved["api_key"] = active_codex["api_key"]
        c_base = active_codex.get("base_url", "")
        r_base = resolved.get("base_url", "")
        if c_base and (sync_key or not r_base or "openai-proxy.org" in r_base or "api.openai.com" in r_base):
            resolved["base_url"] = c_base
    return resolved

def fetch_models_from_upstream(base_url, api_key):
    base_url = (base_url or "").strip().rstrip("/")
    url_candidates = []
    if "11434" in base_url:
        url_candidates.append(re.sub(r"/v1$", "", base_url) + "/api/tags")
    if base_url.endswith("/v1"):
        url_candidates.append(f"{base_url}/models")
        url_candidates.append(f"{base_url[:-3]}/models")
    else:
        url_candidates.append(f"{base_url}/v1/models")
        url_candidates.append(f"{base_url}/models")

    fetched_data = None
    last_err = ""
    for t_url in url_candidates:
        try:
            headers = {"Accept": "application/json", "User-Agent": "CodexStudio/2.5.0"}
            if api_key and api_key != "ollama":
                headers["Authorization"] = f"Bearer {api_key}"
            req = urllib.request.Request(t_url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=8) as resp:
                if 200 <= resp.status < 300:
                    raw_body = json.loads(resp.read().decode("utf-8"))
                    raw_list = raw_body.get("data") or raw_body.get("models") or (raw_body if isinstance(raw_body, list) else [])
                    if raw_list:
                        fetched_data = [m if isinstance(m, str) else (m.get("id") or m.get("name")) for m in raw_list if m]
                        break
        except Exception as e:
            last_err = str(e)

    detected = [m for m in fetched_data if IMAGE_MODEL_PATTERN.search(m)] if fetched_data else []
    return fetched_data, detected, last_err

def execute_image_task(prompt, size="1024x1024", quality="standard", dry_run=False, ref_files=None, source="studio"):
    ref_files = ref_files or []
    active = get_effective_image_provider()
    if not active:
        raise RuntimeError("未配置任何图片模型提供商")

    norm_quality = "standard" if quality in ("medium", None, "") else quality
    is_edit = len(ref_files) > 0
    base_clean = (active.get("base_url") or "https://api.openai.com/v1").rstrip("/")
    gen_path = active.get("generation_path", "/images/generations")
    edit_path = active.get("edit_path", "/images/edits")
    target_endpoint = f"{base_clean}{edit_path if is_edit else gen_path}"

    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "mode": "edit" if is_edit else "generate",
            "provider": active.get("name"),
            "model": active.get("model"),
            "prompt": prompt,
            "size": size,
            "quality": norm_quality,
            "ref_count": len(ref_files),
            "target_url": target_endpoint,
            "output_dir": OUTPUTS_DIR,
            "urls": ["/outputs/dry-run.png"],
            "paths": ["outputs/dry-run.png"],
            "url": "/outputs/dry-run.png",
            "full_url": f"http://{HOST}:{PORT}/outputs/dry-run.png",
            "path": "outputs/dry-run.png",
            "message": "Dry-Run 校验通过：参数解析正常，未消耗 API 额度"
        }

    api_key = active.get("api_key", "").strip()
    if not api_key:
        raise RuntimeError("尚未配置生图 API Key。请在「Codex 接入与渠道」或「新手向导」中填入中转站 API Key 并保存")

    used_model = active.get("model") or "gpt-image-2"
    record_gateway_event(
        source="视觉工坊 UI" if source == "studio-ui" else f"Codex ({source})",
        message=prompt,
        action=f"🎨 正在调用 {used_model} 生成图像 ({size})",
        status="processing",
        detail=target_endpoint
    )

    def call_generations(m_try, sz_try):
        req_body = {
            "model": m_try,
            "prompt": prompt,
            "n": 1,
            "size": sz_try
        }
        if norm_quality == "hd":
            req_body["quality"] = "hd"
        payload_bytes = json.dumps(req_body).encode("utf-8")
        req = urllib.request.Request(
            target_endpoint,
            data=payload_bytes,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
                "User-Agent": "CodexStudio/2.5.0",
                "Content-Length": str(len(payload_bytes))
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))

    resp_json = None
    if is_edit:
        boundary = "----CodexBoundary" + os.urandom(6).hex()
        parts = []
        def add_f(k, v):
            parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode("utf-8"))
        add_f("model", used_model)
        add_f("prompt", prompt)
        add_f("size", size)
        for idx, f in enumerate(ref_files):
            fn = active.get("image_field", "image")
            filename = f.get("filename") or f"ref_{idx}.png"
            ct = f.get("contentType") or "image/png"
            parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{fn}\"; filename=\"{filename}\"\r\nContent-Type: {ct}\r\n\r\n".encode("utf-8"))
            parts.append(f.get("data", b""))
            parts.append(b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode("utf-8"))
        body_bytes = b"".join(parts)
        req = urllib.request.Request(
            target_endpoint,
            data=body_bytes,
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Authorization": f"Bearer {api_key}",
                "User-Agent": "CodexStudio/2.5.0",
                "Content-Length": str(len(body_bytes))
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            resp_json = json.loads(resp.read().decode("utf-8"))
    else:
        try:
            resp_json = call_generations(used_model, size)
        except urllib.error.HTTPError as e:
            err_txt = e.read().decode("utf-8", "ignore")
            # Auto-Fallback on model_not_found / No available channel
            if re.search(r"model_not_found|No available channel|model_not_support|does not exist", err_txt, re.I):
                record_gateway_event(
                    source="生图智能自愈",
                    message=f"模型 {used_model} 在当前中转分组不可用，正在自动探测该中转站支持的生图模型...",
                    action="🔄 自动探测可用生图模型",
                    status="processing"
                )
                _, detected_models, _ = fetch_models_from_upstream(base_clean, api_key)
                candidates = []
                for cand in (detected_models + ["gpt-image-2", "gpt-image-1", "gpt-4o-image", "dall-e-3", "flux-pro", "flux", "black-forest-labs/FLUX.1-schnell", "dall-e-2"]):
                    if cand and cand != used_model and cand not in candidates:
                        candidates.append(cand)
                succeeded = False
                for cand_m in candidates[:5]:
                    try:
                        resp_json = call_generations(cand_m, "1024x1024")
                        used_model = cand_m
                        img_p = next((p for p in app_config.get("imageProviders", []) if p.get("id") == app_config.get("activeImageProvider")), None)
                        if img_p:
                            img_p["model"] = cand_m
                            save_config(app_config)
                        record_gateway_event(
                            source="生图智能自愈",
                            message=f"已自动切换为中转站可用生图模型: {cand_m}",
                            action=f"✅ 自动绑定 {cand_m}",
                            status="success"
                        )
                        succeeded = True
                        break
                    except Exception:
                        pass
                if not succeeded:
                    record_gateway_event(source=source, message=prompt, action=f"❌ 生图接口返回 HTTP {e.code}", status="error", detail=err_txt)
                    raise RuntimeError(f"上游图片 API 错误 (HTTP {e.code}): {err_txt}。请在生图设置中点击「在线拉取生图模型」重新选取")
            else:
                record_gateway_event(source=source, message=prompt, action=f"❌ 生图接口返回 HTTP {e.code}", status="error", detail=err_txt)
                raise RuntimeError(f"上游图片 API 错误 (HTTP {e.code}): {err_txt}")

    item = None
    if isinstance(resp_json, dict):
        d_arr = resp_json.get("data") or resp_json.get("images")
        if isinstance(d_arr, list) and len(d_arr) > 0:
            item = d_arr[0]
        else:
            item = resp_json

    if not item:
        raise RuntimeError("上游图片 API 未返回有效图片数据")

    filename = f"{'edit' if is_edit else 'img'}-{int(time.time()*1000)}-{os.urandom(3).hex()}.png"
    out_path = os.path.join(OUTPUTS_DIR, filename)

    if isinstance(item, dict) and item.get("b64_json"):
        with open(out_path, "wb") as f:
            f.write(base64.b64decode(item["b64_json"]))
    elif isinstance(item, dict) and item.get("url"):
        req_dl = urllib.request.Request(item["url"], headers={"User-Agent": "CodexStudio/2.5.0"})
        with urllib.request.urlopen(req_dl, timeout=30) as dl_resp:
            with open(out_path, "wb") as f:
                f.write(dl_resp.read())
    else:
        raise RuntimeError("未识别的图片返回格式（既无 url 也无 b64_json）")

    meta_info = {
        "filename": filename,
        "prompt": prompt,
        "model": used_model,
        "provider": active.get("name", "中转站联动生图"),
        "size": size,
        "quality": norm_quality,
        "source": source,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }
    with open(os.path.join(OUTPUTS_DIR, f"{filename}.json"), "w", encoding="utf-8") as f:
        json.dump(meta_info, f, ensure_ascii=False, indent=2)
    try:
        st_sz = os.path.getsize(out_path)
    except Exception:
        st_sz = 1024
    recent_generated_files[filename] = {**meta_info, "path": out_path, "bytes": st_sz}

    rel_url = f"/outputs/{filename}"
    full_url = f"http://{HOST}:{PORT}{rel_url}"
    record_gateway_event(
        source=source,
        message=prompt,
        action=f"✅ 图像生成成功 ({used_model} · {filename})",
        status="success",
        detail=out_path
    )

    return {
        "ok": True,
        "filename": filename,
        "url": rel_url,
        "urls": [rel_url],
        "full_url": full_url,
        "path": out_path,
        "paths": [out_path],
        "output_dir": OUTPUTS_DIR,
        "prompt": prompt,
        "size": size,
        "quality": norm_quality,
        "provider": active.get("name"),
        "model": used_model
    }

def sync_provider_to_codex_toml(provider, routing_mode="gateway", connection_category="relay_api"):
    paths = get_codex_paths()
    os.makedirs(paths["home"], exist_ok=True)
    existing_toml = ""
    if os.path.exists(paths["configToml"]):
        with open(paths["configToml"], "r", encoding="utf-8") as f:
            existing_toml = f.read()
        with open(paths["configTomlBak"], "w", encoding="utf-8") as f:
            f.write(existing_toml)

    use_gateway = routing_mode == "gateway"
    provider_key = "codex_studio_gateway" if use_gateway else re.sub(r"[^a-zA-Z0-9_]", "_", provider["id"])
    effective_base = f"http://{HOST}:{PORT}/v1" if use_gateway else provider.get("base_url")
    effective_key = (provider.get("api_key") or "local-gateway-key") if use_gateway else provider.get("api_key", "")

    lines = existing_toml.splitlines() if existing_toml else []
    has_model, has_prov = False, False
    new_lines = []
    for l in lines:
        if re.match(r"^model\s*=", l):
            has_model = True
            new_lines.append(f'model = "{provider["model"]}"')
        elif re.match(r"^model_provider\s*=", l):
            has_prov = True
            new_lines.append(f'model_provider = "{provider_key}"')
        else:
            new_lines.append(l)
    if not has_model:
        new_lines.insert(0, f'model = "{provider["model"]}"')
    if not has_prov:
        new_lines.insert(1, f'model_provider = "{provider_key}"')

    cleaned = []
    skip = False
    for l in new_lines:
        if l.strip() == f"[model_providers.{provider_key}]":
            skip = True
            continue
        if skip and l.startswith("["):
            skip = False
        if not skip:
            cleaned.append(l)

    wire_api = provider.get("wire_api", "responses")
    prov_name = f"Codex Studio Gateway ({provider['name']})" if use_gateway else provider["name"]
    cleaned.extend([
        "",
        f"[model_providers.{provider_key}]",
        f'name = "{prov_name}"',
        f'base_url = "{effective_base}"',
        f'wire_api = "{wire_api}"'
    ])
    if effective_key:
        cleaned.append(f'api_key = "{effective_key}"')

    with open(paths["configToml"], "w", encoding="utf-8") as f:
        f.write("\n".join(cleaned).strip() + "\n")

    if effective_key:
        auth_obj = {}
        if os.path.exists(paths["authJson"]):
            try:
                with open(paths["authJson"], "r", encoding="utf-8") as f:
                    auth_obj = json.load(f)
            except Exception:
                pass
        auth_obj[provider_key] = effective_key
        auth_obj["OPENAI_API_KEY"] = effective_key
        with open(paths["authJson"], "w", encoding="utf-8") as f:
            json.dump(auth_obj, f, ensure_ascii=False, indent=2)

    install_global_codex_skill()
    return {
        "success": True,
        "routing_mode": routing_mode,
        "gateway_url": effective_base,
        "category": connection_category,
        "message": "已成功同步并写入 ~/.codex/config.toml"
    }

def get_mime_type(fp):
    ext = os.path.splitext(fp)[1].lower()
    return {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".svg": "image/svg+xml"
    }.get(ext, "application/octet-stream")

# HTTP Handler
class CodexStudioHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Image2-Local-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Image2-Local-Token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/outputs/"):
            fname = os.path.basename(path)
            fp = os.path.join(OUTPUTS_DIR, fname)
            if os.path.exists(fp) and os.path.isfile(fp):
                self.send_response(200)
                self.send_header("Content-Type", get_mime_type(fp))
                self.send_header("Cache-Control", "max-age=3600")
                self.send_header("Content-Length", str(os.path.getsize(fp)))
                self.end_headers()
                with open(fp, "rb") as f:
                    shutil.copyfileobj(f, self.wfile)
                return
            self.send_response(404)
            self.end_headers()
            return

        if path == "/api/health":
            eff_img = get_effective_image_provider()
            act_codex = next((p for p in app_config.get("codexProviders", []) if p.get("id") == app_config.get("activeCodexProvider")), None)
            self.send_json({
                "status": "ok",
                "version": "2.5.0",
                "provider": eff_img["name"] if eff_img else "未配置",
                "model": eff_img.get("model", "gpt-image-2") if eff_img else "gpt-image-2",
                "configured": bool(eff_img and eff_img.get("api_key")),
                "base_url": eff_img.get("base_url", "") if eff_img else "",
                "onboarding_completed": bool(app_config.get("onboarding_completed", False)),
                "should_show_onboarding": not bool(app_config.get("onboarding_completed", False)),
                "memory": {"rss_mb": 24.5, "heap_used_mb": 4.1, "heap_total_mb": 8.0},
                "connection_category": app_config.get("connectionCategory", "relay_api"),
                "routing_mode": app_config.get("routingMode", "gateway"),
                "sync_image_key": app_config.get("syncImageKey", True),
                "mode1_llm_tool": app_config.get("mode1_llm_tool", True),
                "mode2_prefix_direct": app_config.get("mode2_prefix_direct", True),
                "active_codex_provider": act_codex["name"] if act_codex else "未配置",
                "active_codex_model": act_codex.get("model", "-") if act_codex else "-",
                "active_image_provider": eff_img["name"] if eff_img else "未配置",
                "image_model": eff_img.get("model", "-") if eff_img else "-",
                "total_captured": total_captured_requests,
                "latest_event": gateway_events[0] if gateway_events else None
            })
            return

        if path == "/api/events":
            self.send_json({
                "ok": True,
                "total_captured": total_captured_requests,
                "events": gateway_events
            })
            return

        if path == "/api/codex/info":
            paths = get_codex_paths()
            toml_text = ""
            if os.path.exists(paths["configToml"]):
                try:
                    with open(paths["configToml"], "r", encoding="utf-8") as f:
                        toml_text = f.read()
                except Exception:
                    pass
            mask = lambda p: {**p, "has_key": bool(p.get("api_key")), "api_key": f"{p['api_key'][:4]}...{p['api_key'][-4:]}" if len(p.get("api_key", "")) > 8 else "****" if p.get("api_key") else ""}
            eff_img = get_effective_image_provider()
            self.send_json({
                "codex_home": paths["home"],
                "onboarding_completed": bool(app_config.get("onboarding_completed", False)),
                "should_show_onboarding": not bool(app_config.get("onboarding_completed", False)) or not any(p.get("api_key") for p in app_config.get("codexProviders", [])),
                "sync_image_key": app_config.get("syncImageKey", True),
                "active_image_provider": eff_img["name"] if eff_img else "中转站联动生图",
                "active_image_model": eff_img.get("model", "gpt-image-2") if eff_img else "gpt-image-2",
                "routing_mode": app_config.get("routingMode", "gateway"),
                "mode1_llm_tool": app_config.get("mode1_llm_tool", True),
                "mode2_prefix_direct": app_config.get("mode2_prefix_direct", True),
                "gateway_url": f"http://{HOST}:{PORT}/v1",
                "has_config_toml": os.path.exists(paths["configToml"]),
                "active_codex_provider": app_config.get("activeCodexProvider"),
                "codex_providers": [mask(p) for p in app_config.get("codexProviders", [])],
                "config_toml_preview": toml_text,
                "memory": {"rss_mb": 24.5, "heap_used_mb": 4.1, "heap_total_mb": 8.0},
                "total_captured": total_captured_requests,
                "recent_events": gateway_events[:15]
            })
            return

        if path == "/api/providers":
            mask = lambda p: {**p, "has_key": bool(p.get("api_key")), "api_key": f"{p['api_key'][:4]}...{p['api_key'][-4:]}" if len(p.get("api_key", "")) > 8 else "****" if p.get("api_key") else ""}
            self.send_json({
                "activeImage": app_config.get("activeImageProvider"),
                "activeCodex": app_config.get("activeCodexProvider"),
                "syncImageKey": app_config.get("syncImageKey", True),
                "imageProviders": [mask(p) for p in app_config.get("imageProviders", [])],
                "codexProviders": [mask(p) for p in app_config.get("codexProviders", [])]
            })
            return

        if path == "/api/system/storage-info":
            paths = get_codex_paths()
            seen_files = set()
            out_count = 0
            total_bytes = 0
            if os.path.exists(OUTPUTS_DIR):
                for f in os.listdir(OUTPUTS_DIR):
                    if not re.search(r"\.(png|jpg|jpeg|webp)$", f, re.I):
                        continue
                    fp = os.path.join(OUTPUTS_DIR, f)
                    if os.path.isfile(fp):
                        seen_files.add(f)
                        out_count += 1
                        total_bytes += os.path.getsize(fp)
            for fname, info in list(recent_generated_files.items()):
                if fname not in seen_files and os.path.exists(info["path"]):
                    seen_files.add(fname)
                    out_count += 1
                    total_bytes += info.get("bytes", 0)
            has_skill = os.path.exists(os.path.join(paths["skillDir"], "SKILL.md"))
            self.send_json({
                "ok": True,
                "config_file": CONFIG_FILE,
                "outputs_dir": OUTPUTS_DIR,
                "codex_home": paths["home"],
                "codex_config_toml": paths["configToml"],
                "codex_auth_json": paths["authJson"],
                "codex_skill_dir": paths["skillDir"],
                "has_skill_installed": has_skill,
                "outputs_count": out_count,
                "total_images": out_count,
                "total_size_mb": round(total_bytes / 1048576, 2)
            })
            return

        if path == "/api/system/export-config":
            strip_k = lambda p: {**p, "api_key": "", "api_keys": []}
            self.send_json({
                "ok": True,
                "app": "Codex Studio",
                "version": "2.5.0",
                "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "routingMode": app_config.get("routingMode", "gateway"),
                "syncImageKey": app_config.get("syncImageKey", True),
                "mode1_llm_tool": app_config.get("mode1_llm_tool", True),
                "mode2_prefix_direct": app_config.get("mode2_prefix_direct", True),
                "codexProviders": [strip_k(p) for p in app_config.get("codexProviders", [])],
                "imageProviders": [strip_k(p) for p in app_config.get("imageProviders", [])]
            })
            return

        if path == "/api/history":
            seen_h = set()
            items = []
            for fname, info in list(recent_generated_files.items()):
                if os.path.exists(info["path"]):
                    seen_h.add(fname)
                    items.append({
                        "filename": fname,
                        "url": f"/outputs/{fname}",
                        "path": info["path"],
                        "bytes": info.get("bytes", 0),
                        "created_at": info.get("created_at", ""),
                        "prompt": info.get("prompt", ""),
                        "model": info.get("model", ""),
                        "provider": info.get("provider", "")
                    })
            if os.path.exists(OUTPUTS_DIR):
                for f in os.listdir(OUTPUTS_DIR):
                    if f in seen_h:
                        continue
                    if re.search(r"\.(png|jpg|jpeg|webp)$", f, re.I):
                        fp = os.path.join(OUTPUTS_DIR, f)
                        st = os.stat(fp)
                        meta = {}
                        meta_p = os.path.join(OUTPUTS_DIR, f"{f}.json")
                        if os.path.exists(meta_p):
                            try:
                                with open(meta_p, "r", encoding="utf-8") as mf:
                                    meta = json.load(mf)
                            except Exception:
                                pass
                        items.append({
                            "filename": f,
                            "url": f"/outputs/{f}",
                            "path": fp,
                            "bytes": st.st_size,
                            "created_at": meta.get("created_at") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime)),
                            "prompt": meta.get("prompt", ""),
                            "model": meta.get("model", ""),
                            "provider": meta.get("provider", "")
                        })
            items.sort(key=lambda x: x["created_at"], reverse=True)
            self.send_json(items)
            return

        # Static file serving
        target_file = "index.html" if path in ("", "/") else path.lstrip("/")
        full_static = os.path.join(PUBLIC_DIR, target_file)
        if not (os.path.exists(full_static) and os.path.isfile(full_static)):
            full_static = os.path.join(PUBLIC_DIR, "index.html")

        if os.path.exists(full_static) and os.path.isfile(full_static):
            self.send_response(200)
            self.send_header("Content-Type", get_mime_type(full_static))
            self.send_header("Content-Length", str(os.path.getsize(full_static)))
            self.end_headers()
            with open(full_static, "rb") as f:
                shutil.copyfileobj(f, self.wfile)
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        global app_config
        parsed = urlparse(self.path)
        path = parsed.path
        content_len = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(content_len) if content_len > 0 else b"{}"
        body = {}
        try:
            body = json.loads(raw_body.decode("utf-8"))
        except Exception:
            body = {}

        # 1. CODEX GATEWAY (/v1/chat/completions or /v1/responses)
        if path.startswith("/v1/"):
            codex_list = app_config.get("codexProviders", [])
            active_codex = next((p for p in codex_list if p.get("id") == app_config.get("activeCodexProvider")), codex_list[0] if codex_list else None)
            if not active_codex:
                self.send_json({"error": "No active Codex provider"}, 502)
                return

            fresh_user_prompt = get_fresh_user_prompt(body)
            is_stream = bool(body.get("stream"))
            proto_label = "Responses API" if path == "/v1/responses" else "Chat API"

            # Only inspect for interception if this is a genuine, fresh user prompt!
            # (If the terminal message is a tool return, assistant continuation, or system message: skip interception!)
            if fresh_user_prompt:
                # Check in-memory deduplication (e.g. double-submitted within 2.5s)
                if is_duplicate_rapid_request(fresh_user_prompt):
                    pass
                else:
                    # A. MODE 2: EXPLICIT PREFIX DIRECT INTERCEPT (/img, /draw)
                    if app_config.get("mode2_prefix_direct", True):
                        prefix_cmd = check_prefix_command(fresh_user_prompt)
                        if prefix_cmd and prefix_cmd.get("matched"):
                            record_gateway_event(
                                source=f"Codex ({proto_label})",
                                message=fresh_user_prompt,
                                action="⚡ 命中方案二 (/img 指令直达) -> 本地秒级截获生图",
                                status="processing"
                            )
                            try:
                                ref_files = []
                                for fp in prefix_cmd.get("ref_image_paths", []):
                                    if os.path.exists(fp):
                                        with open(fp, "rb") as rf:
                                            ref_files.append({
                                                "filename": os.path.basename(fp),
                                                "contentType": get_mime_type(fp),
                                                "data": rf.read()
                                            })
                                gen = execute_image_task(
                                    prompt=prefix_cmd["prompt"],
                                    size=prefix_cmd["size"],
                                    quality=prefix_cmd["quality"],
                                    dry_run=prefix_cmd["dry_run"],
                                    ref_files=ref_files,
                                    source="mode2-prefix-direct"
                                )
                                md = (
                                    f"### 🛡️ 方案二：指令直达 (Dry-Run 校验通过)\n- **提示词**: `{gen['prompt']}`\n- **尺寸**: `{gen['size']}` | **画质**: `{gen['quality']}`\n- **模型**: `{gen['provider']} · {gen['model']}`"
                                    if gen.get("dry_run")
                                    else f"🎨 **已通过指令直达生成图像（0 额外对话 Token 消耗）**\n\n- **提示词**: {gen['prompt']}\n- **模型**: `{gen['provider']} · {gen['model']}` (`{gen['size']}`)\n- **本地路径**: `{gen['path']}`\n\n![{gen['prompt']}]({gen['full_url']})"
                                )
                                self.send_synthesized_by_path(path, is_stream, md, gen.get("model", "gpt-image-2"))
                                return
                            except Exception as err:
                                self.send_synthesized_by_path(path, is_stream, f"⚠️ **指令生图失败**: {err}", "prefix-error")
                                return

                    # B. MODE 1: NATURAL LANGUAGE SEMANTIC IMAGE INTENT
                    if app_config.get("mode1_llm_tool", True):
                        nat_intent = check_natural_image_intent(fresh_user_prompt)
                        if nat_intent and nat_intent.get("matched"):
                            record_gateway_event(
                                source=f"Codex ({proto_label})",
                                message=fresh_user_prompt,
                                action="🧠 命中方案一 (自然语言生图意图) -> 自动调拨视觉引擎",
                                status="processing"
                            )
                            try:
                                ref_files = []
                                for fp in nat_intent.get("ref_image_paths", []):
                                    if os.path.exists(fp):
                                        with open(fp, "rb") as rf:
                                            ref_files.append({
                                                "filename": os.path.basename(fp),
                                                "contentType": get_mime_type(fp),
                                                "data": rf.read()
                                            })
                                gen = execute_image_task(
                                    prompt=nat_intent["prompt"],
                                    size=nat_intent["size"],
                                    quality=nat_intent["quality"],
                                    dry_run=nat_intent["dry_run"],
                                    ref_files=ref_files,
                                    source="mode1-semantic-direct"
                                )
                                md = f"🎨 **Codex Studio 已捕捉生图需求并生成图像**\n\n- **提示词**: {gen['prompt']}\n- **生图引擎**: `{gen['provider']} · {gen['model']}` (`{gen['size']}`)\n- **本地保存路径**: `{gen['path']}`\n- **在线预览地址**: {gen['full_url']}\n\n![{gen['prompt']}]({gen['full_url']})"
                                self.send_synthesized_by_path(path, is_stream, md, gen.get("model", "gpt-image-2"))
                                return
                            except Exception as err:
                                self.send_synthesized_by_path(path, is_stream, f"⚠️ **自动生图失败**: {err}", "image-error")
                                return

            # C. NORMAL CODING / CHAT / AGENT CONTINUATION PASS-THROUGH
            # Log as audit event only (status: 'info'), without triggering alarming popup toasts!
            record_gateway_event(
                source=f"Codex ({proto_label})",
                message=fresh_user_prompt or ("工具结果与上下文对话" if body.get("messages") else "工具/函数响应"),
                action=f"💻 编程与对话请求 -> 透传至 {active_codex['name']} ({active_codex.get('model', 'gpt-4o')})",
                status="info"
            )

            up_base = active_codex.get("base_url", "https://api.openai-proxy.org/v1").rstrip("/")
            sub_path = path[3:] if path.startswith("/v1") else path
            target_url = f"{up_base}{sub_path}"
            if parsed.query:
                target_url += f"?{parsed.query}"

            if active_codex.get("model") and "model" in body:
                body["model"] = active_codex["model"]

            out_payload = json.dumps(body).encode("utf-8")
            headers = {
                "Content-Type": "application/json",
                "User-Agent": "CodexStudio/2.5.0",
                "Content-Length": str(len(out_payload))
            }
            if active_codex.get("api_key"):
                headers["Authorization"] = f"Bearer {active_codex['api_key']}"

            try:
                up_req = urllib.request.Request(target_url, data=out_payload, headers=headers, method="POST")
                with urllib.request.urlopen(up_req, timeout=120) as up_resp:
                    self.send_response(up_resp.status)
                    for k, v in up_resp.headers.items():
                        if k.lower() not in ("content-length", "transfer-encoding", "content-encoding"):
                            self.send_header(k, v)
                    resp_bytes = up_resp.read()
                    self.send_header("Content-Length", str(len(resp_bytes)))
                    self.end_headers()
                    self.wfile.write(resp_bytes)
                return
            except urllib.error.HTTPError as he:
                err_b = he.read()
                self.send_response(he.code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(err_b)))
                self.end_headers()
                self.wfile.write(err_b)
                return
            except Exception as e:
                self.send_json({"error": f"Upstream Gateway Error: {e}"}, 502)
                return

        # API Handlers
        if path == "/api/events/clear":
            gateway_events.clear()
            total_captured_requests = 0
            self.send_json({"ok": True, "message": "实时捕获日志已清空"})
            return

        if path == "/api/system/onboarding-complete":
            app_config["onboarding_completed"] = True
            save_config(app_config)
            self.send_json({"ok": True, "onboarding_completed": True})
            return

        if path == "/api/codex/install":
            r = install_global_codex_skill()
            r["message"] = "全局 Codex Image2 视觉插件已安装并就绪"
            self.send_json(r)
            return

        if path == "/api/system/reset-config":
            # global app_config
            app_config = get_clean_default_config()
            app_config["onboarding_completed"] = False
            save_config(app_config)
            record_gateway_event(source="系统管理", message="重置所有保存的 API 密钥与渠道配置", action="🧹 已恢复初始空白状态（重新开启新手向导）", status="info")
            self.send_json({"ok": True, "should_show_onboarding": True, "message": "已清空所有保存的 API 密钥与自定义配置，恢复至初始状态"})
            return

        if path == "/api/system/reveal-file":
            target = ""
            if body.get("filename"):
                target = os.path.join(OUTPUTS_DIR, os.path.basename(body["filename"]))
            elif body.get("path"):
                target = body["path"]
            else:
                target = OUTPUTS_DIR
            succ = reveal_in_file_manager(target)
            self.send_json({"ok": True, "success": succ, "path": target, "message": "已在文件管理器中打开并定位照片"})
            return

        if path == "/api/system/open-folder":
            paths = get_codex_paths()
            target = OUTPUTS_DIR
            if body.get("folder") == "codex_home":
                target = paths["configToml"] if os.path.exists(paths["configToml"]) else paths["home"]
            elif body.get("folder") == "config_dir":
                target = CONFIG_FILE if os.path.exists(CONFIG_FILE) else DATA_DIR
            elif body.get("folder") == "skill_dir":
                target = paths["skillDir"]
            elif body.get("folder") == "outputs":
                target = OUTPUTS_DIR
            elif body.get("path"):
                target = body["path"]
            succ = reveal_in_file_manager(target)
            self.send_json({"ok": True, "success": succ, "path": target, "message": "已在文件管理器中打开目录"})
            return

        if path == "/api/system/import-config":
            if isinstance(body.get("codexProviders"), list) and len(body["codexProviders"]) > 0:
                existing_map = {p.get("id"): p for p in app_config.get("codexProviders", [])}
                new_codex = []
                for p in body["codexProviders"]:
                    old = existing_map.get(p.get("id"), {})
                    new_codex.append({
                        **p,
                        "api_key": p.get("api_key") or old.get("api_key", ""),
                        "api_keys": p.get("api_keys") if isinstance(p.get("api_keys"), list) and p.get("api_keys") else old.get("api_keys", [])
                    })
                app_config["codexProviders"] = new_codex
            if isinstance(body.get("imageProviders"), list) and len(body["imageProviders"]) > 0:
                existing_img_map = {p.get("id"): p for p in app_config.get("imageProviders", [])}
                new_img = []
                for p in body["imageProviders"]:
                    old = existing_img_map.get(p.get("id"), {})
                    new_img.append({
                        **p,
                        "api_key": p.get("api_key") or old.get("api_key", "")
                    })
                app_config["imageProviders"] = new_img
            save_config(app_config)
            self.send_json({"ok": True, "message": "渠道配置预设已成功导入"})
            return

        if path == "/api/system/clear-history":
            recent_generated_files.clear()
            removed = 0
            if os.path.exists(OUTPUTS_DIR):
                for f in os.listdir(OUTPUTS_DIR):
                    if re.search(r"\.(png|jpg|jpeg|webp|json)$", f, re.I):
                        try:
                            os.unlink(os.path.join(OUTPUTS_DIR, f))
                            removed += 1
                        except Exception:
                            pass
            self.send_json({"ok": True, "removed": removed, "message": "已清理本地生成的图片与历史记录"})
            return

        if path == "/api/codex/restore":
            paths = get_codex_paths()
            if os.path.exists(paths["configTomlBak"]):
                shutil.copy2(paths["configTomlBak"], paths["configToml"])
                self.send_json({"ok": True, "message": "已从备份恢复 Codex 原始 config.toml"})
                return
            self.send_json({"ok": True, "message": "未检测到旧备份，当前已是干净配置"})
            return

        if path in ("/api/codex/toggle", "/api/codex/gateway-settings"):
            if "mode1_llm_tool" in body: app_config["mode1_llm_tool"] = bool(body["mode1_llm_tool"])
            if "mode2_prefix_direct" in body: app_config["mode2_prefix_direct"] = bool(body["mode2_prefix_direct"])
            if "sync_image_key" in body: app_config["syncImageKey"] = bool(body["sync_image_key"])
            if "routing_mode" in body: app_config["routingMode"] = body["routing_mode"]
            if "connection_category" in body: app_config["connectionCategory"] = body["connection_category"]
            if "official_reasoning_effort" in body: app_config["officialReasoningEffort"] = body["official_reasoning_effort"]
            if "official_model" in body: app_config["officialModel"] = body["official_model"]
            save_config(app_config)
            self.send_json({
                "ok": True,
                "success": True,
                "mode1_llm_tool": app_config["mode1_llm_tool"],
                "mode2_prefix_direct": app_config["mode2_prefix_direct"],
                "routing_mode": app_config["routingMode"],
                "connection_category": app_config.get("connectionCategory", "relay_api"),
                "message": "设置已更新"
            })
            return

        if path in ("/api/providers/active", "/api/providers/activate"):
            target_id = body.get("codex_provider_id") or body.get("image_provider_id") or body.get("id")
            if body.get("codex_provider_id") or any(p.get("id") == target_id for p in app_config.get("codexProviders", [])):
                app_config["activeCodexProvider"] = target_id
                save_config(app_config)
                self.send_json({"ok": True, "success": True, "activeCodex": target_id, "message": "当前生效 API 渠道已切换"})
                return
            if body.get("image_provider_id") or any(p.get("id") == target_id for p in app_config.get("imageProviders", [])):
                app_config["activeImageProvider"] = target_id
                save_config(app_config)
                self.send_json({"ok": True, "success": True, "activeImage": target_id, "message": "生图引擎已切换"})
                return
            self.send_json({"ok": True, "active": target_id})
            return

        if path == "/api/providers/delete":
            target_id = body.get("id")
            c_list = app_config.get("codexProviders", [])
            if len(c_list) <= 1:
                self.send_json({"error": "至少需要保留一个渠道配置"}, 400)
                return
            app_config["codexProviders"] = [p for p in c_list if p.get("id") != target_id]
            if app_config.get("activeCodexProvider") == target_id:
                app_config["activeCodexProvider"] = app_config["codexProviders"][0]["id"]
            save_config(app_config)
            self.send_json({"ok": True, "activeCodex": app_config["activeCodexProvider"], "message": "渠道已删除"})
            return

        if path == "/api/providers/probe":
            b_url = (body.get("base_url") or "").strip().rstrip("/")
            k = (body.get("api_key") or "").strip()
            p_match = next((p for p in app_config.get("codexProviders", []) if p.get("id") == body.get("id")), None) or next((p for p in app_config.get("imageProviders", []) if p.get("id") == body.get("id")), None)
            if (not k or "..." in k or k == "****") and p_match:
                k = p_match.get("api_key", "")
            if not b_url and p_match:
                b_url = p_match.get("base_url", "").rstrip("/")
            if not b_url:
                self.send_json({"error": "请先填写接口地址 Base URL"}, 400)
                return
            t_url = f"{b_url}/models" if b_url.endswith("/v1") else f"{b_url}/v1/models"
            t0 = time.time()
            try:
                headers = {"Accept": "application/json"}
                if k: headers["Authorization"] = f"Bearer {k}"
                req = urllib.request.Request(t_url, headers=headers, method="GET")
                with urllib.request.urlopen(req, timeout=8) as resp:
                    lat = int((time.time() - t0) * 1000)
                    self.send_json({
                        "ok": True,
                        "reachable": True,
                        "status_code": resp.status,
                        "latency_ms": lat,
                        "message": f"连通成功 ({lat}ms · HTTP {resp.status})"
                    })
                    return
            except Exception as e:
                self.send_json({"ok": False, "reachable": False, "message": f"连接失败: {e}"})
                return

        if path in ("/api/models/fetch", "/api/providers/fetch-models"):
            purpose = body.get("purpose", "all")
            b_url = (body.get("base_url") or "").strip()
            k = (body.get("api_key") or "").strip()
            act_c = next((p for p in app_config.get("codexProviders", []) if p.get("id") == (body.get("id") or app_config.get("activeCodexProvider"))), None) or (app_config.get("codexProviders") or [{}])[0]
            eff_img = get_effective_image_provider()
            if not b_url:
                b_url = eff_img.get("base_url") if purpose == "image" else act_c.get("base_url")
            if not k or "..." in k or k == "****":
                m_img = next((p for p in app_config.get("imageProviders", []) if p.get("id") == body.get("id")), None)
                m_cod = next((p for p in app_config.get("codexProviders", []) if p.get("id") == body.get("id")), None)
                k = (m_img and m_img.get("api_key")) or (m_cod and m_cod.get("api_key")) or eff_img.get("api_key") or act_c.get("api_key", "")

            fetched, detected_imgs, last_err = fetch_models_from_upstream(b_url, k)
            def_imgs = ["gpt-image-2", "gpt-image-1", "gpt-4o-image", "dall-e-3", "flux-pro", "flux-dev", "black-forest-labs/FLUX.1-schnell", "dall-e-2"]
            def_cods = ["gpt-5-codex", "gpt-4o", "gpt-4o-mini", "o3-mini", "o1", "claude-3-7-sonnet-latest", "claude-3-5-sonnet-20241022", "deepseek-chat", "deepseek-reasoner"]

            if fetched:
                sorted_imgs = sorted(detected_imgs, key=lambda x: (-1 if re.search(r"gpt-image-2|gpt-image-1|dall-e-3|gpt-4o-image|flux-pro", x, re.I) else 1, x)) if detected_imgs else def_imgs
                sorted_all = sorted(fetched, key=lambda x: (-1 if IMAGE_MODEL_PATTERN.search(x) else 1, x)) if purpose == "image" else sorted(fetched, key=lambda x: (-1 if re.search(r"gpt-5|gpt-4o|claude|deepseek|o1|o3", x, re.I) else 1, x))
                self.send_json({
                    "ok": True,
                    "success": True,
                    "count": len(sorted_all),
                    "models": sorted_all,
                    "image_models": sorted_imgs,
                    "detected_image_count": len(detected_imgs),
                    "source": "relay_online",
                    "message": f"已从中转站拉取 {len(sorted_all)} 个模型（精准识别出 {len(detected_imgs)} 个生图模型）" if purpose == "image" else f"成功从中转站拉取 {len(sorted_all)} 个可用模型"
                })
                return

            comb = (def_imgs + def_cods) if purpose == "image" else (def_cods + def_imgs)
            self.send_json({
                "ok": True,
                "success": True,
                "fallback": True,
                "count": len(comb),
                "models": comb,
                "image_models": def_imgs,
                "detected_image_count": 0,
                "message": f"中转站未开放公开 /models 列表 ({last_err or '404'})，已自动载入标准主力与生图模型库供直接选取"
            })
            return

        if path in ("/api/codex/apply", "/api/codex/apply-provider"):
            cat = body.get("connection_category") or app_config.get("connectionCategory", "relay_api")
            app_config["connectionCategory"] = cat
            app_config["onboarding_completed"] = True
            if body.get("official_reasoning_effort"): app_config["officialReasoningEffort"] = body["official_reasoning_effort"]
            if body.get("official_model"): app_config["officialModel"] = body["official_model"]
            t_id = body.get("id") or body.get("codex_provider_id") or app_config.get("activeCodexProvider")
            prov = next((p for p in app_config.get("codexProviders", []) if p.get("id") == t_id), app_config.get("codexProviders", [{}])[0])
            if prov: app_config["activeCodexProvider"] = prov["id"]
            if body.get("routing_mode"): app_config["routingMode"] = body["routing_mode"]
            save_config(app_config)
            sync_res = sync_provider_to_codex_toml(prov, app_config.get("routingMode", "gateway"), cat)
            record_gateway_event(
                source="Codex 路由同步",
                message=cat if cat == "official_skill" else f"{prov.get('name')} ({prov.get('model')})",
                action="🚀 已同步写入 ~/.codex/config.toml 并挂载全局生图 Skill",
                status="success"
            )
            self.send_json({"ok": True, "success": True, **sync_res})
            return

        if path in ("/api/providers/save", "/api/providers"):
            p_type = body.get("type") or ("image" if body.get("provider", {}).get("generation_path") else "codex")
            p = body.get("provider") or body
            if "sync_image_key" in body:
                app_config["syncImageKey"] = bool(body["sync_image_key"])

            if p_type == "codex":
                c_list = app_config.get("codexProviders", [])
                match_p = next((x for x in c_list if x.get("id") == p.get("id")), None)
                final_key = p.get("api_key", "")
                if match_p:
                    if not final_key or "..." in final_key or final_key == "****":
                        final_key = match_p.get("api_key", "")
                    match_p.update({**p, "api_key": final_key})
                else:
                    new_id = p.get("id") or f"codex-{os.urandom(3).hex()}"
                    c_list.append({
                        "id": new_id,
                        "category": p.get("category", "relay_api"),
                        "name": p.get("name", "自定义 API 渠道"),
                        "base_url": p.get("base_url", "https://api.openai-proxy.org/v1"),
                        "model": p.get("model", "gpt-4o"),
                        "wire_api": p.get("wire_api", "responses"),
                        "api_key": final_key,
                        "notes": p.get("notes", "")
                    })
                    p["id"] = new_id
                if p.get("id"):
                    app_config["activeCodexProvider"] = p["id"]

                img_relay = next((img for img in app_config.get("imageProviders", []) if img.get("id") == "image-relay"), (app_config.get("imageProviders") or [{}])[0])
                if img_relay:
                    if body.get("image_model"):
                        img_relay["model"] = body["image_model"]
                    if app_config.get("syncImageKey", True) and final_key and final_key != "ollama":
                        img_relay["api_key"] = final_key
                        if p.get("base_url"):
                            img_relay["base_url"] = p["base_url"]

                save_config(app_config)
                self.send_json({
                    "ok": True,
                    "success": True,
                    "activeCodex": app_config["activeCodexProvider"],
                    "message": f"API 渠道已保存（生图引擎已同步绑定模型：{img_relay.get('model', 'gpt-image-2') if img_relay else 'gpt-image-2'}）" if app_config.get("syncImageKey", True) else "API 渠道配置已保存"
                })
                return
            else:
                img_list = app_config.get("imageProviders", [])
                match_p = next((x for x in img_list if x.get("id") == p.get("id")), None)
                final_key = p.get("api_key", "")
                if match_p:
                    if not final_key or "..." in final_key or final_key == "****":
                        final_key = match_p.get("api_key", "")
                    match_p.update({**p, "api_key": final_key})
                else:
                    new_id = p.get("id") or f"img-{os.urandom(3).hex()}"
                    img_list.append({
                        "id": new_id,
                        "name": p.get("name", "自定义生图接口"),
                        "base_url": p.get("base_url", "https://api.openai-proxy.org/v1"),
                        "model": p.get("model", "gpt-image-2"),
                        "generation_path": p.get("generation_path", "/images/generations"),
                        "edit_path": p.get("edit_path", "/images/edits"),
                        "image_field": p.get("image_field", "image"),
                        "api_key": final_key
                    })
                    p["id"] = new_id
                if p.get("id"):
                    app_config["activeImageProvider"] = p["id"]
                save_config(app_config)
                self.send_json({"ok": True, "success": True, "activeImage": app_config["activeImageProvider"], "message": "生图引擎配置已保存"})
                return

        if path == "/api/generate":
            r = execute_image_task(
                prompt=body.get("prompt", ""),
                size=body.get("size", "1024x1024"),
                quality=body.get("quality", "standard"),
                dry_run=bool(body.get("dry_run")),
                ref_files=[],
                source=body.get("source", "studio-ui")
            )
            self.send_json(r)
            return

        if path in ("/api/edit", "/api/edit-url"):
            ct = self.headers.get("Content-Type", "")
            if "multipart/form-data" in ct:
                boundary = ct.split("boundary=")[-1].strip('"').encode("utf-8")
                parts = raw_body.split(b"--" + boundary)
                fields = {}
                files = []
                for part in parts:
                    if b"\r\n\r\n" not in part:
                        continue
                    header_raw, body_raw = part.split(b"\r\n\r\n", 1)
                    body_raw = body_raw.rstrip(b"\r\n")
                    header_str = header_raw.decode("utf-8", "ignore")
                    m_name = re.search(r'name="([^"]+)"', header_str)
                    m_file = re.search(r'filename="([^"]+)"', header_str)
                    if m_name:
                        k = m_name.group(1)
                        if m_file:
                            files.append({
                                "name": k,
                                "filename": m_file.group(1),
                                "contentType": "image/png",
                                "data": body_raw
                            })
                        else:
                            fields[k] = body_raw.decode("utf-8", "ignore")
                r = execute_image_task(
                    prompt=fields.get("prompt", ""),
                    size=fields.get("size", "1024x1024"),
                    quality=fields.get("quality", "standard"),
                    dry_run=bool(fields.get("dry_run")),
                    ref_files=files,
                    source="studio-edit"
                )
                self.send_json(r)
                return
            else:
                ref_files = []
                for idx, data_url in enumerate(body.get("images", [])):
                    m = re.match(r"^data:([^;]+);base64,(.+)$", str(data_url))
                    if m:
                        ref_files.append({
                            "filename": f"ref_{idx}.png",
                            "contentType": m.group(1),
                            "data": base64.b64decode(m.group(2))
                        })
                r = execute_image_task(
                    prompt=body.get("prompt", ""),
                    size=body.get("size", "1024x1024"),
                    quality=body.get("quality", "standard"),
                    dry_run=bool(body.get("dry_run")),
                    ref_files=ref_files,
                    source="studio-edit"
                )
                self.send_json(r)
                return

        self.send_json({"error": "Not found"}, 404)

    def send_synthesized_by_path(self, path, is_stream, content, model_name="gpt-image-2"):
        if path == "/v1/responses":
            resp_id = f"resp-{os.urandom(6).hex()}"
            if is_stream:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(f"event: response.created\ndata: {json.dumps({'response': {'id': resp_id, 'object': 'response', 'status': 'in_progress', 'model': model_name}})}\n\n".encode("utf-8"))
                self.wfile.write(f"event: response.output_text.delta\ndata: {json.dumps({'response_id': resp_id, 'delta': content})}\n\n".encode("utf-8"))
                self.wfile.write(f"event: response.completed\ndata: {json.dumps({'response': {'id': resp_id, 'object': 'response', 'status': 'completed', 'output_text': content, 'model': model_name}})}\n\n".encode("utf-8"))
                self.wfile.write(b"data: [DONE]\n\n")
            else:
                self.send_json({
                    "id": resp_id,
                    "object": "response",
                    "created": int(time.time()),
                    "model": model_name,
                    "status": "completed",
                    "output_text": content,
                    "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": content}]}],
                    "usage": {"total_tokens": 0, "input_tokens": 0, "output_tokens": 0}
                })
        else:
            chat_id = f"chatcmpl-{os.urandom(5).hex()}"
            if is_stream:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(f"data: {json.dumps({'id': chat_id, 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': model_name, 'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': ''}, 'finish_reason': None}]})}\n\n".encode("utf-8"))
                self.wfile.write(f"data: {json.dumps({'id': chat_id, 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': model_name, 'choices': [{'index': 0, 'delta': {'content': content}, 'finish_reason': None}]})}\n\n".encode("utf-8"))
                self.wfile.write(f"data: {json.dumps({'id': chat_id, 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': model_name, 'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]})}\n\n".encode("utf-8"))
                self.wfile.write(b"data: [DONE]\n\n")
            else:
                self.send_json({
                    "id": chat_id,
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": model_name,
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
                })

def main():
    server = HTTPServer((HOST, PORT), CodexStudioHandler)
    print(f"[Codex Studio v2.5.0 Python Kernel] Running on http://{HOST}:{PORT} | Gateway: /v1")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
