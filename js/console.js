// =========================================================
// CONSOLE — registro das ações. Tudo entra como texto (nunca como HTML),
// então uma saída com "<" ou "&" vinda de um servidor não quebra a tela.
// =========================================================

function logConsole(texto, classe = '') {
    const saida = $('consoleOutput');
    if (!saida) return;
    const span = document.createElement('span');
    if (classe) span.className = classe;
    span.textContent = texto;
    saida.appendChild(span);
    saida.scrollTop = saida.scrollHeight;
}

function logSeparador() { logConsole('='.repeat(42) + '\n', 'log-info'); }

function logExecucao(titulo, comando, rotulo = 'Comando') {
    logConsole('\n');
    logSeparador();
    logConsole(`[EXECUTANDO] ${titulo}\n`, 'log-info');
    logConsole(`${rotulo}: ${comando}\n`, 'log-dim');
    logConsole('Aguarde o processamento no servidor...\n');
}

function logSucesso(titulo, retorno) {
    logConsole(`\n[CONCLUÍDO] ${titulo}\n`, 'log-ok');
    logConsole((retorno || '(Executado sem retorno de texto)') + '\n');
    logSeparador();
    logConsole('\n');
}

function logErro(titulo, detalhe) {
    logConsole(`\n[ERRO] ${titulo}\n`, 'log-err');
    logConsole((detalhe || 'Desconhecido') + '\n', 'log-err');
    logSeparador();
    logConsole('\n');
}

function abrirConsole() { abrirModal('modalConsole'); }
function limparConsole() { $('consoleOutput').textContent = ''; }

// Saída em tempo real vinda do processo principal (SSH)
function iniciarConsole() {
    if (window.sistema && window.sistema.onConsoleUpdate) {
        window.sistema.onConsoleUpdate(texto => logConsole(texto));
    }
}
