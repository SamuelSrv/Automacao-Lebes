// =========================================================
// MONITOR — conexão com a filial, filiais recentes, servidor e acesso rápido
// =========================================================

// ---------- filiais recentes ----------
const CHAVE_FILIAIS_RECENTES = 'lebesFiliaisRecentes';

function obterFiliaisRecentes() {
    try { return JSON.parse(localStorage.getItem(CHAVE_FILIAIS_RECENTES)) || []; } catch (e) { return []; }
}

function registrarFilialRecente(filial) {
    let lista = obterFiliaisRecentes().filter(f => f !== filial);
    lista.unshift(filial);
    try { localStorage.setItem(CHAVE_FILIAIS_RECENTES, JSON.stringify(lista.slice(0, 6))); } catch (e) { }
    renderizarFiliaisRecentes();
}

function limparFiliaisRecentes() {
    try { localStorage.removeItem(CHAVE_FILIAIS_RECENTES); } catch (e) { }
    renderizarFiliaisRecentes();
}

function renderizarFiliaisRecentes() {
    const box = $('filiaisRecentes');
    box.textContent = '';
    const lista = obterFiliaisRecentes();
    if (lista.length === 0) return;

    const rotulo = document.createElement('span');
    rotulo.className = 'recents-label';
    rotulo.textContent = 'Recentes:';
    box.appendChild(rotulo);

    lista.forEach(f => {
        const chip = criarBotao({ texto: f, classe: 'chip', titulo: `Conectar na filial ${f}` });
        chip.dataset.filial = f;
        box.appendChild(chip);
    });
    box.appendChild(criarBotao({ texto: 'limpar', classe: 'chip chip-clear', titulo: 'Limpar filiais recentes', onClick: limparFiliaisRecentes }));
}

// ---------- estado visual da conexão ----------
const NIVEL_CLASSE = { ok: 'is-ok', warn: 'is-warn', bad: 'is-bad' };

function definirEstadoGeral(texto, nivel = '') {
    const el = $('valStatusGeral');
    el.textContent = texto;
    el.classList.remove('is-ok', 'is-warn', 'is-bad');
    if (NIVEL_CLASSE[nivel]) el.classList.add(NIVEL_CLASSE[nivel]);
}

function definirIpComStatus(id, ip, online) {
    $(id).innerHTML = `${escaparHtml(ip)} ${statusDot(online ? 'ok' : 'bad')}`;
}

function exigirFilial() {
    if (!estado.ipServidorBase || !estado.redeBase) { showToast('Conecte em uma filial primeiro.', 'error'); return false; }
    return true;
}

function setStatusOffline(motivo = 'Offline') {
    fecharModais();
    showToast(`Falha: ${motivo}`, 'error');
    $('valNomeFilial').textContent = 'Indisponível';
    $('valServidor').innerHTML = `--- ${statusDot('bad')}`;
    $('valInternet').innerHTML = `--- ${statusDot('bad')}`;
    definirEstadoGeral(motivo, 'bad');
    $('painelFerramentas').classList.remove('active');
    limparPdvs();
    limparTelefonia();
}

