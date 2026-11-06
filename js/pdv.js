// =========================================================
// PDV — quadro de PDVs online, ações por PDV, hora e segunda via (NSU)
// =========================================================

// ---------- descoberta ----------
// Pergunta ao servidor quais PDVs (faixa .130 a .139) respondem a ping.
async function escanearPdvsOnline() {
    const script = `
        F=/tmp/scan_pdvs_$$.txt
        > $F
        for i in $(seq 130 139); do
            ( ping -c 1 -W 1 ${estado.redeBase}.$i >/dev/null 2>&1 && echo "${estado.redeBase}.$i" >> $F ) &
        done
        wait
        cat $F
        rm -f $F
    `;
    const res = await window.sistema.rodarSSH({ host: estado.ipServidorBase, script, tipo: 'servidor' });
    if (!res.sucesso) throw new Error(res.erro || 'Falha ao procurar PDVs');

    // só aceita linhas que sejam IPs (sem PDV online o servidor responde "Comando executado.")
    const ips = (res.resultado || '').split('\n').map(l => l.trim()).filter(l => /^\d{1,3}(\.\d{1,3}){3}$/.test(l));
    return ordenarPorIp(ips);
}

// ---------- quadro ----------
let _buscaPdvId = 0;

function limparPdvs() {
    _buscaPdvId++;
    estado.pdvsOnline = [];
    renderizarPdvs();
}

function mensagemPdvs(texto) {
    const el = $('pdvVazio');
    el.textContent = texto;
    el.classList.toggle('hidden', !texto);
}

function renderizarPdvs() {
    const board = $('pdvBoard');
    board.textContent = '';
    const ips = estado.pdvsOnline;
    $('pdvContagem').textContent = ips.length;

    if (ips.length === 0) { mensagemPdvs(estado.redeBase ? 'Nenhum PDV respondeu (faixa 30 a 39).' : ''); return; }
    mensagemPdvs('');

    ips.forEach(ip => {
        const num = numeroDoPdv(ip);
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'pdv-tile';
        tile.dataset.ip = ip;
        tile.title = `Abrir ações do PDV ${num}`;
        tile.innerHTML =
            `<span class="pdv-num">${num}</span>` +
            `<span class="pdv-info"><span class="pdv-name">PDV ${num}</span><span class="pdv-ip">${escaparHtml(ip)}</span></span>` +
            statusDot('ok');
        board.appendChild(tile);
    });
}

async function atualizarPdvs() {
    if (!estado.redeBase) return;
    const busca = ++_buscaPdvId;
    const btn = $('btnAtualizarPdvs');
    btn.disabled = true;

    estado.pdvsOnline = [];
    $('pdvBoard').textContent = '';
    $('pdvContagem').textContent = '0';
    mensagemPdvs('Procurando PDVs...');

    try {
        const ips = await escanearPdvsOnline();
        if (busca !== _buscaPdvId) return;       // o usuário trocou de filial no meio da busca
        estado.pdvsOnline = ips;
    } catch (e) {
        if (busca !== _buscaPdvId) return;
        showToast('Não foi possível procurar os PDVs.', 'error');
    } finally {
        if (busca === _buscaPdvId) btn.disabled = false;
    }
    if (busca === _buscaPdvId) renderizarPdvs();
}

function abrirPdv(ip) {
    const num = numeroDoPdv(ip);
    estado.pdvSelecionado = { ip, num };
    $('pdvAcoesTitulo').textContent = `PDV ${num}`;
    $('pdvAcoesIp').textContent = ip;
    abrirModal('modalPdvAcoes');
}

// PDV fora da faixa 30-39 ou que não apareceu no scan
function abrirPdvManual() {
    if (!exigirFilial()) return;
    const campo = $('inputPdvManual');
    const ip = ipDoPdv(campo.value);
    if (!ip) { showToast('Informe o número do PDV (de 1 a 99).', 'warning'); campo.focus(); return; }
    campo.value = '';
    abrirPdv(ip);
}

// ---------- ações ----------
async function executarAcaoPdv(acao, ip, num) {
    fecharModais();
    if (acao === 'nsu') return abrirModalNSU(num);
    if (acao === 'reconfig') return reconfigurarPdv(ip);
    if (acao === 'hora') return prepararModalHora(ip);
    return abrirFerramentaPdv(acao, ip);
}

