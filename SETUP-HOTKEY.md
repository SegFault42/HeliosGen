# 🎥 yt-dlp Hotkey Setup - Windows

Guia completo para configurar atalho de teclado global (Ctrl+Alt+D) para baixar vídeos automaticamente.

## 📋 Requisitos

- Python 3.7+
- yt-dlp
- AutoHotkey v2.0+
- Windows 10/11

## 🚀 Instalação Rápida

### 1. Instalar Dependências Python

```bash
pip install yt-dlp pyperclip
```

### 2. Baixar e Instalar AutoHotkey

1. Acesse: https://www.autohotkey.com/download/
2. Baixe o instalador v2.0+
3. Execute a instalação

### 3. Configurar o Atalho

1. **Copie os arquivos para uma pasta permanente:**
   ```
   C:\Users\[SeuUser]\AppData\Local\yt-dlp\
   ```
   - `yt-dlp-downloader.py`
   - `yt-dlp-hotkey.ahk`

2. **Edite o arquivo `yt-dlp-hotkey.ahk`** e atualize o caminho se necessário:
   ```autohotkey
   pythonScript := "C:\Users\[SeuUser]\AppData\Local\yt-dlp\yt-dlp-downloader.py"
   ```

3. **Execute o script AutoHotkey:**
   - Clique duplo em `yt-dlp-hotkey.ahk`
   - Você verá um ícone na bandeja do sistema

### 4. Iniciar Automaticamente (Opcional)

Para que o atalho funcione sempre:

**Opção A: Adicionar à Inicialização do Windows**
1. Pressione `Win + R` e digite: `shell:startup`
2. Crie um atalho para `yt-dlp-hotkey.ahk` lá

**Opção B: Usar Task Scheduler**
1. Abra Task Scheduler
2. Crie uma nova tarefa com gatilho "At logon"
3. Ação: Execute `C:\Program Files\AutoHotkey\AutoHotkey.exe` com argumento `"C:\Users\[SeuUser]\AppData\Local\yt-dlp\yt-dlp-hotkey.ahk"`

## ⌨️ Atalhos Disponíveis

| Atalho | Ação |
|--------|------|
| **Ctrl+Alt+D** | Baixar vídeo da clipboard |
| **Ctrl+Alt+Y** | Abrir pasta de downloads |
| **Ctrl+Alt+L** | Ver log de downloads |

## 📥 Como Usar

1. **Copie um link de vídeo** (YouTube, TikTok, Vimeo, etc.)
2. **Pressione Ctrl+Alt+D**
3. **Aguarde** o download completar
4. O vídeo estará em: `C:\Users\[SeuUser]\Downloads\yt-dlp\`

## 🔧 Solução de Problemas

### "Python não encontrado"
```bash
# Adicione Python ao PATH
where python
# Se não retornar nada, instale novamente com "Add Python to PATH"
```

### "yt-dlp não encontrado"
```bash
pip install --upgrade yt-dlp
```

### AutoHotkey não dispara
- Verifique se está rodando (ícone na bandeja)
- Tente pressionar Ctrl+Alt+D novamente
- Reinicie o PC

### Download não inicia
1. Verifique o log: Ctrl+Alt+L
2. Teste manualmente: `yt-dlp "URL_DO_VIDEO"`

## 📊 Ver Downloads Realizados

Pressione **Ctrl+Alt+L** para abrir o arquivo de log de downloads.

## 🛑 Parar o Programa

Clique no ícone do AutoHotkey na bandeja e selecione "Exit".

---

**Pronto! Agora é só copiar um link e pressionar Ctrl+Alt+D** 🎉
