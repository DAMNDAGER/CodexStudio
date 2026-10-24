# ==============================================================================
# Codex Studio v2.6.0 - Windows Native System Tray Daemon (100% Pure 7-bit ASCII)
# Zero encoding issues on any Windows codepage (GBK / CP936 / UTF-8 / Shift-JIS)
# ==============================================================================

$ErrorActionPreference = "SilentlyContinue"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function U([string]$str) {
    return [System.Text.RegularExpressions.Regex]::Unescape($str)
}

# Single instance check via Mutex
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, "Global\CodexStudioTray_v260", [ref]$createdNew)
if (-not $createdNew) {
    exit 0
}

$appDir = $PSScriptRoot
$url = "http://127.0.0.1:8765"

function Get-LocalServiceHeaders {
    $tokenFile = Join-Path $appDir ".image2-token"
    $tok = "AguLw4mZOaKQiKkm5I8V-K8545Dao7LysiUr-2edpqg"
    if (Test-Path $tokenFile) {
        try {
            $readTok = (Get-Content -Path $tokenFile -Raw -Encoding UTF8).Trim()
            if ($readTok.Length -ge 16) { $tok = $readTok }
        } catch {}
    }
    return @{ "X-Image2-Local-Token" = $tok }
}

function Create-CodexTrayIcon {
    try {
        $bmp = New-Object System.Drawing.Bitmap(32, 32)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.Clear([System.Drawing.Color]::Transparent)

        $brushBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0, 113, 227))
        $g.FillEllipse($brushBg, 1, 1, 29, 29)

        $penWhite = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 3.2)
        $g.DrawLine($penWhite, 9, 10, 16, 16)
        $g.DrawLine($penWhite, 16, 16, 9, 22)
        $g.DrawLine($penWhite, 17, 22, 24, 22)

        $g.Dispose()
        $hIcon = $bmp.GetHicon()
        return [System.Drawing.Icon]::FromHandle($hIcon)
    } catch {
        return [System.Drawing.SystemIcons]::Application
    }
}

function Launch-DesktopApp([string]$targetUrl = $url) {
    $profileDir = Join-Path $env:LOCALAPPDATA "CodexStudio\WindowProfile_v260"
    $defDir = Join-Path $profileDir "Default"
    try {
        if (-not (Test-Path $defDir)) {
            New-Item -ItemType Directory -Path $defDir -Force | Out-Null
        }
        $prefFile = Join-Path $defDir "Preferences"
        $prefJson = '{"browser":{"window_placement":{"bottom":920,"left":120,"maximized":false,"right":1560,"top":60,"work_area_bottom":1040,"work_area_left":0,"work_area_right":1920,"work_area_top":0}}}'
        [System.IO.File]::WriteAllText($prefFile, $prefJson, [System.Text.Encoding]::ASCII)
    } catch {}

    $winArgs = "--user-data-dir=`"$profileDir`" --app=$targetUrl --window-size=1440,860 --window-position=120,60"

    $edgeCandidates = @(
        "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
    )
    $edgeApp = $edgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($edgeApp) {
        Start-Process $edgeApp -ArgumentList $winArgs
        return
    }

    $chromeCandidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    $chromeApp = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($chromeApp) {
        Start-Process $chromeApp -ArgumentList $winArgs
        return
    }

    Start-Process $targetUrl
}

function Stop-AllServices {
    try {
        $hdrs = Get-LocalServiceHeaders
        Invoke-RestMethod -Uri "$url/api/system/shutdown" -Method Post -Headers $hdrs -TimeoutSec 2 -ErrorAction SilentlyContinue | Out-Null
    } catch {}

    Stop-Process -Name "Image2Studio" -Force -ErrorAction SilentlyContinue

    Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_.OwningProcess -gt 4) {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }

    if ($trayIcon) {
        $trayIcon.Visible = $false
        $trayIcon.Dispose()
    }

    [System.Windows.Forms.Application]::Exit()
    exit 0
}

$trayIcon = New-Object System.Windows.Forms.NotifyIcon
$trayIcon.Icon = Create-CodexTrayIcon
$trayIcon.Text = (U "Codex Studio v2.6.0 (127.0.0.1:8765 \u8fd0\u884c\u4e2d \u00b7 \u5355\u51fb\u6253\u5f00/\u53f3\u952e\u9000\u51fa)")
$trayIcon.Visible = $true

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$itemOpen = $contextMenu.Items.Add((U "\u6253\u5f00 Codex Studio \u684c\u9762\u5de5\u4f5c\u53f0"))
$itemOpen.Font = New-Object System.Drawing.Font($itemOpen.Font, [System.Drawing.FontStyle]::Bold)
$itemOpen.add_Click({ Launch-DesktopApp $url })

$itemGuide = $contextMenu.Items.Add((U "\u6253\u5f00\u65b0\u624b\u914d\u7f6e\u4e0e\u6e05\u7406\u5411\u5bfc"))
$itemGuide.add_Click({ Launch-DesktopApp "$url/#onboarding" })

$itemGC = $contextMenu.Items.Add((U "\u6574\u7406\u5fae\u5185\u6838\u5185\u5b58 (RAM GC)"))
$itemGC.add_Click({
    try {
        $hdrs = Get-LocalServiceHeaders
        Invoke-RestMethod -Uri "$url/api/system/gc" -Method Post -Headers $hdrs -TimeoutSec 2 -ErrorAction SilentlyContinue | Out-Null
        $trayIcon.ShowBalloonTip(1500, "Codex Studio", (U "\u540e\u53f0\u5fae\u5185\u6838\u5185\u5b58\u5df2\u6574\u7406\u5b8c\u6bd5"), [System.Windows.Forms.ToolTipIcon]::Info)
    } catch {}
})

$itemBrowser = $contextMenu.Items.Add((U "\u5728\u7cfb\u7edf\u6d4f\u89c8\u5668\u4e2d\u6253\u5f00"))
$itemBrowser.add_Click({ Start-Process $url })

$contextMenu.Items.Add("-") | Out-Null

$itemExit = $contextMenu.Items.Add((U "\u5f7b\u5e95\u5173\u95ed\u540e\u53f0\u5e76\u9000\u51fa (Quit)"))
$itemExit.ForeColor = [System.Drawing.Color]::FromArgb(255, 220, 38, 38)
$itemExit.Font = New-Object System.Drawing.Font($itemExit.Font, [System.Drawing.FontStyle]::Bold)
$itemExit.add_Click({ Stop-AllServices })

$trayIcon.ContextMenuStrip = $contextMenu

$trayIcon.add_DoubleClick({ Launch-DesktopApp $url })
$trayIcon.add_MouseClick({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        Launch-DesktopApp $url
    }
})

$trayIcon.ShowBalloonTip(
    2500,
    (U "Codex Studio v2.6.0 \u5df2\u5728\u53f3\u4e0b\u89d2\u5e38\u9a7b"),
    (U "\u5de6\u952e\u5355\u51fb\u56fe\u6807\u53ef\u968f\u65f6\u5524\u51fa\u754c\u9762\uff0c\u53f3\u952e\u70b9\u51fb\u53ef\u5f7b\u5e95\u5173\u95ed\u540e\u53f0\u670d\u52a1\u3002"),
    [System.Windows.Forms.ToolTipIcon]::Info
)

[System.Windows.Forms.Application]::Run()
