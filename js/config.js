// =========================================================
// CONFIG — opções salvas no computador, tema e informações de versão
// =========================================================

let configSistema = { vncAutoPdv: false, vncAutoAdm: false };

function carregarConfiguracoes() {
    try {
        const salvo = localStorage.getItem('lebesConfig');
        if (salvo) configSistema = { ...configSistema, ...JSON.parse(salvo) };
    } catch (e) { console.error('Erro ao carregar configurações', e); }

    atualizarInterruptor('checkAutoPdv', 'statusAutoPdv', configSistema.vncAutoPdv);
    atualizarInterruptor('checkAutoAdm', 'statusAutoAdm', configSistema.vncAutoAdm);
}

function atualizarInterruptor(idCheck, idStatus, ligado) {
    const chk = $(idCheck), lbl = $(idStatus);
    if (!chk || !lbl) return;
    chk.checked = ligado;
    lbl.textContent = ligado ? 'Ativado' : 'Desativado';
    lbl.classList.toggle('on', ligado);
    lbl.classList.toggle('off', !ligado);
}

function salvarConfiguracoes() {
    configSistema.vncAutoPdv = $('checkAutoPdv').checked;
    configSistema.vncAutoAdm = $('checkAutoAdm').checked;
    try { localStorage.setItem('lebesConfig', JSON.stringify(configSistema)); } catch (e) { }
    carregarConfiguracoes();
    showToast('Configuração salva.');
}

// ---------- tema ----------
function aplicarTema(tema) {
    document.documentElement.dataset.theme = tema === 'claro' ? 'light' : 'dark';
    $('btnTemaEscuro').classList.toggle('active', tema !== 'claro');
    $('btnTemaClaro').classList.toggle('active', tema === 'claro');
}

function carregarTema() {
    let tema = 'escuro';
    try { tema = localStorage.getItem('lebesTema') === 'claro' ? 'claro' : 'escuro'; } catch (e) { }
    aplicarTema(tema);
}

function definirTema(tema) {
    try { localStorage.setItem('lebesTema', tema); } catch (e) { }
    aplicarTema(tema);
}

// ---------- versão ----------
// Retorna -1 se a < b, 0 se iguais, 1 se a > b (compara 1.5.2 com 1.10.0 corretamente)
function compararVersoes(a, b) {
    const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0, y = pb[i] || 0;
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

function definirSelo(id, texto, nivel) {
    const el = $(id);
    el.textContent = texto;
    el.className = `badge ${nivel}`.trim();
}

function renderizarNotasVersao(info) {
    const box = $('verNotas');
    box.innerHTML = '';

    const titulo = document.createElement('h4');
    titulo.textContent = info.versaoRede ? `Notas da versão ${info.versaoRede}` : 'Notas da versão';
    box.appendChild(titulo);

    if (info.notas && info.notas.length) {
        const ul = document.createElement('ul');
        info.notas.forEach(n => { const li = document.createElement('li'); li.textContent = n; ul.appendChild(li); });
        box.appendChild(ul);
    } else {
        const p = document.createElement('p');
        p.textContent = info.sucesso
            ? 'Nenhuma nota foi publicada para esta versão.'
            : 'Sem acesso às notas porque a rede não respondeu.';
        box.appendChild(p);
    }
    if (info.data) {
        const d = document.createElement('p');
        d.style.marginTop = '8px';
        d.textContent = `Publicada em ${info.data}`;
        box.appendChild(d);
    }
}

async function carregarInfoVersao() {
    $('verRede').textContent = '...';
    definirSelo('verStatus', 'Consultando a rede...', '');
    $('verNotas').innerHTML = '<p>Consultando as notas da versão...</p>';

    if (!window.sistema.obterInfoVersao) {
        definirSelo('verStatus', 'Atualize o preload.js para ver a versão da rede', 'warn');
        return;
    }

    let info;
    try { info = await window.sistema.obterInfoVersao(); }
    catch (e) { info = { sucesso: false, erro: e.message }; }

    if (info.versaoLocal) { estado.versaoLocal = info.versaoLocal; $('verLocal').textContent = info.versaoLocal; }

    if (!info.sucesso) {
        $('verRede').textContent = '-';
        definirSelo('verStatus', info.erro || 'Rede indisponível', 'warn');
        renderizarNotasVersao(info);
        return;
    }

    $('verRede').textContent = info.versaoRede;
    const cmp = compararVersoes(info.versaoRede, info.versaoLocal);
    if (cmp === 0) definirSelo('verStatus', 'Este computador está atualizado', 'ok');
    else if (cmp > 0) definirSelo('verStatus', 'Há uma versão mais nova na rede', 'info');
    else definirSelo('verStatus', 'A versão instalada é mais nova que a da rede', 'warn');

    renderizarNotasVersao(info);
}

// ---------- atualização ----------
async function checarAtualizacao() {
    mostrarLoading('Verificando atualizações na rede...');
    try {
        const res = await window.sistema.verificarAtualizacao();
        fecharModais();
        if (res && res.atualizado) showToast('O sistema já está na versão mais recente.');
        else if (res && res.erro) showToast(res.erro, 'error');
    } catch (err) { fecharModais(); showToast('Erro ao verificar atualização: ' + err.message, 'error'); }
}

// ---------- novidades (aparece uma vez por versão) ----------
function verificarExibicaoChangelog() {
    if (!estado.versaoLocal) return;
    $('changelogVersao').textContent = estado.versaoLocal;
    try {
        if (localStorage.getItem('lebesChangelogVisto') !== estado.versaoLocal) abrirModal('modalChangelog');
    } catch (e) { console.error(e); }
}

function fecharModalChangelog() {
    fecharModal('modalChangelog');
    try { localStorage.setItem('lebesChangelogVisto', estado.versaoLocal); } catch (e) { }
}
