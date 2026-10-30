' Katun Studio launcher: opens the app without a console window (desktop icon points here).
' Closing the app window closes the program. On failure, shows a message and opens the log.
' Keep this file ASCII-only: Windows Script Host cannot read UTF-8.
Option Explicit
Dim sh, fso, dir, logDir, logFile, code
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
logDir = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Katun"
If Not fso.FolderExists(logDir) Then fso.CreateFolder logDir
logFile = logDir & "\katun.log"
sh.CurrentDirectory = dir
code = sh.Run("cmd /c node bin\katun.js app > """ & logFile & """ 2>&1", 0, True)
If code <> 0 Then
  MsgBox "Katun Studio could not start (code " & code & ")." & vbCrLf & "See the log file that opens next, or run install.cmd again.", vbExclamation, "Katun Studio"
  sh.Run "notepad """ & logFile & """", 1, False
End If
