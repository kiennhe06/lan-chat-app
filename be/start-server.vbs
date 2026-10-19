'LANChat Server - chay AN (khong cua so console).
'Uu tien Node portable trong thu muc node\, neu khong co thi dung Node cai san tren may.
'Dung server: Task Manager > Details > node.exe (hoac xem README.md).
Option Explicit

Dim fso, shell, baseDir, nodeExe, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
nodeExe = baseDir & "\node\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node"

shell.CurrentDirectory = baseDir
command = """" & nodeExe & """ """ & baseDir & "\index.js"""

On Error Resume Next
shell.Run command, 0, False
If Err.Number <> 0 Then
  MsgBox "Khong khoi dong duoc LANChat Server: " & Err.Description & vbCrLf & _
    "Hay chay start-server.bat de xem chi tiet loi.", vbCritical, "LANChat Server"
End If
On Error GoTo 0
