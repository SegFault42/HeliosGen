#!/usr/bin/env python3
"""
yt-dlp Auto Downloader
Monitora a clipboard e baixa vídeos automaticamente com Ctrl+Alt+D
"""

import os
import sys
import subprocess
import time
import pyperclip
from pathlib import Path
from datetime import datetime

# Configuração
DOWNLOAD_DIR = Path.home() / "Downloads" / "yt-dlp"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

LOG_FILE = DOWNLOAD_DIR / "downloads.log"

def log_message(message):
    """Registra mensagem no log"""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_entry = f"[{timestamp}] {message}"
    print(log_entry)
    
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(log_entry + "\n")

def is_valid_url(url):
    """Verifica se é um URL de vídeo válido"""
    valid_domains = [
        "youtube.com", "youtu.be", 
        "vimeo.com", "dailymotion.com", 
        "twitch.tv", "reddit.com", "tiktok.com"
    ]
    return any(domain in url for domain in valid_domains)

def download_video(url):
    """Baixa o vídeo usando yt-dlp"""
    try:
        log_message(f"⏳ Iniciando download: {url}")
        
        output_template = str(DOWNLOAD_DIR / "%(title)s.%(ext)s")
        
        cmd = [
            "yt-dlp",
            "-f", "best",
            "-o", output_template,
            "--progress",
            url
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            log_message(f"✅ Download concluído com sucesso!")
            return True
        else:
            log_message(f"❌ Erro no download: {result.stderr}")
            return False
            
    except Exception as e:
        log_message(f"❌ Exceção: {str(e)}")
        return False

def main():
    """Loop principal de monitoramento"""
    log_message("🎥 yt-dlp Downloader iniciado!")
    log_message(f"📁 Salvando em: {DOWNLOAD_DIR}")
    log_message("Aguardando Ctrl+Alt+D ou colagem de links...\n")
    
    last_url = ""
    
    while True:
        try:
            current_url = pyperclip.paste().strip()
            
            # Detecta novo URL
            if (current_url != last_url and 
                is_valid_url(current_url) and 
                len(current_url) > 10):
                
                last_url = current_url
                log_message(f"📋 Link detectado: {current_url}")
                download_video(current_url)
                log_message("")
            
            time.sleep(0.5)
            
        except Exception as e:
            log_message(f"⚠️  Erro no loop: {str(e)}")
            time.sleep(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log_message("\n🛑 Downloader finalizado.")
        sys.exit(0)
