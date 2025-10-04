import { Listr } from "listr2";
import inquirer from "inquirer";
import terminalImage from "terminal-image";
import { Buffer } from "buffer";
import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import fs from "fs";

// cria o jar que armazena cookies
const jar = new CookieJar();

const api = wrapper(axios.create({
    baseURL: "https://bid.cbf.com.br",
    headers: {
        "accept": "*/*",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.8,fr;q=0.7",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "user-agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
        "origin": "https://bid.cbf.com.br",
        "referer": "https://bid.cbf.com.br/",
        "sec-ch-ua": "\"Chromium\";v=\"140\", \"Not=A?Brand\";v=\"24\", \"Google Chrome\";v=\"140\"",
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": "\"Android\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
    },
    jar,
    withCredentials: true, // necessário para mandar cookies de volta
}));

function parseDateBR(dateStr) {
  const [day, month, year] = dateStr.split("/").map(Number);

  // se não tiver 3 partes numéricas válidas
  if (!day || !month || !year) return null;

  // cria um Date com ano, mês (0-based) e dia
  const d = new Date(year, month - 1, day);

  // valida se bate (ex: 31/02 vira 03/03 no JS, então precisa conferir)
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }

  return d;
}

const getCaptcha = async () => {
    // Primeiro, buscar a página principal para obter o token CSRF e estabelecer sessão
    const mainPage = await api.get("/").then(e => e.data);

    // Extrair o token CSRF da página
    const csrfMatch = mainPage.match(/name="csrf-token"\s+content="([^"]+)"/);
    if (csrfMatch) {
        api.defaults.headers["x-csrf-token"] = csrfMatch[1];
        console.log("Token CSRF obtido:", csrfMatch[1]);
    }

    await api.get("/get-captcha-base64").then(e => e.data).then(async (e) => {// qualquer imagem
        const image = Buffer.from(e, 'base64');
        console.log(await terminalImage.buffer(image));
    })

    // pede qual o captcha pro user
    return await inquirer.prompt([{
        type: "input",
        message: "Qual o captcha?",
        name: "captcha"
    }]).then(e => e.captcha.toUpperCase());
}


const getListByDate = async (date, captcha, retries = 3) => {
    const dados = new URLSearchParams();
    dados.append("data", date);
    dados.append("uf", "");
    dados.append("captcha", captcha);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const data = await api.post("/busca-json", dados.toString()).then(e => e.data);
            if (!Array.isArray(data)) {
                throw new Error("Resposta inesperada do servidor");
            }
            return data;
        } catch (error) {
            if (attempt === retries) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
}

const processDates = async (dates, captcha, allResults, failedDates) => {
    const tasks = new Listr(dates.map(date => ({
        title: `Buscando ${date.toLocaleDateString('pt-BR')}`,
        task: async (ctx, task) => {
            const dateStr = date.toLocaleDateString('pt-BR');
            try {
                const res = await getListByDate(dateStr, captcha);
                if (res && res.length > 0) {
                    allResults.push(...res);
                    task.title = `${dateStr} - ${res.length} registros`;
                } else {
                    task.title = `${dateStr} - 0 registros`;
                }
            } catch (error) {
                task.title = `${dateStr} - Erro: ${error.message}`;
                failedDates.push(dateStr);
                throw error;
            }
        }
    })), { concurrent: true, exitOnError: false, rendererOptions: { collapseErrors: false } });

    await tasks.run();
}

