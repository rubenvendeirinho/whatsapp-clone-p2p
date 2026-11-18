# WhatsApp P2P

Chat em tempo real **sem base de dados no servidor** e **sem serviços de autenticação externos**:
mensagens de texto, **mensagens de voz**, **ficheiros**, **chamadas de voz e vídeo**, tudo ponto a ponto (WebRTC) quando possível.

## Como funciona

```
 Browser A ──┐                                   ┌── Browser B
   IndexedDB │      server/ (Node + socket.io)   │ IndexedDB
   chave ECDSA│  • autentica (desafio/assinatura)│ chave ECDSA
             ├──►  • relé de texto e sinais WebRTC ◄──┤
             │      • presença        (só memória)│
             └────────── WebRTC (DTLS) ───────────┘
                 voz · ficheiros · áudio/vídeo das chamadas
```

* **Identidade local.** No primeiro uso o browser gera um par ECDSA P‑256 (chave privada guardada em IndexedDB; só é exportada, cifrada, para a cópia de segurança da conta).
  O **ID** (20 caracteres, 100 bits) é um hash da chave pública. Ao ligar, o servidor envia um desafio aleatório e o cliente
  assina-o; o servidor verifica a assinatura e deriva o ID. Ninguém consegue usar o ID de outro sem a sua chave privada,
  não há passwords nem contas, e o servidor não guarda nada.
* **Texto** passa pelo servidor (em memória, nunca em disco). **Voz, ficheiros e chamadas** vão por WebRTC, cifrados (DTLS/SRTP), sem passar pelo servidor.
* **Entrega offline sem base de dados:** o remetente guarda o que ficou por entregar (outbox em IndexedDB) e reenvia assim que o
  contacto fica online. Ambos têm de estar online *em algum momento*, e o remetente não pode limpar os dados do browser até lá.
* Voz de **contactos guardados** é aceite automaticamente; voz de desconhecidos e **todos os ficheiros** pedem confirmação.
  Os ficheiros são transferidos em blocos de 16 KiB com controlo de fluxo; com Chrome/Edge desktop são escritos diretamente em disco (qualquer tamanho),
  nos restantes browsers ficam em memória (limite de 300 MB).

## Executar

Ambiente verificado: Node.js 22.23.4. Na raiz do projeto:

```bash
npm install
npm run server:install
npm run dev:all
```

O comando inicia o servidor Node e só abre o Vite depois de verificar `/api/health`.
O arranque usa Node diretamente, sem `npx`/shell, incluindo no Windows. A porta do
Vite é fixa: **5173**. Se estiver ocupada, pare a instância anterior em vez de deixar
o túnel ligado à aplicação errada. `PORT` altera a porta interna da sinalização e é
respeitada pelo proxy; o Vite continua em 5173.

Noutro terminal, para testar entre dispositivos:

```bash
ngrok http 5173
```

Todos os utilizadores devem abrir **o mesmo URL HTTPS do ngrok**, criar as suas
próprias identidades em navegadores/perfis diferentes e adicionar os IDs uns dos
outros como contactos. O microfone, a câmara e WebCrypto requerem HTTPS, exceto em
localhost. Não exponha a porta 5000 separadamente: `/socket.io` passa pela mesma
origem da aplicação. Se o ngrok apresentar uma página de aviso, confirme-a antes
de usar a aplicação.

**Não configure `VITE_SOCKET_URL=http://localhost:5000` para acesso remoto.** Remova
essa variável de `.env`, `.env.local` ou do ambiente e reinicie/recompile: num
telemóvel, `localhost` aponta para o próprio telemóvel. A omissão é a mesma origem.
Por segurança, o Vite só aceita pedidos de hosts autorizados. Ao usar o ngrok, adicione o
seu domínio ao `.env` (ou `.env.local`), sem `https://`, e reinicie:
`TUNNEL_HOSTS=o-seu-host.ngrok-free.app` (vários hosts separados por vírgula).

### Diagnóstico de ligação

Abra `https://SEU-HOST/api/health` no mesmo URL público. O resultado esperado é JSON
com `ok: true` e `service: "whatsapp-p2p-signaling"`. HTML ou erro indicam um túnel
na porta errada, um proxy antigo ou sinalização parada. A interface agora mostra
diagnósticos de transporte/autenticação e um botão para tentar novamente.
O chat aceita HTTP polling e faz upgrade para WebSocket quando disponível.

É possível usar `npm run server` e `npm run dev` separadamente. Para preview,
execute `npm run build`, mantenha `npm run server` ativo e use `npm run preview`;
o túnel deve então apontar para **4173**. O preview também inclui o proxy.

Não limpe os dados do site para tentar resolver a ligação: perderia a identidade
local, os contactos e o histórico. A origem (domínio) determina os dados guardados.

### Produção

```bash
npm run build
TLS_KEY=key.pem TLS_CERT=cert.pem PORT=443 node server/index.js   # serve dist/ + sinalização, com CSP
```

| Variável (servidor) | Função |
|---|---|
| `PORT` | porta (omissão 5000) |
| `TLS_KEY`, `TLS_CERT` | ativa HTTPS direto (ou ponha um proxy TLS à frente) |
| `ALLOWED_ORIGINS` | origens CORS quando a app é servida de outro domínio |
| `STUN_URLS` | STUN (omissão: Google) |
| `TURN_URLS`, `TURN_SECRET`, `TURN_TTL` | TURN com credenciais temporárias (coturn `use-auth-secret`) |
| `ICE_SERVERS` | JSON completo, se preferir |

