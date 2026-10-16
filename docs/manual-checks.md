# Verificação manual do M2

Conferências que os testes automáticos não cobrem. Faça com o app instalado ou em `npm run dev`, usando seus HDs.

1. Abra um episódio e confirme que o painel de play aparece (áudio, legenda, versão e os botões de início).
2. Assista cerca de 1 minuto e feche o mpv com Q.
3. Confirme que a barra de progresso do episódio e a fileira "Continuar assistindo" foram atualizadas.
4. Abra o mesmo episódio de novo e confirme que o botão mostra "Continuar de mm:ss".
5. Com um vídeo tocando, feche o app. No Gerenciador de Tarefas, confirme que não sobrou nenhum `mpv.exe` e que o ponto foi salvo.
6. Com um vídeo tocando, desconecte o disco. O aviso deve aparecer e o ponto salvo deve ser mantido.
7. Na janela real do mpv, confirme que a interface do uosc aparece (barra de controle moderna, menus de áudio e legenda) e que a tela cheia funciona.
8. Reproduza um arquivo x265 real, com áudio AC3 ou DTS, de um dos seus discos.
9. Troque o áudio e a legenda no menu do uosc e confirme que o próximo episódio da mesma série abre com os mesmos idiomas.
10. Com o app aberto, dê dois cliques no atalho de novo: a segunda instância só deve colocar a janela existente em foco.