const retryFailed = async () => {
    const failedFile = 'results/.last-failed.json';

    if (!fs.existsSync(failedFile)) {
        console.log('Nenhum arquivo de falhas encontrado.');
        return;
    }

    const failedData = JSON.parse(fs.readFileSync(failedFile, 'utf-8'));

    if (failedData.dates.length === 0) {
        console.log('Nenhuma data com falha para reprocessar.');
        return;
    }

    console.log(`\nEncontradas ${failedData.dates.length} datas com falha:`);
    failedData.dates.forEach(d => console.log(`  - ${d}`));

    const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'Deseja reprocessar estas datas?',
        default: true
    }]);

    if (!confirm) return;

    await api.get("/");
    const captcha = await getCaptcha();

    const allResults = [];
    const newFailedDates = [];

    // Converter strings de data de volta para objetos Date
    const dates = failedData.dates.map(dateStr => {
        const [day, month, year] = dateStr.split('/');
        return new Date(year, month - 1, day);
    });

    await processDates(dates, captcha, allResults, newFailedDates);

    // Carregar resultados existentes e mesclar
    if (fs.existsSync(failedData.originalFile)) {
        const existingResults = JSON.parse(fs.readFileSync(failedData.originalFile, 'utf-8'));
        allResults.push(...existingResults);
    }

    // Salvar resultados atualizados
    fs.writeFileSync(failedData.originalFile, JSON.stringify(allResults, null, 2));
    console.log(`\n✓ Resultados atualizados em: ${failedData.originalFile}`);
    console.log(`Total: ${allResults.length} registros`);

    // Atualizar arquivo de falhas
    if (newFailedDates.length > 0) {
        fs.writeFileSync(failedFile, JSON.stringify({
            dates: newFailedDates,
            originalFile: failedData.originalFile,
            lastAttempt: new Date().toISOString()
        }, null, 2));
        console.log(`\n⚠ ${newFailedDates.length} datas ainda falharam`);
    } else {
        fs.unlinkSync(failedFile);
        console.log('\n✓ Todas as datas foram processadas com sucesso!');
    }
}

const main = async () => {

    await api.get("/");

    const args = process.argv.slice(2);

    // Menu principal
    const mode = args[0] && ['new', 'retry'].includes(args[0]) ? args[0] : (await inquirer.prompt([{
        type: 'list',
        name: 'mode',
        message: 'O que deseja fazer?',
        choices: [
            { name: 'Buscar por período de datas', value: 'new' },
            { name: 'Reprocessar datas que falharam', value: 'retry' }
        ]
    }]).then(e => e.mode));

    if (mode === 'retry') {
        await retryFailed();
        return;
    }

    // Pedir datas ao usuário
    const dateAnswers = await (async () => {

        if(parseDateBR(args[1]) && parseDateBR(args[2])) {
            return {
                startDate: args[1],
                endDate: args[2]
            };
        }

        return await inquirer.prompt([
            {
                type: "input",
                message: "Data de início (DD/MM/YYYY):",
                name: "startDate",
                default: "01/01/2025"
            },
            {
                type: "input",
                message: "Data final (DD/MM/YYYY):",
                name: "endDate",
                default: new Date().toLocaleDateString('pt-BR'),
            }
        ])
    })();

    // Converter strings para objetos Date
    const [startDay, startMonth, startYear] = dateAnswers.startDate.split('/');
    const [endDay, endMonth, endYear] = dateAnswers.endDate.split('/');
    const startDate = new Date(startYear, startMonth - 1, startDay);
    const endDate = new Date(endYear, endMonth - 1, endDay);

    const captcha = await getCaptcha();

    const allResults = [];
    const failedDates = [];

    // Gerar lista de todas as datas
    const dates = [];
    for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
        dates.push(new Date(date));
    }

    console.log(`Buscando dados de ${startDate.toLocaleDateString('pt-BR')} até ${endDate.toLocaleDateString('pt-BR')}`);

    await processDates(dates, captcha, allResults, failedDates);

    console.log(`\nTotal: ${allResults.length} registros`);

    // Salvar resultados em arquivo JSON
    const startDateStr = startDate.toLocaleDateString('pt-BR').replace(/\//g, '-');
    const endDateStr = endDate.toLocaleDateString('pt-BR').replace(/\//g, '-');
    const fileName = `results/resultados_${startDateStr}_a_${endDateStr}.json`;
    fs.writeFileSync(fileName, JSON.stringify(allResults, null, 2));
    console.log(`Resultados salvos em: ${fileName}`);

    // Salvar datas que falharam
    if (failedDates.length > 0) {
        const failedFile = 'results/.last-failed.json';
        fs.writeFileSync(failedFile, JSON.stringify({
            dates: failedDates,
            originalFile: fileName,
            lastAttempt: new Date().toISOString()
        }, null, 2));
        console.log(`\n⚠ ${failedDates.length} datas falharam e foram salvas em: ${failedFile}`);
        console.log('Datas com erro:');
        failedDates.forEach(d => console.log(`  - ${d}`));
    }
}

main();