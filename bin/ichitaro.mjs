#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { loadExperiment, summarizeExperiment } from '../src/experiment.mjs';
import * as evidence from '../src/evidence.mjs';
import { loadCatalog, validateCatalog, writeCompilation } from '../src/sample-catalog.mjs';
import { isPdfCatalog, validatePdfCatalog } from '../src/pdf-catalog.mjs';

const help = {
  name: 'openjtd-specimens',
  usage: [
    'node bin/ichitaro.mjs validate <sample-catalog.json|pdf-catalog.json>',
    'node bin/ichitaro.mjs compile <sample-catalog.json> <new-output-directory>',
    'node bin/ichitaro.mjs plan <recipe.json> [--max-samples <1..1000>]',
    'node bin/ichitaro.mjs verify <run-directory>',
    'node bin/ichitaro.mjs report <run-directory>',
    'node bin/ichitaro.mjs help',
  ],
  commands: {
    validate: 'Sample Catalog または PDF Catalog（kind: pdf-from-jtd）のSchema・能力・意味的制約を検証します。一太郎は不要です。',
    compile: 'Sample Catalogを既存Execution Recipeと要求対応表へ変換します。一太郎は起動しません。',
    plan: 'JSON レシピを検証し、基準試料と独立した各設定変更を展開します。デスクトップ操作は行いません。',
    verify: '保存済み run の記録、JTD、スクリーンショット等のハッシュを検査します。',
    report: '保存済み HTML レポートの絶対パスを返します。ブラウザーは起動しません。',
    help: 'この JSON ヘルプを表示します。',
  },
  desktopControl: '試料作成は node bin/ichitaro-request.mjs <sample-catalog.json> <new-compile-directory> [output-root] [--pdf]（コンパイル済みRecipeを1つ実行するときは node bin/ichitaro-macro.mjs <recipe.json> [output-root]）。このCLIのplan/verify/reportは読取と計画のみ。',
};

function usageError(message) {
  return Object.assign(new Error(message), { code: 'ERR_CLI_USAGE' });
}

function output(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(args) {
  const [command = 'help', ...remaining] = args;
  if (['help', '--help', '-h'].includes(command)) {
    if (remaining.length) throw usageError('help does not accept extra arguments.');
    output(help);
    return;
  }
  if (!['validate', 'compile', 'plan', 'verify', 'report'].includes(command)) {
    throw usageError(`Unknown command: ${command}. Use help for supported commands.`);
  }
  const target = remaining[0];
  if (!target || target.startsWith('--')) throw usageError(`${command} requires a path argument.`);

  if (command === 'validate' || command === 'compile') {
    if (remaining.length !== (command === 'validate' ? 1 : 2) || remaining[1]?.startsWith('--')) {
      throw usageError(command === 'validate' ? 'Usage: validate <sample-catalog.json>' : 'Usage: compile <sample-catalog.json> <new-output-directory>');
    }
    const catalog = await loadCatalog(path.resolve(target));
    // A PDF Catalog (CR-006) has no recipes; it runs with bin/ichitaro-pdf.mjs.
    if (isPdfCatalog(catalog) && command === 'compile') throw usageError('A PDF Catalog is not compiled; run node bin/ichitaro-pdf.mjs <pdf-catalog.json> <input-directory> <new-output-directory>.');
    output(command === 'validate' ? (isPdfCatalog(catalog) ? validatePdfCatalog(catalog) : validateCatalog(catalog)) : await writeCompilation(catalog,remaining[1]));
    return;
  }

  if (command === 'plan') {
    const options = {};
    if (remaining.length !== 1) {
      if (remaining.length !== 3 || remaining[1] !== '--max-samples' || !/^\d+$/.test(remaining[2])) {
        throw usageError('Usage: plan <recipe.json> [--max-samples <1..1000>]');
      }
      options.maxSamples = Number(remaining[2]);
    }
    const recipePath = path.resolve(target);
    const plan = await loadExperiment(recipePath, options);
    output({
      command,
      recipePath,
      plan,
      summary: summarizeExperiment(plan),
      caveats: [
        '各試料は同じ defaults とその試料の上書き値から作る要求計画です。直前の試料の変更を引き継ぎません。',
        '一太郎では文字数・行数・字間・行間・余白などが連動します。changedFields は要求の差分であり、他の設定が固定されたことを意味しません。実際の設定を画面から読み戻して記録してください。',
        '数値範囲は計画段階の上限確認です。対象バージョンの一太郎が受け付ける範囲や単位は操作時に確認します。',
        'このコマンドは JSON 計画のみを出力します。JTD 作成やデスクトップの連続自動操作は実行しません。',
      ],
    });
    return;
  }

  if (remaining.length !== 1) throw usageError(`${command} accepts exactly one run-directory argument.`);
  const runDirectory = path.resolve(target);
  if (command === 'verify') {
    const result = await evidence.verifyRun(runDirectory);
    output({ command, runDirectory, ...result }, result.ok ? process.stdout : process.stderr);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  // The evidence workflow writes index.html as run state changes. Keep this
  // command read-only: it reports the path to that saved artifact.
  const reportPath = path.join(runDirectory, 'index.html');
  if (!(await stat(reportPath)).isFile()) throw usageError(`Report is not a regular file: ${reportPath}`);
  output({ command, runDirectory, reportPath });
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  output({
    ok: false,
    error: {
      name: error.name || 'Error',
      code: error.code || 'ERR_COMMAND_FAILED',
      message: String(error.message || error),
      ...(error.path ? { path: error.path } : {}),
    },
  }, process.stderr);
  process.exitCode = 1;
}
