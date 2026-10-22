Option Explicit

Dim fso, shell, appDir, url, isRunning, attempts, started, engineDesc
Dim exePath, exeDir, p, possibleExes(3)

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = appDir
url = "http://127.0.0.1:8765"

Function CheckCurrentVersionService()
    CheckCurrentVersionService = False
    On Error Resume Next
    Dim req, bodyTxt
    Set req = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    If Err.Number <> 0 Then
        Err.Clear
        Set req = CreateObject("WinHttp.WinHttpRequest.5.1")
    End If
    If Err.Number = 0 Then
        req.setTimeouts 500, 500, 500, 500
        req.Open "GET", url & "/api/health", False
        req.Send
        If Err.Number = 0 Then
            If req.Status = 200 Then
                bodyTxt = req.responseText
                If InStr(bodyTxt, "2.5.0") > 0 Then
                    CheckCurrentVersionService = True
                End If
            End If
        End If
    End If
    Set req = Nothing
    Err.Clear
    On Error GoTo 0
End Function

Function CheckServiceReady()
    CheckServiceReady = False
    On Error Resume Next
    Dim req
    Set req = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    If Err.Number <> 0 Then
        Err.Clear
        Set req = CreateObject("WinHttp.WinHttpRequest.5.1")
    End If
    If Err.Number = 0 Then
        req.setTimeouts 500, 500, 500, 500
        req.Open "GET", url & "/api/health", False
        req.Send
        If Err.Number = 0 Then
            If req.Status = 200 Then
                CheckServiceReady = True
            End If
        End If
    End If
    Set req = Nothing
    Err.Clear
    On Error GoTo 0
End Function

Sub LaunchTrayDaemon()
    On Error Resume Next
    Dim trayScript
    trayScript = appDir & "\tray.ps1"
    If fso.FileExists(trayScript) Then
        shell.Run "powershell.exe -NoProfile -Sta -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & trayScript & """", 0, False
    End If
    On Error GoTo 0
End Sub

Sub AutoCleanPort8765()
    On Error Resume Next
    shell.Run "taskkill.exe /F /IM Image2Studio.exe /T", 0, True
    shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command ""Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue | ForEach-Object { if ($_.OwningProcess -gt 4) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }""", 0, True
    shell.Run "cmd.exe /c for /f ""tokens=5"" %p in ('netstat -aon ^| findstr 127.0.0.1:8765') do if not ""%p""==""0"" taskkill /f /pid %p", 0, True
    On Error GoTo 0
End Sub

Function IsRealNode()
    IsRealNode = False
    On Error Resume Next
    Dim res
    res = -1
    res = shell.Run("node.exe -e ""process.exit(0)""", 0, True)
    If Err.Number = 0 And res = 0 Then
        IsRealNode = True
    End If
    Err.Clear
    On Error GoTo 0
End Function

Function IsRealPythonExe()
    IsRealPythonExe = False
    On Error Resume Next
    Dim res
    res = -1
    res = shell.Run("python.exe -c ""import sys; sys.exit(0)""", 0, True)
    If Err.Number = 0 And res = 0 Then
        IsRealPythonExe = True
    End If
    Err.Clear
    On Error GoTo 0
End Function

Function IsRealPyLauncher()
    IsRealPyLauncher = False
    On Error Resume Next
    Dim res
    res = -1
    res = shell.Run("py.exe -3 -c ""import sys; sys.exit(0)""", 0, True)
    If Err.Number = 0 And res = 0 Then
        IsRealPyLauncher = True
    End If
    Err.Clear
    On Error GoTo 0
End Function

Function LaunchBrowser()
    On Error Resume Next
    Dim edgePaths(2), ep, launched
    edgePaths(0) = "msedge.exe"
    edgePaths(1) = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe")
    edgePaths(2) = shell.ExpandEnvironmentStrings("%ProgramFiles%\Microsoft\Edge\Application\msedge.exe")
    
    launched = False
    For Each ep In edgePaths
        Err.Clear
        If ep = "msedge.exe" Or fso.FileExists(ep) Then
            shell.Run """" & ep & """ --app=" & url & " --window-size=1280,820", 1, False
            If Err.Number = 0 Then
                launched = True
                Exit For
            End If
        End If
    Next

    If Not launched Then
        Err.Clear
        shell.Run "chrome.exe --app=" & url & " --window-size=1280,820", 1, False
        If Err.Number <> 0 Then
            Err.Clear
            shell.Run url, 1, False
        End If
    End If
    On Error GoTo 0
End Function

' Step 1: Pre-flight check. If v2.5.0 service is already alive, ensure tray daemon is running, open window, and exit.
isRunning = CheckCurrentVersionService()

If isRunning Then
    LaunchTrayDaemon()
    LaunchBrowser()
    WScript.Quit 0
End If

' Step 2: Auto-clean old or stuck processes on port 8765.
AutoCleanPort8765()
WScript.Sleep 400

' Step 3: Adaptive runtime engine selection.
started = False
engineDesc = ""

' Priority 1: Real Node.js (Ultra-low memory, full gateway parity)
If Not started And IsRealNode() And fso.FileExists(appDir & "\server.js") Then
    shell.CurrentDirectory = appDir
    shell.Run "node.exe """ & appDir & "\server.js""", 0, False
    started = True
    engineDesc = "Node.js Micro-Kernel (server.js)"
End If

' Priority 2: Real Python 3 via python.exe (Full gateway parity)
If Not started And IsRealPythonExe() And fso.FileExists(appDir & "\server.py") Then
    shell.CurrentDirectory = appDir
    shell.Run "python.exe """ & appDir & "\server.py""", 0, False
    started = True
    engineDesc = "Python 3 Micro-Kernel (server.py)"
End If

' Priority 3: Real Python 3 via Windows py.exe -3 Launcher
If Not started And IsRealPyLauncher() And fso.FileExists(appDir & "\server.py") Then
    shell.CurrentDirectory = appDir
    shell.Run "py.exe -3 """ & appDir & "\server.py""", 0, False
    started = True
    engineDesc = "Python Launcher (py.exe -3 server.py)"
End If

' Priority 4: Standalone Windows Binary fallback
possibleExes(0) = appDir & "\Image2Studio\Image2Studio.exe"
possibleExes(1) = appDir & "\Image2Studio\Image2Studio\Image2Studio.exe"
possibleExes(2) = appDir & "\Image2Studio.exe"
possibleExes(3) = appDir & "\dist\Image2Studio\Image2Studio.exe"

exePath = ""
For Each p In possibleExes
    If fso.FileExists(p) Then
        exePath = p
        exeDir = fso.GetParentFolderName(p)
        Exit For
    End If
Next

If Not started And exePath <> "" Then
    shell.CurrentDirectory = exeDir
    shell.Run """" & exePath & """", 0, False
    started = True
    engineDesc = "Standalone Windows Runtime (Image2Studio.exe)"
End If

If Not started Then
    MsgBox "Unable to start Codex Studio. Please ensure Node.js, Python 3, or the standalone Windows runtime is present in this folder.", 16, "Codex Studio Launch Error"
    WScript.Quit 1
End If

' Step 4: Health wait loop (max 15 seconds)
attempts = 0
Do While attempts < 30
    WScript.Sleep 400
    If CheckServiceReady() Then
        isRunning = True
        Exit Do
    End If
    attempts = attempts + 1
Loop

' Step 5: Launch Windows System Tray Daemon
LaunchTrayDaemon()

' Step 6: Launch Dedicated Desktop App Window
LaunchBrowser()
WScript.Quit 0
