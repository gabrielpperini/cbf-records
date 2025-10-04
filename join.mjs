import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';

const resultsDir = './results';

// Ler todos os arquivos JSON da pasta results
const filesName = fs.readdirSync(resultsDir).filter(file => file.endsWith('.json'));

if (filesName.length < 2) {
    console.log('é necessário ter pelo menos 2 arquivos JSON na pasta results/');
    process.exit(0);
}

const files = filesName.map(file => ({
    name: file,
    data: JSON.parse(fs.readFileSync(path.join(resultsDir, file), 'utf-8')),
}));

console.log('Selecione os arquivos para juntar:\n');

// Primeira selecao
const { selectedFiles } = await inquirer.prompt([
    {
        type: 'checkbox',
        name: 'selectedFiles',
        message: 'Selecione os arquivos:',
        choices: files.map(f => ({ name: `${f.name} (${f.data.length} registros)`, value: f })),
        validate: (input) => {
            if (input.length <= 2) {
                return 'Por favor, selecione no mínimo 2 arquivos.';
            }
            return true;
        },
    }
]);


// Sugerir nome para o arquivo de saída
const defaultOutputName = `resultados_unidos_${Date.now()}.json`;
const { outputName } = await inquirer.prompt([
    {
        type: 'input',
        name: 'outputName',
        message: 'Nome do arquivo de saida:',
        default: defaultOutputName
    }
]);

console.log('\nCarregando arquivos...');

// Juntar os arrays
const combinedData = selectedFiles.flatMap(f => f.data);

console.log(`\nTotal combinado: ${combinedData.length} registros`);

// Salvar o resultado
const outputPath = path.join(resultsDir, outputName);
fs.writeFileSync(outputPath,"[" + combinedData.map(el => JSON.stringify(el)).join(",") + "]");

console.log(`Arquivo criado: ${outputName}`);
