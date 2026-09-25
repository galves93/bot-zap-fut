const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { google } = require('googleapis');
const path = require('path');

// ================= CONFIGURAÇÕES =================
const SPREADSHEET_ID = '1y3CBgx_0q6RhSVmzJHmLS3A4qx9QZWqMUBlJC0LK8YQ';
const ABA_CONFRONTOS = 'Confrontos';
const ABA_CLASSIFICACAO = 'Classificação';
// =================================================

// 1. Dicionário de Apelidos / Normalização de Nomes
// Mapeie variações comuns para o nome exato registrado na planilha
const ALIASES = {
    'gabriel': 'Gabriel Alves',
    'gabriel alves': 'Gabriel Alves',
    'biel': 'Gabriel Alves',

    'rafael': 'Rafael Torraca',
    'rafael torraca': 'Rafael Torraca',
    'rafa': 'Rafael Torraca',
    'neila': 'Rafael Torraca',
    'torraca': 'Rafael Torraca',

    'gustavo alves': 'Gustavo Alves',
    'guga': 'Gustavo Alves',
    'gus': 'Gustavo Alves',

    'gustavo nerges': 'Gustavo Nerges',
    'nerges': 'Gustavo Nerges',

    'ricardo': 'Ricardo',
    'rick': 'Ricardo',

    'renan': 'Renan',
    'marcelo': 'Marcelo',
    'bruno': 'Bruno',
    'lorenzo': 'Lorenzo',
    'matheus': 'Matheus'
};

function normalizarNome(nomeInput) {
    const limpo = nomeInput.trim().toLowerCase();
    return ALIASES[limpo] || null;
}

// 2. Autenticação Google Sheets
const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: '/data/.wwebjs_auth' // Salva no volume persistente
    }),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    }
});

client.on('qr', (qr) => {
    console.log('Escaneie o QR Code:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Bot online com suporte a apelidos e novos comandos!');
});

// 4. Lógica: Atualizar Placar
async function atualizarPlacar(mandanteMsg, golsA, golsB, visitanteMsg) {
    try {
        const mandanteOficial = normalizarNome(mandanteMsg);
        const visitanteOficial = normalizarNome(visitanteMsg);

        if (!mandanteOficial) {
            return { sucesso: false, msg: `Não reconheci o jogador "${mandanteMsg}". Confira apelidos ou digite o nome completo.` };
        }
        if (!visitanteOficial) {
            return { sucesso: false, msg: `Não reconheci o jogador "${visitanteMsg}". Confira apelidos ou digite o nome completo.` };
        }

        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${ABA_CONFRONTOS}!B:E`,
        });

        const rows = res.data.values;
        if (!rows || rows.length === 0) return { sucesso: false, msg: 'Aba Confrontos vazia.' };

        let linhaEncontrada = -1;
        let jaTinhaPlacar = false;

        for (let i = 5; i < rows.length; i++) {
            const timeA = (rows[i][0] || '').trim().toLowerCase();
            const timeB = (rows[i][1] || '').trim().toLowerCase();

            if (timeA === mandanteOficial.toLowerCase() && timeB === visitanteOficial.toLowerCase()) {
                linhaEncontrada = i + 1;
                const placarA = rows[i][2];
                const placarB = rows[i][3];

                if (placarA !== undefined && placarA !== '' && placarB !== undefined && placarB !== '') {
                    jaTinhaPlacar = true;
                    continue; 
                } else {
                    jaTinhaPlacar = false;
                    break;
                }
            }
        }

        if (linhaEncontrada === -1) {
            return { 
                sucesso: false, 
                msg: `Não encontrei nenhum jogo com "${mandanteOficial}" de mandante e "${visitanteOficial}" de visitante.` 
            };
        }

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${ABA_CONFRONTOS}!D${linhaEncontrada}:E${linhaEncontrada}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[parseInt(golsA), parseInt(golsB)]]
            }
        });

        const aviso = jaTinhaPlacar ? ' ⚠️ *(Placar anterior sobrescrito)*' : '';
        return { 
            sucesso: true, 
            msg: `*Placar Registrado!* (Linha ${linhaEncontrada})\n⚽ ${mandanteOficial} *${golsA} x ${golsB}* ${visitanteOficial}${aviso}` 
        };

    } catch (error) {
        console.error('Erro na API:', error);
        return { sucesso: false, msg: 'Erro ao atualizar no Google Sheets.' };
    }
}

// 5. Lógica: Ler Tabela de Classificação
async function obterTabela() {
    try {
        // Pega da linha 5 até 15 na aba Classificação (Top 10 players)
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${ABA_CLASSIFICACAO}!A5:J15`,
        });

        const rows = res.data.values;
        if (!rows || rows.length < 2) return 'Tabela indisponível no momento.';

        let texto = '🏆 *CLASSIFICAÇÃO DO CAMPEONATO* ⚽\n';
        texto += '```-------------------------------\n';
        texto += '#  Player        PTS  J  V  SG\n';
        texto += '-------------------------------\n';

        for (let i = 1; i < rows.length; i++) {
            const [pos, player, j, v, , , , , sg, pts] = rows[i];
            if (!player) continue;

            const pPos = String(pos || i).padEnd(2, ' ');
            const pNome = String(player).substring(0, 11).padEnd(12, ' ');
            const pPts = String(pts || 0).padStart(3, ' ');
            const pJ = String(j || 0).padStart(2, ' ');
            const pV = String(v || 0).padStart(2, ' ');
            const pSg = String(sg || 0).padStart(3, ' ');

            texto += `${pPos} ${pNome} ${pPts} ${pJ} ${pV} ${pSg}\n`;
        }

        texto += '-------------------------------```';
        return texto;
    } catch (error) {
        console.error('Erro ao buscar tabela:', error);
        return 'Erro ao buscar tabela no Google Sheets.';
    }
}

