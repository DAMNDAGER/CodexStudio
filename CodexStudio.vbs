Option Explicit

Dim fso, shell, appDir, q, rc
q = Chr(34)
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = appDir

On Error Resume Next
Err.Clear
rc = shell.Run("node.exe " & q & appDir & "\server.js" & q & " --desktop", 0, False)
If Err.Number <> 0 Then
    Err.Clear
    rc = shell.Run("python.exe " & q & appDir & "\server.py" & q & " --desktop", 0, False)
    If Err.Number <> 0 Then
        Err.Clear
        rc = shell.Run("py.exe -3 " & q & appDir & "\server.py" & q & " --desktop", 0, False)
    End If
End If
On Error GoTo 0
WScript.Quit 0
