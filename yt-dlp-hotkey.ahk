; AutoHotkey Script para yt-dlp
; Ctrl+Alt+D = Baixar vídeo da clipboard

#NoEnv
SetBatchLines -1
#SingleInstance Force

; Caminho para o script Python
pythonScript := A_ScriptDir . "\yt-dlp-downloader.py"
pythonExe := "python"

; Verificar se o script Python está rodando
isRunning := false

; Atalho: Ctrl+Alt+D
^!d::
{
    global isRunning, pythonScript, pythonExe
    
    url := A_Clipboard
    
    ; Validar se tem um URL na clipboard
    if (url == "")
    {
        ToolTip, Nenhum link na clipboard!
        SetTimer, RemoveToolTip, 2000
        return
    }
    
    ; Verificar se é um URL de vídeo válido
    if !(InStr(url, "youtube") or InStr(url, "youtu.be") or InStr(url, "vimeo") 
        or InStr(url, "tiktok") or InStr(url, "twitch") or InStr(url, "dailymotion")
        or InStr(url, "reddit"))
    {
        ToolTip, Link inválido! Cole um vídeo (YouTube, Vimeo, TikTok, etc.)
        SetTimer, RemoveToolTip, 2000
        return
    }
    
    ; Iniciar o download
    ToolTip, 🎥 Iniciando download...`n%url%
    SetTimer, RemoveToolTip, 3000
    
    ; Executar Python script de forma assíncrona
    Run, %pythonExe% "%pythonScript%",,Hide
    
    return
}

RemoveToolTip:
SetTimer, RemoveToolTip, Off
ToolTip
return

; Atalho alternativo: Ctrl+Alt+Y (para abrir a pasta de downloads)
^!y::
{
    downloadDir := A_MyDocuments . "\..\Downloads\yt-dlp"
    Run, explorer.exe "%downloadDir%"
}

^!l::
{
    downloadDir := A_MyDocuments . "\..\Downloads\yt-dlp"
    logFile := downloadDir . "\downloads.log"
    Run, notepad.exe "%logFile%"
}
