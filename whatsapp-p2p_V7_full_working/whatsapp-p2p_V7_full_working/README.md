# 💬 WhatsApp P2P

Aplicação tipo/clone do WhatsApp 100% P2P (ponto a ponto) e em tempo real que recria todas as funcionalidade existentes na app Whatsapp mas **sem base de dados no servidor** e **sem serviços de autenticação externos**, ligação e comunicações extremamente rápidas.
Funcionalidades existentes: Mensagens de texto, mensagens de voz, ficheiros e chamadas de voz/vídeo, tudo ponto a ponto utilizando WebRTC.
Ideal para grupos de trabalho, estudo, culturais ou recreativos, empresas, etc que pretendam obter estas funcionalidade em ambiente independente, privado e seguro, exposto à Internet se necessário e extremamente leve a nível de recursos, onde o servidor (pc, pcb, ou smartphone) mal sente o peso do serviço, já que ele utiliza recursos mínimos para o funcionamento, sendo o maior peso processado pelo browser/navegador web dos clientes.

Tecnologias utilizadas
![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646cff?logo=vite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-3-38bdf8?logo=tailwindcss&logoColor=white)
![Node](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?logo=socket.io&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P-orange)

---

## ✨ Funcionalidades

- **Identidade sem contas nem passwords.** No primeiro uso, o browser gera um par de chaves ECDSA P-256. O **ID** (20 caracteres, 100 bits) é um hash da chave pública.
- **Texto em tempo real**, incluindo conversas de grupo (envio individual a cada membro).
- **Mensagens de voz** (gravar, enviar, reproduzir). Voz de contactos guardados é aceite automaticamente; a de desconhecidos pede confirmação.
- **Transferência de ficheiros** por WebRTC, em blocos de 16 KiB com controlo de fluxo. Todos os ficheiros pedem confirmação. No Chrome/Edge desktop são escritos diretamente em disco (qualquer tamanho); nos restantes browsers ficam em memória (limite de 300 MB).
- **Chamadas de voz e vídeo 1:1**, com mute, passagem de voz para vídeo, alta-voz, volume, tom e teste do toque nas Definições.
- **Entrega offline sem base de dados.** O remetente guarda o que ficou por entregar (outbox em IndexedDB) e reenvia quando o contacto fica online.
- **Localização**: atual, escolhida no mapa (OpenStreetMap) ou em tempo real (15 min, 1 h ou 8 h, só com a página aberta).
- **Gestão de contactos**: adicionar por ID, bloquear/desbloquear e apagar.
- **Conta por email (opcional).** Liga um email, recebe um código de 6 dígitos e define uma palavra-passe de recuperação. Perfil, contactos, bloqueados, definições e chave são cifrados no browser (PBKDF2 + AES-GCM) antes de serem guardados. O servidor nunca vê a palavra-passe. Noutro dispositivo basta **Entrar com email**.

## 🧠 Como funciona

```
 Browser A ──┐                                    ┌── Browser B
   IndexedDB │      server/ (Node + Socket.IO)    │ IndexedDB
   chave ECDSA│  • autentica (desafio/assinatura) │ chave ECDSA
             ├──►  • relé de texto e sinais WebRTC ◄──┤
             │      • presença (só em memória)    │
             └────────── WebRTC (DTLS) ───────────┘
                 voz · ficheiros · áudio/vídeo das chamadas
```

1. **Autenticação por desafio/assinatura.** Ao ligar, o servidor envia um desafio aleatório, o cliente assina-o com a chave privada e o servidor verifica a assinatura e deriva o ID. Ninguém pode usar o ID de outra pessoa sem a respetiva chave privada.
2. **Texto** passa pelo servidor, apenas em memória, nunca em disco.
3. **Voz, ficheiros e chamadas** vão por WebRTC, cifrados (DTLS/SRTP), sem passar pelo servidor.
4. **A única persistência no servidor** é opcional: as contas por email, que guardam uma cópia de segurança **já cifrada no cliente** (`server/data/accounts.json`).

## 🧰 Stack

| Camada | Tecnologias |
|---|---|
| Frontend | React 18, Vite 6, Tailwind CSS 3, react-icons |
| Tempo real | Socket.IO (polling com upgrade para WebSocket), WebRTC |
| Armazenamento local | IndexedDB |
| Criptografia | WebCrypto (ECDSA P-256, PBKDF2, AES-GCM) |
| Backend | Node.js (HTTP nativo + Socket.IO), Nodemailer (opcional) |
| Testes | `node:test`, Playwright (Chromium), fake-indexeddb, ESLint |

## 📁 Estrutura

```
├── server/          # Sinalização, autenticação e contas por email
├── src/
│   ├── components/  # Chat, Composer, CallOverlay, MapView, Definições…
│   ├── context/     # AppProvider (estado global)
│   ├── core/        # net, peers (WebRTC), identity, account, db
│   └── lib/         # crypto, recorder, geo, backup, ring, validação…
├── scripts/dev.mjs  # Arranque único: sinalização + Vite
├── test/            # Testes unitários, de ligação e e2e
└── public/          # Logótipos e fundos
```

## 🚀 Instalação e execução

**Requisitos:** Node.js 22 ou superior.

```bash
git clone https://github.com/<o-teu-utilizador>/<o-teu-repositorio>.git
cd <o-teu-repositorio>

npm install
npm run server:install
npm run dev:all
```