**Instale um TURN (coturn)** para produção: sem ele, chamadas e transferências falham em redes com NAT restritivo.
No cliente, `VITE_SOCKET_URL` só é necessário se o servidor estiver noutro domínio (ver `.env.example`).

## Testes

```bash
npm run lint
npm test          # compila e executa 20 testes, incluindo subtestes de ligação real
npx playwright install chromium  # uma vez; em Linux pode ser necessário install --with-deps chromium
npm run test:e2e  # 19 verificações com dois utilizadores em Chromium (Hub simulado)
npm run test:signaling # Chromium + Socket.IO reais; proxy sem WebSocket e reinício do servidor
npm run build
npm audit
npm --prefix server audit
```

O e2e cobre: login por assinatura, contactos/presença, texto, outbox offline, voz (gravar → enviar → reproduzir),
ficheiros nos dois sentidos em simultâneo (SHA‑256), escrita em disco, recusa, chamadas voz→vídeo, mute, recusar e repetir chamada.

O teste `test:e2e` usa WebRTC real e sinalização simulada pelo Hub; microfone/câmara
e escrita direta em disco são simulados. O teste `test:signaling` usa a aplicação
React e o servidor Socket.IO reais com dois contextos Chromium: autenticação,
presença, mensagens nos dois sentidos e reconexão após reiniciar o servidor.
Um proxy local simula o Host do ngrok e bloqueia os upgrades WebSocket para testar
o fallback por polling. A suíte `npm test` também cobre dev, preview, health e
recuperação da ligação. O túnel ngrok real do utilizador, redes externas, TURN
real, dispositivos físicos e outros navegadores não foram testados nesta revisão.

## Revisão V5: ligação ao servidor

* HTTP polling com upgrade para WebSocket habilitado no cliente e no servidor.
* Proxy de sinalização tanto no desenvolvimento como no preview.
* Porta interna configurável e porta pública fixa; arranque verificado por health,
  sem shell/npx e sem continuar silenciosamente quando a sinalização falha.
* Removido o logger que ocultava todos os erros WebSocket após a primeira falha.
* Diagnóstico visível, timeout de autenticação, botão de reconexão e recuperação
  após uma desconexão forçada pelo servidor.
* Hosts de desenvolvimento restritos ao domínio indicado e a `TUNNEL_HOSTS`;
  não é necessário permitir globalmente todos os túneis públicos.

## Correções anteriores (V2)

* Servidor resistente a caminhos HTTP malformados, bytes nulos e travessia para diretórios com prefixo semelhante.
* Argumentos de confirmação Socket.IO inválidos deixam de provocar exceções no servidor.
* Validação de mensagens e ofertas P2P reforçada: IDs vazios, datas não finitas e tamanhos fracionários são rejeitados.
* Mensagens JSON nulas ou inválidas no DataChannel são ignoradas; falhas ao finalizar gravações em disco são reportadas e finais duplicados são ignorados.
* Escritas em IndexedDB só são confirmadas após o commit da transação, incluindo tratamento de abortos posteriores ao sucesso do pedido.
* Limpeza de presença e ofertas pendentes ao perder a ligação ao servidor.
* Compositor isolado por conversa, com proteção contra gravações concorrentes, limpeza de pedidos de microfone concluídos após sair e tratamento de erros de envio.
* Corrigidos os cinco erros iniciais de ESLint. Dependências atualizadas, incluindo Vite 6.4.6; Playwright, esbuild e fake-indexeddb declarados para os testes.
* Verificação final: 13 testes aprovados, 19 verificações no Chromium aprovadas, compilação e ESLint sem erros; ambas as auditorias npm sem vulnerabilidades reportadas no momento da revisão.

Esta revisão não constitui uma auditoria de segurança completa nem garante ausência de vulnerabilidades.

## Limitações conhecidas

* A identidade vive neste browser: limpar os dados do site perde-a (não há recuperação, por desenho).
* Chamadas e ficheiros são 1:1 (texto e voz suportam grupos, com envio individual a cada membro).
* O tamanho de ficheiros guardados para envio posterior é limitado a 50 MB; acima disso só se enviam com o contacto online.
* Não há bloqueio de contactos nem verificação do ID por QR/código; confirme o ID por outro canal.


## V7 full — novidades

**Conta por email (opcional).** Em *Definições → Conta* liga um email, recebe um código de 6 dígitos e escolhe uma palavra-passe de
recuperação. Perfil, contactos, bloqueados, definições e a chave são cifrados no browser (PBKDF2 + AES-GCM) e guardados em
`server/data/accounts.json`; o servidor nunca vê a palavra-passe. Noutro dispositivo use **Entrar com email**. Conversas e ficheiros
ficam só nos dispositivos. Para Gmail: verificação em 2 passos + palavra-passe de aplicação, `GMAIL_USER` e `GMAIL_APP_PASSWORD` em
`.env.local`, e `npm run server:install` (nodemailer). Sem isso o código aparece no terminal do servidor.

**Contactos.** Menu ⋮: bloquear/desbloquear e apagar contacto. **Chamadas.** Volume, tom e teste do toque em Definições; botão Alta-voz
na chamada (em telemóveis a saída é decidida pelo sistema). **Localização.** Botão 📍: atual, escolher no mapa (OpenStreetMap) e em tempo
real (15 min, 1 h, 8 h; só com a página aberta). Requer HTTPS (ngrok) ou localhost.
