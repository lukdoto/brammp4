# brammp4: reprodutor estilo streaming para HDs externos

Data: 2026-10-14
Status: rascunho para revisão

## 1. Objetivo e critérios de sucesso

Um app desktop (Windows) que transforma os filmes e séries guardados em dois HDs externos
num catálogo estilo streaming, funciona sem internet e lembra exatamente onde cada vídeo parou.

Critérios de sucesso da v1:

1. Abrir o app e ver um catálogo com capas, com a fileira "Continuar assistindo" no topo.
2. Na tela de uma série, cada episódio mostra a etiqueta `S01E03` e uma barra de progresso
   (parte assistida colorida, restante em cinza).
3. Antes do play, escolher legenda, áudio e versão (quando houver mais de uma).
4. O vídeo abre em tela cheia e toca qualquer formato comum (MKV, MP4, AVI, x265, AC3/DTS, legendas embutidas e `.srt`).
5. Ao fechar o player, fechar o app ou desligar o notebook de forma abrupta, a perda máxima de progresso é de 5 segundos.
6. Conectar e desconectar qualquer um dos dois HDs a qualquer momento sem perder progresso nem duplicar títulos.
7. O progresso tem backup na conta Google do usuário e pode ser restaurado num notebook novo.
8. Assistir não depende de internet. A internet só é usada para baixar metadados e fazer o backup.

Fora do escopo da v1, com base preparada para depois: sincronização entre vários aparelhos,
perfis por pessoa, transcodificação, streaming para outros dispositivos.

## 2. Decisões de arquitetura

| Decisão | Escolha | Motivo |
|---|---|---|
| Plataforma | Electron + TypeScript | O usuário domina JS/TS; o código inteiro fica numa linguagem só |
| Interface | React + Vite (electron-vite) | Ecossistema conhecido, recarregamento rápido |
| Reprodução | mpv como processo separado, controlado por JSON IPC (named pipe) | Toca qualquer formato; o app não precisa decodificar vídeo |
| Interface do player | Script uosc no mpv | Barra moderna, menus de legenda e áudio e miniaturas sem escrever um player |
| Leitura de faixas | ffprobe (saída JSON) | Lista faixas, idiomas, duração e resolução sem abrir o vídeo |
| Banco local | SQLite (better-sqlite3, modo WAL) | Arquivo único, sem servidor, gravação segura contra desligamento abrupto |
| Metadados | TMDB com cache em disco | Capas e sinopses grátis para uso pessoal; offline usa o cache |
| Backup | Google Drive `appDataFolder` (escopo `drive.appdata`) | Sem servidor próprio; arquivo invisível ao usuário e isolado de outros apps |

Alternativas descartadas: player HTML5 (não toca x265/DTS de forma confiável), Tauri (exige Rust),
libmpv embutido na janela (complexo e com plugin pouco testado; pode ser uma evolução futura,
já que o restante do app não depende de onde o vídeo é desenhado).

## 3. Componentes

Todos rodam no processo principal do Electron, exceto a Interface. A Interface conversa com o principal
apenas por uma API explícita exposta via `preload` + `contextBridge`.

| Componente | Responsabilidade | Depende de |
|---|---|---|
| `drives` | Detecta HDs conectados (varredura das letras a cada 3 s procurando `.brammp4.json`), registra HDs novos | sistema de arquivos |
| `scanner` | Percorre um HD, reconhece episódios e filmes pelo nome, roda ffprobe nos arquivos novos ou alterados | `drives`, `db`, `parser` |
| `parser` | Função pura: caminho do arquivo para `{tipo, nome, ano, temporada, episódio, versão}` | nada |
| `metadata` | Associa títulos ao TMDB, baixa capas para o cache, preenche nomes e sinopses de episódios | `db`, rede |
| `db` | Esquema SQLite, migrações e consultas | better-sqlite3 |
| `player` | Inicia o mpv com as faixas e a posição escolhidas, observa `time-pos`, `pause` e fim de arquivo | mpv |
| `progress` | Regras de salvar, "assistido", "próximo episódio" e "Continuar assistindo" | `db` |
| `backup` | Login Google, exportar, enviar, baixar e mesclar o progresso | `db`, rede |
| `ui` | Telas: Início, Título, Painel de play, Configurações, Não identificados | API do preload |

Regra de isolamento: `parser`, `progress` (regras) e a mescla do `backup` são funções puras e não
importam nada do Electron. Isso permite testá-las isoladamente.

## 4. Identidade: episódio separado de arquivo

Princípio: o progresso pertence ao episódio, nunca ao arquivo nem ao HD.

- Cada item reproduzível (episódio ou filme) tem uma chave estável:
  - série identificada no TMDB: `tmdb:tv:<id>:S01E03`
  - filme identificado no TMDB: `tmdb:movie:<id>`
  - ainda sem TMDB: `local:<nome-normalizado>:S01E03` ou `local:<nome-normalizado>-<ano>`
  - quando um item `local:` for associado ao TMDB, a chave é migrada no banco e o progresso vai junto.