// ---------- conectar ----------
async function conectarFilial() {
    const filial = $('inputFilial').value.trim();
    if (!filial) { showToast('Informe o número da filial.', 'error'); return; }
    if (!/^\d+$/.test(filial)) { showToast('A filial deve conter apenas números.', 'error'); return; }

    estado.filialAtual = filial;
    estado.ipServidorBase = '';
    estado.redeBase = '';

    mostrarLoading('Consultando filial...');
    $('painelFerramentas').classList.remove('active');
    limparPdvs();
    limparTelefonia();

    const resDns = await window.sistema.rodarComando(`nslookup filial${filial}${DOMINIO}`);
    const saidaDns = (resDns.resultado || '').toLowerCase();

    if (saidaDns.includes("can't find") || saidaDns.includes('não é possível') || saidaDns.includes('nxdomain')) {
        return setStatusOffline('Filial não encontrada (DNS)');
    }

    const match = (resDns.resultado || '').match(IP_REGEX);
    if (!match || match.length === 0) return setStatusOffline('Erro de resolução');

    const ipServidor = match[match.length - 1];
    if (ipServidor === '8.8.8.8' || ipServidor.startsWith('127.')) return setStatusOffline('Sem VPN / interceptado');

    estado.ipServidorBase = ipServidor;
    estado.redeBase = ipServidor.substring(0, ipServidor.lastIndexOf('.'));
    const ipInternet = estado.redeBase + '.1';

    const srvRes = await window.sistema.rodarComando(`ping -n 1 -w 1000 ${ipServidor}`);
    const intRes = await window.sistema.rodarComando(`ping -n 1 -w 1000 ${ipInternet}`);
    const srvOnline = srvRes.resultado.toUpperCase().includes('TTL=');
    const intOnline = intRes.resultado.toUpperCase().includes('TTL=');

    $('valNomeFilial').textContent = `Filial ${filial}`;
    definirIpComStatus('valServidor', ipServidor, srvOnline);
    definirIpComStatus('valInternet', ipInternet, intOnline);

    if (!srvOnline) {
        definirEstadoGeral('Servidor offline', 'bad');
        showToast('Ferramentas bloqueadas: o servidor não respondeu.', 'error');
        fecharModais();
        return;
    }

    mostrarLoading('Autenticando no servidor...');
    const auth = await window.sistema.autenticarServidor(ipServidor);

    if (auth.sucesso) {
        if (intOnline) definirEstadoGeral('Operacional', 'ok');
        else definirEstadoGeral('Gateway inativo', 'warn');
        $('painelFerramentas').classList.add('active');
        showToast('Conectado e autenticado.');
        registrarFilialRecente(filial);
        fecharModais();
        atualizarPdvs().then(atualizarTelefonia);   // procura PDVs e telefonia sem travar a tela
        return;
    }

    setStatusOffline('Falha de senha (SSH)');
    showToast('Nenhuma senha padrão funcionou neste servidor.', 'error');
    fecharModais();
}

// ---------- ações no servidor ----------
// Executa um script no servidor mostrando o andamento no console. Retorna true se deu certo.
async function executarServidor(comando, titulo, msgSucesso, rotuloComando = 'Comando') {
    if (!exigirFilial()) return false;

    abrirConsole();
    logExecucao(titulo, comando, rotuloComando);
    mostrarLoading(titulo);

    let ok = false;
    try {
        const res = await window.sistema.rodarSSH({ host: estado.ipServidorBase, script: comando, tipo: 'servidor' });
        fecharModais();
        if (res.sucesso) {
            ok = true;
            showToast(msgSucesso);
            logSucesso('Processo finalizado no Linux. Retorno:', res.resultado);
        } else {
            showToast(`Erro: ${res.erro || 'falha na execução'}`, 'error');
            logErro('Falha na execução do servidor:', res.erro);
        }
    } catch (e) {
        fecharModais();
        showToast('Erro de comunicação com o servidor.', 'error');
    } finally {
        abrirConsole();
    }
    return ok;
}

async function reiniciarAgente() {
    if (!exigirFilial()) return;
    const sim = await confirmarAcao({
        titulo: 'Reiniciar o agente Resolve?',
        mensagem: `Filial ${estado.filialAtual}: o agente será encerrado e iniciado de novo.`,
        confirmar: 'Reiniciar agente'
    });
    if (!sim) return;

    const comando = `pkill -9 -f "[a]gente.php" || true ; pkill -9 -f "[a]gente.sh" || true ; sleep 1 ; cd /usr/admcom/agente ; chmod -R 755 . ; nohup sh -c 'echo "" | ./start-ag"e"nte.sh' > /dev/null 2>&1 & sleep 2 ; echo "\\n--- PROCESSOS ATIVOS NA MEMORIA ---" ; ps aux | grep "[a]gente" | grep -v grep`.replace(/\n/g, '');
    executarServidor(comando, 'Reiniciando agente...', 'Agente reiniciado. Veja o resultado no console.');
}

async function reiniciarBasesPV() {
    if (!exigirFilial()) return;
    const sim = await confirmarAcao({
        titulo: 'Reiniciar as bases da pré-venda?',
        mensagem: `Filial ${estado.filialAtual}: as bases serão desativadas, os arquivos de lock removidos e as bases ativadas de novo. As pré-vendas ficam indisponíveis por alguns instantes.`,
        confirmar: 'Reiniciar bases'
    });
    if (!sim) return;

    const comando = `cd /usr/admcom/bases ; ./desativa ; rm -f *.lk ; nohup ./ativa > /dev/null 2>&1 & sleep 2 ; echo "\\n--- ATIVACAO ENVIADA PARA O BACKGROUND ---"`.replace(/\n/g, '');
    executarServidor(comando, 'Reiniciando bases...', 'Bases da pré-venda reiniciadas. Veja o resultado no console.');
}