async function abrirFerramentaPdv(acao, ip) {
    mostrarLoading('Autenticando...');
    const ferramenta = acao === 'log' ? 'log-pdv' : acao;
    const res = await window.sistema.abrirFerramenta({
        ferramenta, ip, tipo: 'pdv',
        autoVnc: acao === 'vnc' && configSistema.vncAutoPdv === true
    });
    fecharModais();
    if (res && !res.sucesso && res.erro) showToast(res.erro, 'error');
}

async function reconfigurarPdv(ip) {
    limparConsole();
    mostrarLoading('Reconfigurando PDV...');
    const resposta = await window.sistema.configurarPdv({ ip });
    fecharModal('modalLoading');

    if (resposta.sucesso) showToast('PDV reconfigurado.');
    else showToast('Erro na reconfiguração: ' + resposta.erro, 'error');
}

// ---------- teste após reiniciar serviços ----------
function abrirModalTestePDV(ips) {
    const container = $('listaPdvsTeste');
    container.textContent = '';
    ips.forEach(ip => {
        container.appendChild(criarBotao({
            texto: `PDV ${numeroDoPdv(ip)} (abrir VNC)`, icon: 'monitor', classe: 'btn btn-primary btn-block',
            onClick: () => {
                fecharModais();
                window.sistema.abrirFerramenta({ ferramenta: 'vnc', ip, tipo: 'pdv', autoVnc: configSistema.vncAutoPdv === true });
            }
        }));
    });
    abrirModal('modalTestePDV');
}

// ---------- hora ----------
let ipPdvHora = '';

async function prepararModalHora(ip) {
    ipPdvHora = ip;
    mostrarLoading('Consultando a hora do PDV...');
    try {
        const resPDV = await window.sistema.rodarSSH({ host: ip, script: `date '+%d/%m/%Y %H:%M:%S'`, tipo: 'pdv' });
        const horaPC = new Date().toLocaleString('pt-BR');
        fecharModais();

        if (resPDV.sucesso && resPDV.resultado.trim() !== '') {
            $('horaPDVDisplay').textContent = resPDV.resultado.trim();
            $('horaPCDisplay').textContent = horaPC;
            abrirModal('modalAjusteHora');
        } else {
            showToast('Não foi possível ler a hora. O PDV está offline ou recusou a senha.', 'error');
        }
    } catch (e) { fecharModais(); showToast('Erro ao ler a hora do PDV.', 'error'); }
}

async function executarSincronizacaoHora() {
    fecharModal('modalAjusteHora');
    mostrarLoading('Sincronizando o relógio...');
    try {
        const d = await window.sistema.rodarComando(`powershell -Command "Get-Date -Format 'MMddHHmmyyyy'"`);
        const cmd = `date ${d.resultado.trim()} ; sudo hwclock --systohc`;
        const res = await window.sistema.rodarSSH({ host: ipPdvHora, script: cmd, tipo: 'pdv' });

        if (res.sucesso) showToast('Relógio sincronizado.');
        else showToast('Erro ao sincronizar o relógio.', 'error');
    } catch (e) { showToast('Falha na sincronização.', 'error'); } finally { fecharModais(); }
}

// ---------- segunda via (NSU) ----------
let ultimoArquivoNSUName = '';
let ipPdvAtualNSU = '';

function abrirModalNSU(numPdv = '') {
    if (!exigirFilial()) return;
    $('nsuData').value = '';
    $('nsuPdv').value = numPdv;
    $('nsuNumero').value = '';
    abrirModal('modalInputNSU');
    (numPdv ? $('nsuData') : $('nsuPdv')).focus();
}

