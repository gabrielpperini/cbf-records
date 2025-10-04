import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';

const resultsDir = './results';

// Ler todos os arquivos JSON da pasta results
const files = fs.readdirSync(resultsDir).filter(file => file.endsWith('.json'));

if (files.length === 0) {
  console.log('Nenhum arquivo JSON encontrado na pasta results/');
  process.exit(0);
}

// Adicionar opção para converter todos
const choices = [
  { name: '📦 Todos os arquivos', value: 'all' },
  new inquirer.Separator(),
  ...files.map(file => ({ name: file, value: file }))
];

const { selectedFile } = await inquirer.prompt([
  {
    type: 'list',
    name: 'selectedFile',
    message: 'Selecione o arquivo JSON para converter:',
    choices
  }
]);

const filesToProcess = selectedFile === 'all' ? files : [selectedFile];

console.log('');
filesToProcess.forEach(file => {
  const jsonFile = path.join(resultsDir, file);
  const outputFile = path.join("./excel", file.replace('.json', '.xlsx'));

  console.log(`Processando: ${file}`);

  const jsonData = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
  console.log(`  → Total de registros: ${jsonData.length}`);

  // Criar worksheet a partir do JSON
  const worksheet = XLSX.utils.json_to_sheet(jsonData);

  // Criar workbook e adicionar a worksheet
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Resultados');

  // Escrever o arquivo Excel
  XLSX.writeFile(workbook, outputFile);
  console.log(`  ✓ Excel criado: ${path.basename(outputFile)}\n`);
});
