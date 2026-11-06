# Lebes Automation

Uma ferramenta de automação e suporte de TI em formato Desktop, desenvolvida exclusivamente para a equipa de Service Desk do **Grupo Lebes**. O sistema atua como um hub central, convertendo tarefas complexas de infraestrutura Linux, acesso remoto e banco de dados Progress (ADMCOM) numa interface gráfica limpa, rápida e segura.

**Versão Atual:** 1.5.2

**Criado por:** Samuel Saraiva (Grupo Lebes 2026)

## Principais Funcionalidades

### 1. Monitoramento e Rede

* **Conexão de Filiais:** Validação de rede (Gateway e Servidor Central) e autenticação SSH automática (com fallback de credenciais legadas).

* **Scanner de Dispositivos:** Varredura rápida de IP/MAC Address e DHCP para mapear todo o parque da loja (PDVs, Caixas ADM, Pré-Vendas, Impressoras e Telefonia).

* **Diagnóstico ao Vivo:** Leitura em tempo real do uso de RAM, Disco, Hostname e última base de dados (SC_Libera) enviada pelo PDV/Servidor.

### 2. Manutenção de PDVs e Servidores

* **Acesso Rápido:** Integração nativa com ferramentas do Windows (PuTTY, MobaXterm, WinSCP e navegadores).

* **Auto-VNC (Robô de Login):** Sistema de injeção VBScript que aguarda a janela do UltraVNC abrir e digita as senhas automaticamente (ex: `k2p` ou `Lebes123`).

* **Segunda Via de NSU:** Extração inteligente de notas fiscais diretamente dos ficheiros `.zip` ou `.txt` (`/usr/p2k/bin/MFDE`) usando `awk`.

* **Sincronização e Reconfiguração:** Ajuste de hora forçado via `hwclock` e envio de scripts nativos para reinicialização e correção de portas seriais (`ttyS4`/`ttyS5`).

### 3. Gestão de Funcionários (Progress DB)

* **Integração ADMCOM:** Injeção remota de scripts `.p` (`mbpro`) no banco de dados da loja de forma silenciosa.

* **Consulta e Cadastro:** Verificação de senhas, status (Ativo/Inativo) e nível de acesso (`func.FunMec`).

* **Desligamentos em Lote:** Fila de processamento para inativar múltiplos utilizadores (`func.funsit = FALSE`) de uma só vez, prevenindo acessos indevidos.

### 4. Auto-Atualização em Rede

* O sistema verifica automaticamente um diretório SMB partilhado (`\\10.2.0.21\...`) à procura de um `version.json`. Caso encontre uma versão superior, aciona um script `.bat` local que substitui o executável antigo de forma transparente para o técnico.

## Tecnologias Utilizadas

A aplicação utiliza a arquitetura **Electron** (Híbrida):

* **Frontend (Interface UI):** HTML5, CSS3 (variáveis e grid/flexbox) e JavaScript puro (ES6). Interface desenhada para ser responsiva e com suporte a Tema Claro/Escuro.

* **Backend (Motor Node.js):**

  * `ipcMain` / `ipcRenderer`: Para comunicação segura entre a interface gráfica e o sistema operativo.

  * `ssh2`: Biblioteca para conexões seguras e execução de scripts Bash diretamente nas máquinas Linux da loja.

  * `child_process`: Para executar binários locais do Windows (PuTTY, UltraVNC, MobaXterm).

  * `fs` / `path`: Manipulação do ficheiro local e extração de logs.

## Requisitos do Sistema (Para Técnicos)

Para que todos os atalhos funcionem corretamente no computador do analista, os seguintes programas devem estar instalados nas pastas padrão do Windows (`C:\Program Files` ou `C:\Program Files (x86)`):

* **UltraVNC Viewer** (`vncviewer.exe`)

* **PuTTY** (`putty.exe` e `plink.exe`)

* **WinSCP** (`WinSCP.exe`)

* **MobaXterm** *(Opcional)* (`MobaXterm.exe`)

## Instruções de Compilação (Desenvolvimento)

1. Certifique-se que possui o **Node.js** (v16+) instalado.

2. Clone o repositório e instale as dependências:

   ```bash
   npm install
   ```

3. Para rodar em ambiente de testes:

   ```bash
   npm start
   ```

4. Para compilar o executável (Instalador):

   ```bash
   npm run dist
   ```

   *(O executável será gerado na pasta `/dist`)*.

## Segurança e Privacidade

Este software contém credenciais e rotas de IP específicas da infraestrutura do **Grupo Lebes**. O seu uso é estritamente interno e classificado. **Não partilhar o código-fonte em repositórios públicos (ex: GitHub público).**

*© 2026 Grupo Lebes - Departamento de TI / Service Desk*