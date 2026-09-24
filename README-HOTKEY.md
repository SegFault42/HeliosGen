# 🎥 yt-dlp Hotkey Integration para Windows

Uma solução integrada ao Windows que permite baixar vídeos **automaticamente** pressionando **Ctrl+Alt+D**.

## ⚡ Como Funciona

1. Você **copia um link** de vídeo (YouTube, TikTok, Vimeo, etc.)
2. Pressiona **Ctrl+Alt+D**
3. O vídeo é baixado automaticamente para `C:\Users\[SeuUser]\Downloads\yt-dlp\`

## 📦 Arquivos Inclusos

- **`yt-dlp-downloader.py`** → Script Python que gerencia o download
- **`yt-dlp-hotkey.ahk`** → Script AutoHotkey para o atalho de teclado
- **`quick-install.bat`** → Instalação automática
- **`SETUP-HOTKEY.md`** → Documentação completa

## 🚀 Instalação Rápida (3 passos)

### 1️⃣ Executar Instalação
```bash
quick-install.bat
```
Isso vai instalar as dependências Python automaticamente.

### 2️⃣ Baixar e Instalar AutoHotkey
- Acesse: https://www.autohotkey.com/download/
- Baixe **AutoHotkey v2.0+**
- Execute o instalador

### 3️⃣ Iniciar o Hotkey
```powershell
# No PowerShell ou CMD:
$env:LOCALAPPDATA + "\yt-dlp\yt-dlp-hotkey.ahk" | Invoke-Item
```

Ou clique duplo em: `%LOCALAPPDATA%\yt-dlp\yt-dlp-hotkey.ahk`

## ⌨️ Atalhos Disponíveis

| Atalho | Ação |
|--------|------|
| **Ctrl+Alt+D** | 📥 Baixar vídeo da clipboard |
| **Ctrl+Alt+Y** | 📁 Abrir pasta de downloads |
| **Ctrl+Alt+L** | 📋 Ver log de downloads |

## 🔄 Iniciar Automaticamente (Recomendado)

Para que o atalho funcione sempre que você faz login:

**Opção A: Via Startup Folder**
```powershell
# Abra PowerShell e execute:
$link = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\yt-dlp-hotkey.lnk"
$target = "$env:LOCALAPPDATA\yt-dlp\yt-dlp-hotkey.ahk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = "C:\Program Files\AutoHotkey\AutoHotkey.exe"
$shortcut.Arguments = "`"$target`""
$shortcut.Save()
```

**Opção B: Manualmente**
1. Pressione `Win + R`
2. Digite: `shell:startup`
3. Crie um atalho para `yt-dlp-hotkey.ahk` lá

## 📊 Monitoramento

Os downloads são registrados em: `C:\Users\[SeuUser]\Downloads\yt-dlp\downloads.log`

Pressione **Ctrl+Alt+L** para visualizar o log.

## 🔧 Solução de Problemas

### ❌ "Python não encontrado"
```bash
# Verifique a instalação
python --version

# Se não funcionar, reinstale Python
# https://www.python.org/downloads/
# ✅ Marque "Add Python to PATH"
```

### ❌ "yt-dlp não encontrado"
```bash
pip install --upgrade yt-dlp
```

### ❌ AutoHotkey não dispara
- Verifique se está rodando (ícone na bandeja do sistema)
- Reinicie o PC
- Certifique-se de usar **AutoHotkey v2.0+**

### ❌ Download não inicia
1. Verifique o log: `Ctrl+Alt+L`
2. Teste manualmente:
```bash
yt-dlp "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

## 🎯 Formatos Suportados

A solução funciona com qualquer site suportado pelo yt-dlp:
- ✅ YouTube
- ✅ TikTok
- ✅ Vimeo
- ✅ Twitch
- ✅ DailyMotion
- ✅ Reddit
- ✅ Instagram
- ✅ Twitter/X
- ✅ E centenas de outros sites

## 💡 Personalizações

### Alterar Pasta de Downloads
Edite `yt-dlp-downloader.py` na linha:
```python
DOWNLOAD_DIR = Path.home() / "Downloads" / "yt-dlp"
```

### Alterar Atalho
Edite `yt-dlp-hotkey.ahk`:
```autohotkey
^!d::  ; Ctrl+Alt+D
```
Troque `^!d` por outro atalho:
- `^` = Ctrl
- `!` = Alt
- `#` = Windows
- `+` = Shift

Exemplos:
- `^!x::` = Ctrl+Alt+X
- `#v::` = Windows+V

## 🛑 Parar o Programa

Clique no ícone do AutoHotkey na bandeja do sistema (canto inferior direito) e selecione "Exit".

## 📝 Requisitos Finais

- ✅ Python 3.7+
- ✅ yt-dlp (instalado via pip)
- ✅ pyperclip (instalado via pip)
- ✅ AutoHotkey v2.0+
- ✅ Windows 10/11

---

**🎉 Pronto! Agora é só copiar um link e pressionar Ctrl+Alt+D**

Para mais documentação, veja `SETUP-HOTKEY.md`
