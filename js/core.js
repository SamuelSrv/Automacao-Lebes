// =========================================================
// CORE — estado compartilhado e utilitários usados por todos os módulos
// =========================================================

const DOMINIO = '.lebes.com.br';
const IP_REGEX = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;

// Estado da sessão (o que antes eram variáveis soltas no app.js)
const estado = {
    filialAtual: '',
    ipServidorBase: '',
    redeBase: '',
    pdvsOnline: [],          // IPs dos PDVs online na filial conectada
    pdvSelecionado: null,    // { ip, num } do PDV aberto no modal de ações
    dispositivos: [],        // resultado do scanner de rede
    versaoLocal: ''
};

function $(id) { return document.getElementById(id); }

function escaparHtml(texto) {
    return String(texto ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Ícone do sprite SVG definido no index.html
function icone(nome, classe = '') {
    return `<svg class="icon ${classe}" aria-hidden="true"><use href="#i-${nome}"/></svg>`;
}

function criarBotao({ texto = '', icon = '', classe = 'btn', onClick = null, titulo = '' }) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = classe;
    if (titulo) { b.title = titulo; b.setAttribute('aria-label', titulo); }
    if (icon) b.insertAdjacentHTML('beforeend', icone(icon));
    if (texto) b.appendChild(document.createTextNode(texto));
    if (onClick) b.addEventListener('click', onClick);
    return b;
}

function criarBadge(texto, nivel = '') {
    const s = document.createElement('span');
    s.className = `badge ${nivel}`.trim();
    s.textContent = texto;
    return s;
}

function statusDot(nivel) { return `<span class="dot ${nivel}"></span>`; }

// ---------- números e IPs ----------
function ultimoOcteto(ip) { return parseInt(String(ip).split('.').pop(), 10); }
function numeroDoPdv(ip) { const o = ultimoOcteto(ip); return o > 100 ? o - 100 : o; }
function ordenarPorIp(lista) { return lista.sort((a, b) => ultimoOcteto(a) - ultimoOcteto(b)); }

// PDV 32 -> <rede>.132 (faixa 1..99 -> octeto 101..199)
function ipDoPdv(numero) {
    const n = parseInt(numero, 10);
    if (!estado.redeBase || !Number.isInteger(n) || n < 1 || n > 99) return null;
    return `${estado.redeBase}.${100 + n}`;
}

// ---------- scripts remotos ----------
function base64Utf8(texto) { return btoa(unescape(encodeURIComponent(texto))); }
function scriptEmBase64(script) { return `echo ${base64Utf8(script)} | base64 -d | sh`; }

// ---------- filial: DNS + autenticação SSH (usado por cadastro, consulta e desligamento) ----------
async function resolverEAutenticarFilial(filial) {
    if (!/^\d+$/.test(String(filial))) return { ok: false, erro: 'dns' };
    const resDns = await window.sistema.rodarComando(`nslookup filial${filial}${DOMINIO}`);
    const match = resDns.resultado ? resDns.resultado.match(IP_REGEX) : null;
    if (!match || match.length === 0) return { ok: false, erro: 'dns' };

    const ip = match[match.length - 1];
    const auth = await window.sistema.autenticarServidor(ip);
    return auth.sucesso ? { ok: true, ip } : { ok: false, erro: 'ssh', ip };
}

// ---------- toast ----------
function showToast(mensagem, tipo = 'success') {
    const container = $('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    const nomeIcone = tipo === 'success' ? 'check' : (tipo === 'info' ? 'info' : 'alert');
    toast.insertAdjacentHTML('beforeend', icone(nomeIcone));
    const txt = document.createElement('span');
    txt.textContent = mensagem;
    toast.appendChild(txt);
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}

// ---------- modais ----------
function abrirModal(id) { $(id).style.display = 'flex'; }
function fecharModal(id) { $(id).style.display = 'none'; }

function mostrarLoading(titulo) {
    $('modalTitulo').textContent = titulo;
    abrirModal('modalLoading');
}

function fecharModais() {
    resolverConfirmacao(false);
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
    if (typeof pararRamAoVivo === 'function') pararRamAoVivo();
}

// Confirmação antes de ações que alteram produção. Resolve true/false.
let _confirmacaoPendente = null;

function confirmarAcao({ titulo, mensagem, confirmar = 'Confirmar', perigo = true }) {
    return new Promise(resolve => {
        resolverConfirmacao(false);
        _confirmacaoPendente = resolve;

        $('confirmarTitulo').textContent = titulo;
        $('confirmarTexto').textContent = mensagem;

        const ok = $('confirmarOk');
        ok.textContent = confirmar;
        ok.className = `btn ${perigo ? 'btn-danger' : 'btn-primary'}`;
        $('confirmarIcone').classList.toggle('is-bad', perigo);

        abrirModal('modalConfirmar');
        ok.focus();
    });
}

function resolverConfirmacao(valor) {
    const resolve = _confirmacaoPendente;
    if (!resolve) return;
    _confirmacaoPendente = null;
    fecharModal('modalConfirmar');
    resolve(valor);
}