async function reiniciarServicosVenda() {
    if (!exigirFilial()) return;
    const sim = await confirmarAcao({
        titulo: 'Reiniciar os serviços de venda?',
        mensagem: `Filial ${estado.filialAtual}: os serviços p2k-sp e vsftpd serão reiniciados. Os PDVs podem ficar sem comunicação por alguns instantes.`,
        confirmar: 'Reiniciar serviços'
    });
    if (!sim) return;

    const comando = 'service p2k-sp stop ; sleep 2 ; service p2k-sp start ; service vsftpd start';
    const ok = await executarServidor(comando, 'Reiniciando serviços de venda...', 'Serviços reiniciados com sucesso.', 'Comandos');
    if (!ok) return;

    mostrarLoading('Buscando PDVs online para teste...');
    try {
        const ips = await escanearPdvsOnline();
        fecharModais();
        estado.pdvsOnline = ips;
        renderizarPdvs();

        if (ips.length > 0) abrirModalTestePDV(ips);
        else showToast('Os serviços reiniciaram, mas nenhum PDV respondeu no momento.', 'warning');
    } catch (e) {
        fecharModais();
        showToast('Os serviços reiniciaram, mas não foi possível procurar os PDVs.', 'warning');
    }
}

// ---------- terminais do servidor ----------
function abrirPuttyServidor() { if (exigirFilial()) window.sistema.abrirFerramenta({ ferramenta: 'putty', ip: estado.ipServidorBase, tipo: 'servidor' }); }
function abrirMobaServidor() { if (exigirFilial()) window.sistema.abrirFerramenta({ ferramenta: 'mobaxterm', ip: estado.ipServidorBase, tipo: 'servidor' }); }
function abrirWinSCPServidor() { if (exigirFilial()) window.sistema.abrirFerramenta({ ferramenta: 'winscp', ip: estado.ipServidorBase, tipo: 'servidor' }); }

// ---------- acesso rápido (Pré-venda / Retaguarda) ----------
let acessoRapidoUser = '';
let acessoRapidoPass = '';
let acessoRapidoIpsPdv = [];

async function abrirAcessoRapido(usuario, senha) {
    if (!exigirFilial()) return;

    acessoRapidoUser = usuario;
    acessoRapidoPass = senha;
    mostrarLoading('Buscando locais disponíveis...');

    try {
        const ips = await escanearPdvsOnline();
        fecharModais();
        abrirModalSeletorAcesso(ips, usuario);
    } catch (e) {
        fecharModais();
        showToast('Erro ao buscar dispositivos.', 'error');
    }
}

function abrirModalSeletorAcesso(pdvsOnline, usuario) {
    acessoRapidoIpsPdv = pdvsOnline.slice();
    const container = $('listaSeletorAcesso');
    container.textContent = '';
    $('tituloSeletorAcesso').textContent = `Acesso: ${usuario === 'pv' ? 'Pré-venda' : 'Retaguarda'}`;

    const criar = (texto, ip, classe) => criarBotao({
        texto, classe: `btn btn-block ${classe}`,
        icon: classe.includes('primary') ? 'server' : 'monitor',
        onClick: () => { fecharModais(); executarAcessoRapido(ip); }
    });

    container.appendChild(criar(`Servidor central (${estado.ipServidorBase})`, estado.ipServidorBase, 'btn-primary'));

    if (pdvsOnline.length > 0) {
        const titulo = document.createElement('div');
        titulo.className = 'group-title';
        titulo.textContent = 'Caixas e PDVs online';
        container.appendChild(titulo);
        pdvsOnline.forEach(ip => container.appendChild(criar(`PDV ${numeroDoPdv(ip)} (${ip})`, ip, '')));
    }
    abrirModal('modalSeletorAcesso');
}

function executarAcessoRapido(ipDestino) {
    // Opções > Caixas PDV ativado: nos PDVs a senha k2p é completada sozinha
    const ehPdv = acessoRapidoIpsPdv.includes(ipDestino);
    const senhaFinal = (ehPdv && configSistema.vncAutoPdv) ? 'k2p' : acessoRapidoPass;
    window.sistema.abrirFerramenta({ ferramenta: 'putty', ip: ipDestino, tipo: 'custom', usuario: acessoRapidoUser, senhaCustom: senhaFinal });
    showToast(`Abrindo sessão como ${acessoRapidoUser} em ${ipDestino}...`);
}

function iniciarMonitor() {
    renderizarFiliaisRecentes();
    $('filiaisRecentes').addEventListener('click', e => {
        const chip = e.target.closest('[data-filial]');
        if (!chip) return;
        $('inputFilial').value = chip.dataset.filial;
        conectarFilial();
    });
}