- Um item pode ter zero, um ou vários arquivos, em qualquer HD.
- Cada HD é identificado por um ID único gravado no arquivo `.brammp4.json` na raiz
  (`{ "id": "<uuid>", "label": "HD Séries", "createdAt": "..." }`). O app só varre discos com esse marcador.
- O caminho de cada arquivo é guardado relativo à raiz do HD; a letra da unidade nunca é persistida como identidade.

Consequências: trocar a letra da unidade, mover uma série entre HDs ou ter cópias nos dois HDs não afeta o progresso.

## 5. Modelo de dados (SQLite)

```
drives      (id TEXT PK, label, last_mount TEXT, last_seen_at)
titles      (id INTEGER PK, kind 'movie'|'series', tmdb_id, name, year, overview,
             poster_cache, backdrop_cache, matched_at)
items       (key TEXT PK, title_id FK, season, episode, name, overview, runtime_s)
files       (id INTEGER PK, item_key FK, drive_id FK, rel_path, size, mtime,
             duration_s, width, height, video_codec, probed_at, missing INTEGER)
tracks      (file_id FK, stream_index, type 'audio'|'sub', lang, title, codec,
             is_default, external_path)
progress    (item_key PK, position_s, duration_s, watched INTEGER, updated_at, device_id)
prefs       (title_id PK, audio_lang, sub_lang)   -- última escolha por série
unmatched   (file_id PK, reason)
settings    (key PK, value)
```

`progress.item_key` não tem chave estrangeira obrigatória para `items`: o progresso restaurado de um backup
pode chegar antes de o HD correspondente ser varrido.

## 6. Reconhecimento de arquivos (parser)

Padrões aceitos, em ordem de prioridade:

1. `S01E03`, `s1e3`, `S01E03E04` (episódio duplo vira dois itens apontando para o mesmo arquivo)
2. `1x03`
3. Estrutura de pastas `Série/Temporada 1/03 - Nome.mkv` ou `Season 01/...`
4. Filme: `Nome (2019)` ou `Nome.2019.1080p...`

Versão (para o seletor): resolução e codec tirados do ffprobe; o nome do arquivo só serve como dica.
Arquivo que não se encaixa em nenhum padrão vai para "Não identificados", onde o usuário associa manualmente uma vez.
Extensões consideradas: `.mkv .mp4 .avi .m4v .mov .wmv .ts .webm`. Legendas externas: `.srt .ass .ssa .vtt`
com o mesmo nome-base (ex.: `S01E03.pt-BR.srt`).

## 7. HDs: conectar e desconectar

- A cada 3 s o app confere as letras `A:` a `Z:` procurando `.brammp4.json`.
- HD conhecido conectado: atualiza `last_mount` e roda varredura incremental (ffprobe só em arquivos novos ou com tamanho/data alterados).
- HD novo: aparece em Configurações > HDs; o usuário dá um apelido e o app grava o marcador.
- HD desconectado: itens continuam no catálogo, com progresso, acinzentados com "conecte <apelido>".
- Mesmo item nos dois HDs: as duas cópias aparecem no seletor de versão. Padrão: maior resolução disponível.
- Arquivo que sumiu de um HD conectado: marcado `missing`; o item continua existindo enquanto houver progresso ou outra cópia.

## 8. Reprodução e progresso

Início:

```
mpv --input-ipc-server=\\.\pipe\brammp4-<aleatório> --fullscreen --force-window=yes
    --start=<posição> --aid=<n> --sid=<n|no> [--sub-file=<externa>]
    --config-dir=<app>/mpv-config   (uosc e opções do app, separados do mpv do usuário)
    "<caminho do arquivo>"
```

Durante a reprodução o app observa `time-pos`, `duration` e `pause` pelo IPC.

Quando salvar:

- a cada 5 s durante a reprodução;
- ao pausar;
- ao fechar o mpv (evento `end-file` ou saída do processo, usando a última posição conhecida);
- no evento `powerMonitor` `shutdown` do Electron, que força a gravação imediata.

Com o SQLite em modo WAL, uma gravação já confirmada sobrevive a um desligamento abrupto. Perda máxima: 5 s.

Regras:

- Assistido: posição maior ou igual a 90% da duração, ou faltando menos de 2 min. Marca `watched = 1`.
- Retomar: se a posição salva for menor que 30 s, começa do zero; senão, começa 5 s antes do ponto salvo.
- Próximo episódio: o menor `(temporada, episódio)` maior que o atual com arquivo disponível.
- "Continuar assistindo": um card por título, com o item atualizado mais recentemente. Se ele estiver assistido,
  o card mostra o próximo episódio; se não houver próximo, o título sai da fileira.
- Escolha de faixas: o padrão vem de `prefs` da série (último idioma de áudio e legenda escolhidos); se não houver,
  usa a faixa marcada como padrão no arquivo. Toda escolha nova é salva em `prefs`.
- Barra de progresso: `position_s / duration_s`, parte assistida colorida e restante em cinza;
  itens assistidos mostram a barra cheia e um selo "assistido".

## 9. Metadados (TMDB)