O `dev:all` inicia o servidor Node e só abre o Vite depois de `/api/health` responder. A app fica em **http://localhost:5173**.

### Testar entre dispositivos (ngrok)

Microfone, câmara e WebCrypto exigem HTTPS (exceto em `localhost`). Num segundo terminal:

```bash
ngrok http 5173
```

1. Todos abrem **o mesmo URL HTTPS** do ngrok.
2. Cada pessoa cria a sua identidade num browser ou perfil diferente.
3. Adicionem os IDs uns dos outros como contactos.

> ⚠️ **Não definas `VITE_SOCKET_URL=http://localhost:5000` para acesso remoto.** No telemóvel, `localhost` seria o próprio telemóvel. Deixa a variável por definir: a sinalização usa a origem da página.
>
> **Obrigatório com ngrok:** adiciona o domínio que o ngrok te atribuir ao `.env` (ou `.env.local`), sem `https://`, e reinicia: `TUNNEL_HOSTS=o-teu-host.ngrok-free.app`. Sem isto, o Vite devolve 403 a pedidos vindos do túnel.

### Diagnóstico de ligação

Abre `https://O-TEU-HOST/api/health`. O esperado é JSON com `ok: true` e `service: "whatsapp-p2p-signaling"`. HTML ou erro indicam túnel na porta errada ou sinalização parada.

> Não limpes os dados do site para resolver problemas de ligação: perdes a identidade, os contactos e o histórico.

## ⚙️ Configuração

Copia `.env.example` para `.env` (ou `.env.local`) e ajusta o que precisares.

| Variável | Função |
|---|---|
| `PORT` | Porta da sinalização (omissão: 5000) |
| `SIGNALING_URL` | Servidor de sinalização externo (o `dev:all` não cria outro) |
| `TUNNEL_HOSTS` | Hosts de túnel autorizados, separados por vírgula |
| `VITE_SOCKET_URL` | Só se a sinalização estiver noutro domínio |
| `ALLOWED_ORIGINS` | Origens CORS quando a app é servida de outro domínio |
| `STUN_URLS` | Servidores STUN (omissão: Google) |
| `TURN_URLS`, `TURN_SECRET`, `TURN_TTL` | TURN com credenciais temporárias (coturn `use-auth-secret`) |
| `ICE_SERVERS` | JSON completo de ICE servers |
| `TLS_KEY`, `TLS_CERT` | HTTPS direto no servidor |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Envio do código por email (Gmail) |
| `ACCOUNTS_FILE` | Ficheiro das contas (omissão: `server/data/accounts.json`) |

### Conta por email com Gmail (opcional)

1. Ativa a verificação em 2 passos na conta Google.
2. Cria uma **palavra-passe de aplicação**.
3. Define `GMAIL_USER` e `GMAIL_APP_PASSWORD` em `.env.local`.
4. Executa `npm run server:install` (instala o nodemailer).

Sem isto, o código de 6 dígitos aparece no terminal do servidor, o que é útil para testes.

## 🏭 Produção

```bash
npm run build
TLS_KEY=key.pem TLS_CERT=cert.pem PORT=443 node server/index.js
```

O servidor serve `dist/` e a sinalização, com cabeçalhos de segurança e CSP. Em alternativa, coloca um proxy TLS à frente.

**Instala um servidor TURN (coturn).** Sem ele, chamadas e transferências falham em redes com NAT restritivo.

## 🧪 Testes

```bash
npm run lint
npm test                 # compila e executa os testes unitários e de ligação
npx playwright install chromium   # apenas uma vez
npm run test:e2e         # dois utilizadores em Chromium (Hub simulado)
npm run test:signaling   # Chromium + Socket.IO reais, fallback por polling, reinício do servidor
```

O e2e cobre: login por assinatura, contactos e presença, texto, outbox offline, voz, ficheiros nos dois sentidos (verificação SHA-256), escrita em disco, recusa de ficheiros e chamadas voz→vídeo com mute, recusa e repetição.

**Não testado:** túnel ngrok real, redes externas, TURN real, dispositivos físicos e outros navegadores.

## 🔒 Segurança e privacidade

- Chaves privadas nunca saem do browser, exceto cifradas na cópia de segurança da conta.
- O servidor não guarda mensagens, contactos nem ficheiros.
- Cabeçalhos `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` e CSP restrita.
- Limite de tentativas e de pedidos nos códigos por email.

Este projeto **não foi sujeito a uma auditoria de segurança completa**. Não o uses para comunicações críticas sem revisão independente.

## ⚠️ Limitações conhecidas

- A identidade vive no browser: limpar os dados do site perde-a (a menos que exista conta por email).
- Chamadas e ficheiros são apenas 1:1.
- Ficheiros guardados para envio posterior estão limitados a 50 MB; acima disso só se enviam com o contacto online.
- A entrega offline exige que remetente e destinatário estejam online *em algum momento*, e que o remetente não limpe os dados do browser até lá.
- Não há verificação do ID por QR/código. Confirma o ID por outro canal.
- Localização em tempo real só funciona com a página aberta.

## 🤝 Contribuir

Issues e pull requests são bem-vindos. Antes de submeter, corre `npm run lint` e `npm test`.

## 📄 Licença

Define aqui a licença do projeto (por exemplo, MIT) e adiciona um ficheiro `LICENSE`.
