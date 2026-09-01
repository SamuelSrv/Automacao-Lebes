const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sistema', {
    rodarComando: (comando) => ipcRenderer.invoke('rodar-comando', comando),
    rodarSSH: (dados) => ipcRenderer.invoke('rodar-ssh', dados),
    abrirFerramenta: (dados) => ipcRenderer.invoke('abrir-ferramenta', dados),
    salvarArquivoNativo: (dados) => ipcRenderer.invoke('salvar-arquivo-nativo', dados),
    verificarAtualizacao: () => ipcRenderer.invoke('verificar-atualizacao'),
    autenticarServidor: (ip) => ipcRenderer.invoke('autenticar-servidor', ip),
    
    toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),
    
    // NOVA PONTE: Ouve o terminal do servidor em tempo real
    onConsoleUpdate: (callback) => ipcRenderer.on('console-update', (event, data) => callback(data))
});