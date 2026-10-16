# Verificação manual do M2

Conferências que os testes automáticos não cobrem. Faça com o app instalado (ou em `npm run dev`), usando seus HDs. Cada passo diz o que precisa acontecer para passar.

## Reprodução e progresso

1. Abra um episódio nunca visto. Passa se o painel de play aparece com áudio, legenda, versão (quando houver mais de uma) e o botão "Assistir".
2. Clique em "Assistir", assista cerca de 1 minuto e feche o mpv com Q. Passa se, de volta ao app, o episódio mostra a barra de progresso parcial e a fileira "Continuar assistindo" do Início tem o card desse título.
3. Abra o mesmo episódio. Passa se o painel mostra "Continuar de mm:ss" e "Começar do início", e o mm:ss bate com o ponto em que você fechou (o vídeo começa até 5 s antes dele).
4. Em um episódio com ponto salvo, clique em "Começar do início". Passa se o vídeo começa em 0:00.
5. Assista um episódio até o fim (pode avançar até os últimos 20 s). Passa se o selo "Assistido" aparece e o card de "Continuar assistindo" passa a mostrar o próximo episódio.
6. Com um vídeo tocando, feche o app pela janela. Passa se no Gerenciador de Tarefas não sobra nenhum `mpv.exe` e, ao reabrir o app, o episódio mostra "Continuar de mm:ss" com o ponto em que você estava.
7. Com um vídeo tocando, encerre o app à força pelo Gerenciador de Tarefas. Limitação conhecida (sem job object do Windows): um `mpv.exe` pode continuar aberto; feche-o à mão. Passa se, ao reabrir o app, o ponto salvo tem no máximo uns 5 s de atraso.
8. Com um vídeo tocando, suspenda o notebook e retome. Passa se o ponto continua salvo (feche o mpv e confira o "Continuar de mm:ss").
9. Com um vídeo tocando no meio do episódio, desconecte o disco. Passa se aparece o aviso "O disco foi desconectado durante a reprodução. O último ponto gravado foi mantido.", o ponto fica salvo e o episódio NÃO aparece como "Assistido".
10. Troque a letra da unidade do disco (Gerenciamento de Disco), revarra se o app pedir e continue um episódio. Passa se o progresso e o "Continuar de mm:ss" sobreviveram à troca.

## Janela do mpv e uosc

11. Na janela real do mpv, confirme a barra de controle moderna do uosc. Passa se os menus de áudio e de legenda abrem pela barra.
12. Aperte F para entrar e sair da tela cheia. Passa se alterna nos dois sentidos (Esc também sai).
13. Olhe a barra do uosc. Passa se NÃO há botões de anterior, lista (playlist) nem próximo.
14. Abra o menu (botão de menu da barra ou clique direito). Passa se aparece o menu curto em português (Pausar ou retomar, Áudio, Legendas, Tela cheia, Avançar e voltar, Velocidade, Volume, Fechar o player) e NÃO há "Open file" nem "Delete file".
15. Arraste um arquivo de vídeo do Explorer para a janela do mpv. Passa se nada muda: o mesmo vídeo continua tocando.
16. Feche com Shift+Q, depois abra o mesmo episódio pelo botão do painel ("Continuar de mm:ss" ou "Assistir"). Passa se Shift+Q fechou como Q e o vídeo começa exatamente onde o painel diz (o mpv não criou ponto de retomada próprio).

## Arquivos reais

17. Reproduza um arquivo x265 real com áudio AC3 ou DTS de um dos seus discos. Passa se vídeo, áudio e legenda ficam sincronizados e sem engasgos.
18. Escolha no painel uma legenda externa com acento no nome. Passa se a legenda aparece no vídeo.
19. Troque áudio e legenda pelo menu do uosc, feche e abra o próximo episódio da mesma série. Passa se ele abre com os mesmos idiomas.

## Instância única

20. Com o app aberto, dê dois cliques no atalho de novo. Passa se nenhuma janela nova abre e a janela existente vem para a frente.