- Chave da API informada pelo usuário em Configurações e guardada com `safeStorage`.
- Ao encontrar um título novo com internet disponível: busca por nome (e ano, se houver), escolhe o primeiro resultado
  e permite corrigir manualmente na tela do título.
- Capas e fundos são baixados para a pasta de dados do app; o catálogo só lê do cache local.
- Sem internet: o título aparece com o nome do arquivo e uma capa gerada (frame do vídeo via ffmpeg ou placeholder);
  a busca é refeita na próxima vez que houver conexão.
- Atribuição: tela "Sobre" com o logo aprovado do TMDB (menor que o logo do app) e o aviso
  "Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB."

## 10. Backup no Google Drive

- Login: fluxo OAuth para app desktop com PKCE e redirecionamento loopback (`http://127.0.0.1:<porta aleatória>`).
  Escopos: `openid email https://www.googleapis.com/auth/drive.appdata`.
- O refresh token é guardado com `safeStorage` (criptografia do Windows atrelada ao usuário).
- Arquivo `progress.json` na `appDataFolder`:

```json
{
  "schema": 1,
  "exportedAt": "2026-10-14T12:00:00Z",
  "deviceId": "<uuid do notebook>",
  "progress": { "tmdb:tv:1399:S01E03": { "position": 1834, "duration": 3420, "watched": false, "updatedAt": "..." } },
  "prefs": { "tmdb:tv:1399": { "audio": "jpn", "sub": "por" } }
}
```

- Mescla: por chave, vence o `updatedAt` mais recente. A mesma regra serve depois para sincronizar vários aparelhos.
- Quando: baixar e mesclar ao abrir o app; enviar 30 s depois de terminar uma sessão de reprodução; botão "Fazer backup agora".
- Sem internet: marca "backup pendente" e tenta de novo quando a conexão voltar. Nunca bloqueia a reprodução.
- Base para o futuro: `deviceId` e `updatedAt` por registro permitem sincronização; perfis entram como o e-mail Google na chave do arquivo.

## 11. Telas

1. **Início:** "Continuar assistindo", "Séries", "Filmes", "Adicionados recentemente". Banner quando um HD está desconectado.
2. **Título:** fundo, sinopse, seletor de temporada, lista de episódios com `S01E03`, nome, duração e barra de progresso.
3. **Painel de play:** seletores de áudio, legenda (inclui "Desligada") e versão (só quando houver mais de uma);
   botões "Continuar de 30:34" e "Começar do início".
4. **Configurações:** HDs (apelido, status, revarrer), chave TMDB, conta Google e backup, caminho do mpv.
5. **Não identificados:** associar arquivo a título, temporada e episódio.

## 12. Tratamento de erros

| Situação | Comportamento |
|---|---|
| HD desconectado durante o vídeo | mpv encerra; o app grava a última posição e avisa "HD desconectado" |
| Arquivo não encontrado ao dar play | Revarre aquele HD; se continuar faltando, mostra outras versões ou o aviso |
| mpv ausente | Tela de configuração indicando o caminho ou a instalação |
| ffprobe falha num arquivo | Arquivo continua reproduzível; faixas aparecem como "desconhecidas" |
| TMDB fora do ar ou sem internet | Usa o cache; tenta de novo depois, sem mensagem bloqueante |
| Token Google expirado ou revogado | Banner "Reconectar conta Google"; o progresso local continua intacto |
| Banco corrompido | Na abertura: verificação de integridade; se falhar, oferece restaurar do backup do Drive |

## 13. Testes

- Unitários (Vitest), sem Electron: `parser` (tabela de nomes de arquivo reais), regras de `progress`,
  mescla do `backup`, cálculo de "próximo episódio".
- Integração: `db` com SQLite em arquivo temporário; `scanner` contra uma pasta de fixtures que simula dois HDs.
- `player`: teste com um mpv falso que fala o mesmo protocolo IPC, mais teste manual com o mpv real.
- Manual de ponta a ponta antes de cada marco: desconectar o HD durante o vídeo, fechar o app à força,
  trocar a letra da unidade.

## 14. Marcos

1. **M1, Catálogo local:** estrutura do projeto, `db`, `parser`, `drives`, `scanner`, telas Início e Título sem capas.
2. **M2, Reprodução e progresso:** `player` com mpv + uosc, painel de play, gravação de progresso e barras.
3. **M3, Metadados:** TMDB, cache de capas, tela Não identificados.
4. **M4, Backup:** login Google, exportação, mescla e restauração.
5. **M5, Acabamento:** instalador, ícone, atalhos de teclado, tela Sobre.

## 15. Pontos a confirmar antes ou durante a implementação

- Se o escopo `drive.appdata` é classificado pelo Google como sensível, e o efeito disso no aviso de "app não verificado"
  e na validade do refresh token enquanto o projeto do Google Cloud estiver em modo "Teste" (há relatos de expiração em 7 dias).
- Distribuição do mpv: baixar uma build portátil para `vendor/mpv` num script de setup, ou exigir instalação pelo usuário.
- Termos atuais da API do TMDB para uso pessoal não comercial.