// 6. Lógica: Próximos Jogos em Aberto
async function obterProximosJogos(jogadorInput) {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${ABA_CONFRONTOS}!A6:E95`,
        });

        const rows = res.data.values;
        if (!rows) return 'Sem dados de jogos.';

        let jogadorFiltro = null;
        if (jogadorInput) {
            jogadorFiltro = normalizarNome(jogadorInput);
            if (!jogadorFiltro) return `Jogador "${jogadorInput}" não identificado.`;
        }

        let pendentes = [];
        let rodadaAtual = '';

        for (let r of rows) {
            if (r[0]) rodadaAtual = r[0]; // Atualiza rodada se a célula não for vazia
            const mandante = r[1] || '';
            const visitante = r[2] || '';
            const golsA = r[3];
            const golsB = r[4];

            const emAberto = (golsA === undefined || golsA === '') && (golsB === undefined || golsB === '');

            if (emAberto && mandante && visitante) {
                if (!jogadorFiltro || mandante.toLowerCase() === jogadorFiltro.toLowerCase() || visitante.toLowerCase() === jogadorFiltro.toLowerCase()) {
                    pendentes.push(`• *R${rodadaAtual}:* ${mandante} vs ${visitante}`);
                }
            }
        }

        if (pendentes.length === 0) {
            return jogadorFiltro 
                ? `🎉 Todos os jogos de *${jogadorFiltro}* já foram realizados!` 
                : '🎉 Todos os jogos da competição foram realizados!';
        }

        // Limita a 8 jogos para não poluir o WhatsApp
        const sliceJogos = pendentes.slice(0, 8).join('\n');
        const totalRestante = pendentes.length > 8 ? `\n_...e mais ${pendentes.length - 8} jogos pendentes._` : '';
        const titulo = jogadorFiltro ? `Jogos pendentes de *${jogadorFiltro}*:` : 'Próximos jogos em aberto:';

        return `📅 *${titulo}*\n\n${sliceJogos}${totalRestante}`;

    } catch (error) {
        console.error('Erro ao buscar confrontos:', error);
        return 'Erro ao consultar jogos.';
    }
}

// 7. Ouvinte de Mensagens
client.on('message_create', async (msg) => {
    const texto = msg.body.trim();

    // Ignora respostas do próprio bot
    if (texto.startsWith('⚽') || texto.startsWith('❌') || texto.startsWith('⚠️') || texto.startsWith('🏆') || texto.startsWith('📅') || texto.startsWith('🤖')) {
        return;
    }

    // COMANDO: !ajuda
    if (texto === '!ajuda') {
        const menu = `🤖 *COMANDOS DO BOT* ⚽\n\n` +
                     `📌 *!placar [Mandante] [Gols] x [Gols] [Visitante]*\n` +
                     `_Ex: !placar Biel 4 x 2 Neila_\n\n` +
                     `📌 *!tabela*\n` +
                     `_Mostra o Top 10 atualizado da classificação_\n\n` +
                     `📌 *!jogos [nome]*\n` +
                     `_Ex: !jogos Lorenzo (mostra os pendentes dele) ou apenas !jogos_`;
        await msg.reply(menu);
        return;
    }

    // COMANDO: !tabela
    if (texto === '!tabela') {
        console.log('Solicitada tabela...');
        const tabela = await obterTabela();
        await msg.reply(tabela);
        return;
    }

    // COMANDO: !jogos ou !jogos [nome]
    if (texto.startsWith('!jogos')) {
        const param = texto.replace('!jogos', '').trim();
        console.log(`Buscando jogos para: ${param || 'Geral'}`);
        const jogos = await obterProximosJogos(param);
        await msg.reply(jogos);
        return;
    }

    // COMANDO: !placar
    if (texto.startsWith('!placar')) {
        const regex = /^!placar\s+(.+?)\s+(\d+)\s*[xX-]\s*(\d+)\s+(.+)$/;
        const match = texto.match(regex);

        if (!match) {
            await msg.reply('⚠️ Formato incorreto!\nUse: `!placar Mandante 2 x 1 Visitante`\nExemplo: `!placar Biel 5 x 2 Neila`');
            return;
        }

        const [, mandante, golsA, golsB, visitante] = match;
        console.log(`Placar recebido: ${mandante} ${golsA} x ${golsB} ${visitante}`);

        const res = await atualizarPlacar(mandante, golsA, golsB, visitante);
        await msg.reply(res.msg);
    }
});

client.initialize();