async function processarExtrairNSU() {
    const rawData = $('nsuData').value.trim();
    const rawPdv = $('nsuPdv').value.trim();
    const rawNsu = $('nsuNumero').value.trim();

    if (!rawData || !rawPdv || !rawNsu) { showToast('Preencha todos os campos.', 'error'); return; }

    // tolera campos trocados: se o PDV ou o NSU tiver 8 dígitos, é a data
    let d = rawData, pdv = rawPdv, nsu = rawNsu;
    if (rawPdv.replace(/\D/g, '').length === 8) { d = rawPdv; pdv = rawData; }
    else if (rawNsu.replace(/\D/g, '').length === 8) { d = rawNsu; nsu = rawData; }

    const dLimpa = d.replace(/\D/g, '');
    if (dLimpa.length !== 8) { showToast('A data precisa ter 8 dígitos (DDMMAAAA).', 'error'); return; }

    const ipPdv = ipDoPdv(pdv);
    if (!ipPdv) { showToast('Informe o número do PDV (de 1 a 99).', 'error'); return; }

    const dia = dLimpa.slice(0, 2), mes = dLimpa.slice(2, 4), ano = dLimpa.slice(4, 8);
    const nsuSanitizado = nsu.replace(/[^0-9]/g, '');

    fecharModal('modalInputNSU');
    mostrarLoading('Extraindo do PDV...');

    const scriptBash = `
        F=$(ls /usr/p2k/bin/MFDE/MFDE*${ano}${mes}${dia}* 2>/dev/null | head -n 1)
        if [ -f "$F" ]; then
            if [ "\${F##*.}" = "zip" ]; then unzip -p "$F"; else cat "$F"; fi | awk -v n='${nsuSanitizado}' -v r='NSU(:|[[:space:]])[[:space:]]*0*' -v e='([^0-9]|$)' '{b=b $0 "\\r\\n"; if($0 ~ /^--+/ && p_line ~ /STOREX/){p=r n e; if(b ~ p) { sub(/^[^\\n]*\\n/, "", b); print b }; b=""}; p_line=$0} END{p=r n e; if(b ~ p && b != "") { sub(/^[^\\n]*\\n/, "", b); print b } }'
        fi
    `;

    try {
        ipPdvAtualNSU = ipPdv;
        const res = await window.sistema.rodarSSH({ host: ipPdv, script: scriptBash, tipo: 'pdv', senha: 'k2p', user: 'p2k' });
        const textoExtraido = res.resultado ? res.resultado.trim() : '';
        fecharModais();

        if (res.sucesso && textoExtraido !== '' && textoExtraido !== 'Comando executado.' && !textoExtraido.toLowerCase().includes('not found')) {
            ultimoArquivoNSUName = `SegundaVia_NSU${nsuSanitizado}_Filial${estado.filialAtual}_PDV${numeroDoPdv(ipPdv)}.txt`;
            $('previewNSU').value = textoExtraido;
            abrirModal('modalResultadoNSU');
        } else {
            abrirModal('modalErroNSU');
        }
    } catch (e) { fecharModais(); showToast('Erro ao extrair a segunda via.', 'error'); }
}

function abrirWinScpNSU() {
    fecharModais();
    window.sistema.abrirFerramenta({ ferramenta: 'winscp', ip: ipPdvAtualNSU, tipo: 'pdv', caminho: '/usr/p2k/bin/MFDE/' });
}

async function salvarArquivoNSU() {
    const texto = $('previewNSU').value;
    if (!texto) { showToast('Não há nada para salvar.', 'error'); return; }
    const res = await window.sistema.salvarArquivoNativo({ nomeSugerido: ultimoArquivoNSUName || 'SegundaVia.txt', conteudo: texto });
    fecharModais();
    if (res.cancelado) showToast('Salvamento cancelado.', 'warning');
    else if (res.sucesso) showToast('Arquivo salvo.');
    else showToast(`Falha ao salvar: ${res.erro}`, 'error');
}

// ---------- eventos ----------
function iniciarPdv() {
    $('pdvBoard').addEventListener('click', e => {
        const tile = e.target.closest('.pdv-tile');
        if (tile) abrirPdv(tile.dataset.ip);
    });

    $('modalPdvAcoes').addEventListener('click', e => {
        const btn = e.target.closest('[data-pdv-acao]');
        if (!btn || !estado.pdvSelecionado) return;
        const { ip, num } = estado.pdvSelecionado;
        executarAcaoPdv(btn.dataset.pdvAcao, ip, num);
    });
}
