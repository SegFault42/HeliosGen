# Flow confiável: design

Data: 2026-09-22
Escopo: subsistema C do inventário de bugs (confiabilidade da geração via Google Flow).
Fora de escopo: A (tsc/lint), B (higiene restante do repo), D (clipboard sentinel). Cada um ganha spec próprio depois.

## Objetivo

Os 4 fluxos abaixo rodam pelo Anvil, ponta a ponta, sem ninguém tocar na aba do Flow:

1. Imagem via Flow (Nano Banana 2 / Nano Banana Pro)
2. Texto para vídeo (Omni Flash 1.1 / Veo 3.1)
3. Start frame para vídeo (Omni Flash 1.1 com imagem anexada)
4. Interpolação A para B (Veo Frame A→B, start + end frame)

## Causa raiz medida

`mediaLocator()` em `google-flow-mcp/src/flow-adapter.ts:1149` conta qualquer `img[src*='/asb/']` da página, inclusive a miniatura do start frame que o chat do agente ecoa na mensagem do usuário logo após o envio. Isso gera a cadeia:

1. `clickGenerate()` (linha 1128) vê a contagem subir, retorna achando que a geração começou e nunca clica em "Always approve".
2. `waitForNewMedia()` trata o eco como mídia gerada e marca o job `ready` com a identidade da imagem.
3. O download salva essa imagem como `.mp4` (confirmado: `flow-7accee0d.mp4` e `flow-5aaa968f.mp4` são JPEG de 85KB).

Texto para vídeo funciona hoje porque não há eco de imagem no chat.

Achados secundários:

- O timeout do poller em `lib/flowJobPoller.ts` é por contagem (150 tentativas), mas cada tentativa espera até 15s dentro de `refreshJob`. O prazo real vira cerca de 50 min, e o job fica `pending` sem virar erro.
- `downloadTracked()` (linha 1539) marca o job `completed` mesmo quando baixou zero arquivos.
- Entrar pela home do Flow (projeto novo) falha com "Could not find Flow's Generate control".
- Falhas do poller só aparecem com DEBUG ligado (`dlog`).

## Design

### 1. Baseline e projeto fixo

- HeliosGen: apagar os 20 arquivos `*.bak-*`; commit `wip: baseline before flow reliability fixes` com o restante do estado atual.
- google-flow-mcp: apagar os PNGs de debug soltos na raiz; commit baseline do WIP (inclui `bookmarklet.js`, `extension/background.js`, `extension/content.js`, scripts novos).
- Nova env `FLOW_PROJECT_URL` lida em `lib/flowAdapter.ts` e repassada como `flowProject` para `flow.generate()` em `submitFlowImage` e `submitFlowVideo`. Sem a env, erro explícito: "FLOW_PROJECT_URL não configurada". O projeto é criado uma vez à mão no Flow e a URL vai para `.env.local`.

### 2. Detecção de mídia e aprovação (google-flow-mcp)

- Primeiro passo da implementação: sonda de DOM (somente leitura, sem job rodando) para identificar o container do painel de chat do agente.
- `mediaLocator(page, type)`:
  - exclui elementos dentro do painel de chat;
  - respeita `type`: vídeo conta só `flow-video-tile` e `video`; imagem conta só `flow-image-tile` e `img` da grade.
- `clickGenerate()` no modo agente: o retorno antecipado só acontece se apareceu tile do tipo certo na grade. O loop segue até achar o widget de aprovação e clicar na opção persistente ("Always approve").
- Trava de conteúdo no download: antes de gravar, checar `content-type` ou magic bytes. Imagem num job de vídeo vira erro `download_type_mismatch` em vez de arquivo salvo.
- `downloadTracked()`: zero arquivos baixados marca o job `failed` com `download_failed`, não `completed`.
- Mantidos os fixes já aplicados: clique no item "Upload" do menu "Add media" e Método 0 restrito a jobs de imagem.

### 3. Poller e visibilidade (HeliosGen)

- `lib/flowJobPoller.ts`: prazo por relógio a partir da criação do job. Imagem 5 min, vídeo 20 min. Estourou, `settle` com erro "Flow timed out after N min".
- Erro fatal encerra na hora: exceção de `refreshFlowJob` com código em `generated_asset_not_found`, `job_asset_identity_missing`, `ui_changed`, `login_required`, `download_failed`, `download_type_mismatch` vira erro no card imediatamente. Demais erros seguem como transitórios até o prazo.
- Falhas vão para `console.error` sempre; `dlog` fica só para logs de sucesso.
- Mensagem de erro no card inclui o caminho do screenshot de diagnóstico que o MCP já salva (`diagnosticScreenshot`).
- Mantido: `downloadFlowJob()` em `lib/flowAdapter.ts` como único caminho de download (sem grab manual por chave).

### 4. Testes e critério de pronto

- Unitários, um por lógica não trivial:
  - google-flow-mcp (`tests/*.test.ts`, `tsx --test`): classificação de mídia (eco no chat não conta, tipo errado não conta) e trava de conteúdo.
  - HeliosGen (`scripts/workflow-behavior.test.cjs`): prazo por relógio e classificação de erro fatal.
- Smoke ao vivo: `scripts/flow-smoke.mjs` chama a API do Anvil em `localhost:3000` para os 4 fluxos, espera cada job terminar e valida o arquivo com `ffprobe`. Imagem precisa ter codec de imagem (png, mjpeg ou webp) e extensão correspondente. Vídeo precisa ter codec h264 e duração maior que zero.
- Pronto quando: 2 rodadas seguidas do smoke, 4 de 4 passando em cada, sem interação manual com a aba do Flow durante a execução.
- Custo estimado em créditos Flow: cerca de 6 vídeos e 2 imagens.

## Restrições

- O Chrome Agente (CDP na porta 9444) é compartilhado com uso pessoal. Durante o smoke, a aba do Flow não pode ser tocada, nem por mim via CDP.
- A sessão do `codex login` expirada é externa e fica fora deste spec.
