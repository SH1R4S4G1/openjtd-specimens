import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { macroString, compileSample, decodeMacroText, parseMacroResult, MacroAdapter, DEFAULT_EXE, resolveIchitaroExe, allowRunningIchitaro } from '../src/adapters/macro.mjs';
import { takeIchitaroOptions } from '../src/ichitaro-options.mjs';
import { FEATURE_GROUPS } from '../src/features.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nonce = '12345678-1234-1234-1234-123456789abc';
const settings = { chars: 39, lines: 40, characterSpacing: 4, lineSpacing: 59, marginTop: 31, marginBottom: 30, marginLeft: 30, marginRight: 30 };
const units = { spacingUnit: 100, marginUnit: 1, orientation: 1, priority: 0 };
const utf16 = value => Buffer.from('\uFEFF' + value, 'utf16le');
function record(phase, fullName, overrides = {}) {
  return [`[${phase}]`, ...Object.entries({ ...settings, ...units, ...overrides }).map(([k, v]) => `${k}=${v}`), `fullName=${fullName}`].join('\r\n');
}
function result(output, overrides = {}) {
  return utf16([`nonce=${overrides.nonce ?? nonce}`, record('before-save', output, overrides.before), `savedPath=${overrides.savedPath ?? output}`, record('reopened', overrides.reopenedPath ?? output, overrides.reopened), 'status=ok', ''].join('\r\n'));
}
function command(overrides = {}) {
  const root = path.resolve('macro-unit-sample');
  return { nonce, output: path.join(root, 'document.jtd'), text: '日本語\r\nsecond line', settings, resultPath: path.join(root, 'result.txt'), bodyPath: path.join(root, 'body.txt'), donePath: path.join(root, 'done.txt'), ...overrides };
}

test('extended compiler applies fixed setters, reads actual column keys and quits without saving after the completion marker',()=>{
  const source=compileSample(command({features:{font:{size:12},paper:{name:'A4'},columns:{twoEnabled:1},layout:{orientation:2}}}));
  assert.ok(source.includes('DocumentStyleFont(,,,,,12)'));
  assert.ok(source.includes('DocumentStyleColumns(,,1)'));
  assert.ok(source.includes('DocumentStyleLayout(,,,,,2)'));
  assert.ok(source.includes(macroString('二段組文字数')));
  assert.ok(!source.includes('if %success = 1 then')); // a reported macro error also quits (no window left behind)
  assert.ok(source.indexOf('%done.Close()')<source.indexOf('Application.Quit(3)'));
});
test('extended parser preserves inactive nulls and rejects missing numeric readback',()=>{
  const fields=Object.entries(FEATURE_GROUPS).flatMap(([group,def])=>Object.entries(def.fields).map(([field,info])=>`feature.${group}.${field}=${info.nullable?'':info.type==='string'?'example':info.type==='font'?10:info.values?.[0]??info.min}`)).join('\n')+'\n';
  const raw=decodeMacroText(result(path.resolve('document.jtd'))).replace(`nonce=${nonce}`,`nonce=${nonce}\nfeaturesVersion=1`).replace('[reopened]',fields+'[reopened]').replace('status=ok',fields+'status=ok');
  const parsed=parseMacroResult(utf16(raw),nonce);
  assert.equal(parsed.observed.reopened.features.columns.twoChars,null);
  assert.equal(parsed.observed.reopened.features.font.westernName,10);
  assert.throws(()=>parseMacroResult(utf16(raw.replace('feature.font.size=5','feature.font.size=')),nonce),/Invalid feature/);
  assert.throws(()=>parseMacroResult(utf16(raw.replace('feature.columns.twoChars=\n','')),nonce),/Missing feature/);
});
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ichitaro-macro-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const exe = path.join(dir, 'fake.exe');
  await writeFile(exe, 'fake');
  const sampleDir = path.join(dir, 'sample');
  await mkdir(sampleDir);
  return { exe, lockPath: path.join(dir, 'runner.lock'), sample: { dir: sampleDir, documentPath: path.join(sampleDir, 'document.jtd') }, text: '日本語\r\nsecond line', settings: { ...settings } };
}
function fakeLaunch(overrides = {}, hook) {
  return async (_exe, macroPath) => {
    const job = path.dirname(macroPath);
    const spec = JSON.parse(await readFile(path.join(job, 'command.json'), 'utf8'));
    if (hook) await hook(spec);
    await writeFile(spec.output, 'synthetic JTD bytes');
    let bytes=result(spec.output, { nonce: spec.nonce, ...overrides });
    if(spec.captureFeatures && !overrides.omitFeatures){
      const fields=Object.entries(FEATURE_GROUPS).flatMap(([group,def])=>Object.entries(def.fields).map(([field,info])=>`feature.${group}.${field}=${info.nullable?'':info.type==='string'?'example':info.type==='font'?10:info.values?.[0]??info.min}`)).join('\n')+'\n';
      const before=fields.replace('feature.font.size=5',`feature.font.size=${overrides.beforeSize??12}`);
      const reopened=fields.replace('feature.font.size=5',`feature.font.size=${overrides.afterSize??12}`);
      bytes=utf16(decodeMacroText(bytes).replace(`nonce=${spec.nonce}`,`nonce=${spec.nonce}\nfeaturesVersion=1`).replace('[reopened]',before+'[reopened]').replace('status=ok',reopened+'status=ok'));
    }
    await writeFile(path.join(job, 'result.txt'), bytes);
    await writeFile(path.join(job, 'body.txt'), utf16(overrides.body ?? spec.text.replace(/\r\n|\r/g, '\n') + '\r\n'));
    await writeFile(path.join(job, 'done.txt'), overrides.done ?? spec.nonce);
    return { pid: 123 };
  };
}

test('adapter requires extended proof and detects requested and round-trip feature differences',async t=>{
  for(const overrides of [{},{beforeSize:11},{afterSize:13},{omitFeatures:true}]){
    const f=await fixture(t);f.features={font:{size:12}};
    const adapter=new MacroAdapter({exe:f.exe,lockPath:f.lockPath,launch:fakeLaunch(overrides)});
    if(overrides.omitFeatures)await assert.rejects(adapter.createSample(f),/Extended feature/);
    else {
      const actual=await adapter.createSample(f);
      assert.equal(actual.verification.passed,Object.keys(overrides).length===0);
      if(Object.keys(overrides).length)assert.ok(actual.verification.differences.some(d=>d.field==='features.font.size'));
    }
  }
});

test('macro literals double quotes, retain backslashes, and encode non-ASCII/control characters as Char calls', () => {
  assert.equal(macroString(''), '""');
  assert.equal(macroString('a"b\\c'), '"a""b\\c"');
  assert.equal(macroString('日\r\n\t'), 'Char(26085,5) & Char(13,5) & Char(10,5) & Char(9,5)');
  const literal = macroString('"\nend\nRun("evil")');
  assert.ok(!literal.includes('\n'));
  assert.equal(literal, '"""" & Char(10,5) & "end" & Char(10,5) & "Run(""evil"")"');
  for (const value of [null, 5, '\0', '\uD800', '😀']) assert.throws(() => macroString(value), /BMP Unicode/);
});

test('sample compiler emits ASCII fixed operations with one-factor settings and normalized body', () => {
  const source = compileSample(command({ settings: { characterSpacing: 4 }, text: '日\r\n"\nRun("evil")' }));
  assert.match(source, /^[\x00-\x7F]*$/);
  assert.ok(source.includes('DocumentStyleLayout(,,4,)\r\nSetDocumentStyle()'));
  assert.ok(!/^DocumentStyleMargin\(/m.test(source));
  assert.ok(source.includes('foreach %line in %body\r\n%bodyFile.LinePrint(%line)\r\nnext'));
  assert.ok(source.includes('Insert(Char(26085,5) & Char(10,5)'));
  assert.ok(!/^Run\(/m.test(source));
  assert.ok(source.includes('NewDocument()'));
  const baseline = compileSample(command({ input: path.resolve('baseline.jtd') }));
  assert.ok(baseline.includes('OpenDocumentFile('));
  assert.ok(!baseline.includes('NewDocument()'));
  assert.ok(!baseline.includes('Insert('));
});

test('sample compiler rejects malformed or injected settings, nonce, paths, and text', () => {
  for (const invalid of [null, [], Object.create(null), { unknown: 1 }, { chars: '39' }, { chars: NaN }, { chars: Infinity }, { chars: 10001 }, { lines: 3.5 }, { chars: '1)\nRun("evil")' }]) {
    assert.throws(() => compileSample(command({ settings: invalid })), /Settings|Invalid numeric/);
  }
  assert.throws(() => compileSample(command({ nonce: 'injected' })), /nonce/);
  assert.throws(() => compileSample(command({ output: 'relative.jtd' })), /absolute local path/);
  assert.throws(() => compileSample(command({ donePath: path.resolve('bad\nname') })), /absolute local path/);
  assert.throws(() => compileSample(command({ text: 'x'.repeat(100001) })), /100000/);
});

test('layout priority is explicit and never inferred from a spacing request', () => {
  assert.ok(compileSample(command({settings:{characterSpacing:2}})).includes('DocumentStyleLayout(,,2,)'));
  assert.ok(compileSample(command({settings:{characterSpacing:2},layoutPriority:'spacing'})).includes('DocumentStyleLayout(,,2,,,,0)'));
  assert.ok(compileSample(command({settings:{chars:39},layoutPriority:'counts'})).includes('DocumentStyleLayout(39,,,,,,1)'));
  assert.throws(()=>compileSample(command({layoutPriority:'guess'})),/layoutPriority/);
});

test('result parser decodes UTF-16 and returns both numeric snapshots and metadata', () => {
  const output = path.resolve('document.jtd');
  const parsed = parseMacroResult(result(output), nonce);
  assert.deepEqual(parsed.observed['before-save'].settings, settings);
  assert.deepEqual(parsed.observed.reopened.settings, settings);
  assert.equal(parsed.meta.savedPath, output);
  assert.equal(parsed.observed.reopened.marginUnit, 1);
  assert.equal(decodeMacroText(utf16('日本語')), '日本語');
  assert.throws(() => decodeMacroText(Buffer.from([0])), /Incomplete UTF-16/);
});

test('result parser rejects foreign, incomplete, duplicate, malformed, and nonnumeric results', () => {
  const output = path.resolve('document.jtd');
  assert.throws(() => parseMacroResult(result(output, { nonce: 'other-job' }), nonce), /another job/);
  const source = decodeMacroText(result(output));
  assert.throws(() => parseMacroResult(utf16(source.slice(0, source.indexOf('[reopened]')) + 'status=ok'), nonce), /Missing macro readback phase/);
  assert.throws(() => parseMacroResult(utf16(source + '[reopened]\n'), nonce), /Duplicate result phase/);
  assert.throws(() => parseMacroResult(utf16(source + 'status=ok\n'), nonce), /Duplicate result key/);
  assert.throws(() => parseMacroResult(utf16(source + 'broken line\n'), nonce), /Malformed/);
  for (const value of ['NaN', 'Infinity', '', '1e3', '39junk', '9'.repeat(400)]) {
    assert.throws(() => parseMacroResult(result(output, { before: { chars: value } }), nonce), /Invalid getter|Nonfinite getter/);
  }
});

test('result parser preserves macro error phase, category, code, line, and message', () => {
  const details = { nonce, status: 'error', errorPhase: 'save', errorCode: '-1', errorCategory: 'SystemError', errorMessage: '保存失敗 = details', errorLine: '22' };
  const bytes = utf16(Object.entries(details).map(([k, v]) => `${k}=${v}`).join('\n'));
  assert.throws(() => parseMacroResult(bytes, nonce), error => {
    assert.equal(error.code, 'ERR_MACRO_EXECUTION');
    assert.equal(error.message, details.errorMessage);
    assert.deepEqual(error.details, details);
    return true;
  });
});

test('adapter verifies fake launch, saved identities, body, and reopen settings', async t => {
  const f = await fixture(t);
  const adapter = new MacroAdapter({ exe: f.exe, lockPath: f.lockPath, launch: fakeLaunch() });
  assert.equal((await adapter.connect()).protocol, 'sprint-file-v1');
  const actual = await adapter.createSample(f);
  assert.equal(actual.verification.passed, true);
  assert.equal(actual.verification.reopened, true);
  assert.equal(actual.body, '日本語\nsecond line');
  assert.deepEqual(actual.launch, { pid: 123 });
  assert.equal(adapter.busy, false);
  assert.equal(adapter.uncertain, false);
});

test('adapter reports requested, reopened, units, and body mismatches', async t => {
  const f = await fixture(t);
  const adapter = new MacroAdapter({ exe: f.exe, lockPath: f.lockPath, launch: fakeLaunch({ before: { chars: 40 }, reopened: { marginTop: 32, spacingUnit: 2 }, body: 'different\r\n' }) });
  const actual = await adapter.createSample(f);
  assert.equal(actual.verification.passed, false);
  assert.equal(actual.verification.bodyMatches, false);
  for (const [phase, field] of [['requested', 'chars'], ['reopened', 'chars'], ['reopened', 'marginTop'], ['reopened', 'spacingUnit'], ['body', 'text']]) {
    assert.ok(actual.verification.differences.some(item => item.phase === phase && item.field === field));
  }
});

test('newline-free requests ignore only readback line breaks and retain original body evidence',async t=>{
  const text='甲'.repeat(40)+'乙'.repeat(40)+'丙'.repeat(10);
  const wrapped='甲'.repeat(40)+'\n'+'乙'.repeat(40)+'\n'+'丙'.repeat(10);
  for(const [readback,passed,count] of [[text,true,0],[wrapped,true,2],[wrapped.replace('丙','丁'),false,2],[wrapped.replace('丙',''),false,2],[wrapped+' ',false,2]]){
    const f=await fixture(t);f.text=text;
    const actual=await new MacroAdapter({exe:f.exe,lockPath:f.lockPath,launch:fakeLaunch({body:readback+'\r\n'})}).createSample(f);
    assert.equal(actual.verification.passed,passed);assert.equal(actual.verification.bodyMatches,passed);
    assert.equal(actual.body,readback);
    assert.equal(actual.verification.bodyComparison,count?'single-paragraph-ignore-readback-line-breaks':'exact-text');
    assert.equal(actual.verification.bodyComparisonDetails?.ignoredReadbackLineBreaks,count||undefined);
    if(!passed)assert.equal(actual.verification.differences.find(d=>d.phase==='body').actual,readback);
  }
});

test('explicit LF, CRLF and CR requests keep exact paragraph boundaries including trailing blank lines',async t=>{
  for(const separator of ['\n','\r\n','\r'])for(const readback of ['甲\n乙\n','甲乙','甲\n\n乙\n','甲\n乙']){
    const f=await fixture(t);f.text='甲'+separator+'乙'+separator;
    const actual=await new MacroAdapter({exe:f.exe,lockPath:f.lockPath,launch:fakeLaunch({body:readback+'\r\n'})}).createSample(f);
    assert.equal(actual.verification.bodyMatches,readback==='甲\n乙\n');
    assert.equal(actual.verification.bodyComparison,'exact-text');
    assert.equal(actual.verification.bodyComparisonDetails,undefined);
  }
});

test('adapter refuses overwrites before dispatch', async t => {
  const f = await fixture(t);
  await writeFile(f.sample.documentPath, 'existing');
  let launches = 0;
  const adapter = new MacroAdapter({ exe: f.exe, lockPath: f.lockPath, launch: async () => { launches++; } });
  await assert.rejects(adapter.createSample(f), /overwrite/);
  assert.equal(launches, 0);
  assert.equal(await readFile(f.sample.documentPath, 'utf8'), 'existing');
});

test('adapter refuses a mismatched completion marker and blocks recovery after uncertain dispatch', async t => {
  const f = await fixture(t);
  const adapter = new MacroAdapter({ exe: f.exe, lockPath: f.lockPath, launch: fakeLaunch({ done: 'another-job' }) });
  await assert.rejects(adapter.createSample(f), /Unexpected completion marker/);
  assert.equal(adapter.uncertain, true);
  assert.equal(adapter.busy, false);
  await assert.rejects(adapter.createSample(f), /unknown outcome/);
});

test('adapter rejects a different document identity', async t => {
  const f = await fixture(t);
  const adapter = new MacroAdapter({ exe: f.exe, lockPath: f.lockPath, launch: fakeLaunch({ reopenedPath: path.resolve('different.jtd') }) });
  await assert.rejects(adapter.createSample(f), /different document/);
  assert.equal(adapter.uncertain, false);
});

test('adapter times out once and does not redispatch an unknown job', async t => {
  const f = await fixture(t);
  let launches = 0;
  const adapter = new MacroAdapter({ exe: f.exe, lockPath: f.lockPath, timeoutMs: 1000, launch: async () => { launches++; return { pid: 1 }; } });
  await assert.rejects(adapter.createSample(f), { code: 'ERR_MACRO_TIMEOUT' });
  await assert.rejects(adapter.createSample(f), /unknown outcome/);
  assert.equal(launches, 1);
  assert.equal(adapter.busy, false);
});

test('adapter rejects simultaneous work while its launch is pending', async t => {
  const f = await fixture(t);
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const adapter = new MacroAdapter({ exe: f.exe, lockPath: f.lockPath, launch: fakeLaunch({}, async () => { entered(); await gate; }) });
  const first = adapter.createSample(f);
  await started;
  try {
    await assert.rejects(adapter.createSample(f), /busy/);
    const otherAdapter = new MacroAdapter({ exe: f.exe, lockPath: f.lockPath, launch: fakeLaunch() });
    await assert.rejects(otherAdapter.createSample(f), { code: 'EEXIST' });
  }
  finally { release(); }
  assert.equal((await first).verification.passed, true);
});

test('styleSource new-document records the new document units instead of requiring percent and mm',async t=>{
  for(const styleSource of ['new-document',null]){
    const f=await fixture(t);
    const adapter=new MacroAdapter({exe:f.exe,lockPath:f.lockPath,launch:fakeLaunch({before:{spacingUnit:2},reopened:{spacingUnit:2}})});
    const result=await adapter.createSample({sample:f.sample,text:f.text,settings:{},styleSource});
    assert.equal(result.observed.reopened.spacingUnit,2);
    assert.equal(result.verification.passed,styleSource!==null,JSON.stringify(result.verification.differences));
    // A changed unit between save and reopen is still a difference.
    const g=await fixture(t);
    const changed=await new MacroAdapter({exe:g.exe,lockPath:g.lockPath,launch:fakeLaunch({before:{spacingUnit:2},reopened:{spacingUnit:3}})}).createSample({sample:g.sample,text:g.text,settings:{},styleSource});
    assert.equal(changed.verification.passed,false);
  }
});

test('0.21.0: the executable is --exe, then ICHITARO_EXE, then the default, and the lock follows it', async t => {
  assert.equal(resolveIchitaroExe('C:/other/taro36.exe', { ICHITARO_EXE: 'C:/env/taro36.exe' }), path.resolve('C:/other/taro36.exe'));
  assert.equal(resolveIchitaroExe(undefined, { ICHITARO_EXE: 'C:/env/taro36.exe' }), path.resolve('C:/env/taro36.exe'));
  assert.equal(resolveIchitaroExe(undefined, { ICHITARO_EXE: '' }), path.resolve(DEFAULT_EXE));
  assert.equal(resolveIchitaroExe(undefined, {}), path.resolve(DEFAULT_EXE));
  assert.equal(allowRunningIchitaro(undefined, {}), false);
  assert.equal(allowRunningIchitaro(undefined, { ICHITARO_ALLOW_RUNNING: '1' }), true);
  assert.equal(allowRunningIchitaro(undefined, { ICHITARO_ALLOW_RUNNING: 'yes' }), false);
  assert.equal(allowRunningIchitaro(true, {}), true);
  const f = await fixture(t);
  const same = [new MacroAdapter({ exe: f.exe }), new MacroAdapter({ exe: f.exe })].map(adapter => adapter.lockPath);
  assert.equal(same[0], same[1]);
  assert.notEqual(new MacroAdapter({ exe: path.join(path.dirname(f.exe), 'other.exe') }).lockPath, same[0]);
  // The CLI options are taken out of the arguments; what is left is the command's own.
  assert.deepEqual(takeIchitaroOptions(['a.json', '--exe', 'C:/x/taro36.exe', 'runs', '--allow-running-ichitaro']), { args: ['a.json', 'runs'], exe: 'C:/x/taro36.exe', allowRunning: true });
  assert.deepEqual(takeIchitaroOptions(['--exe=C:/x/taro36.exe', 'a.json']), { args: ['a.json'], exe: 'C:/x/taro36.exe', allowRunning: undefined });
  assert.deepEqual(takeIchitaroOptions(['a.json', '--pdf']), { args: ['a.json', '--pdf'], exe: undefined, allowRunning: undefined });
  assert.throws(() => takeIchitaroOptions(['a.json', '--exe']), { code: 'ERR_CLI_USAGE' });
  assert.throws(() => takeIchitaroOptions(['--exe', '--allow-running-ichitaro']), { code: 'ERR_CLI_USAGE' });
  // A missing executable is refused by connect() with its path, before any macro.
  const missing = new MacroAdapter({ exe: path.join(path.dirname(f.exe), 'missing.exe'), lockPath: f.lockPath });
  await assert.rejects(missing.connect(), error => error.code === 'ERR_ICHITARO_EXE_MISSING' && error.message.includes('missing.exe') && error.message.includes('--exe'));
  assert.deepEqual(await new MacroAdapter({ exe: f.exe, lockPath: f.lockPath }).connect(), { exe: f.exe, adapter: 'macro', protocol: 'sprint-file-v1' });
});

test('0.21.0: ichitaro-request exits with 2 on a usage error, as ichitaro-pdf does', async t => {
  // Both cases fail before the adapter exists: nothing is compiled, started or looked up.
  const dir = await mkdtemp(path.join(tmpdir(), 'request-usage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const args of [['catalog.json', 'compile', '--exe'], ['catalog.json']]) {
    const usage = spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'ichitaro-request.mjs'), ...args], { cwd: dir, encoding: 'utf8', timeout: 20000 });
    assert.equal(usage.status, 2, usage.stdout + usage.stderr);
    const summary = JSON.parse(usage.stdout);
    assert.equal(summary.ok, false);
    assert.equal(summary.jobs[0].errorCode, 'ERR_CLI_USAGE');
    assert.equal(summary.compileDirectory, null);
    assert.equal(summary.counts.EXECUTION_ERROR, 1);
  }
  await assert.rejects(access(path.join(dir, 'compile')));
});

test('0.21.0: an Ichitaro already running is not started into unless allowed, and nothing is dispatched', async t => {
  const f = await fixture(t);
  let launches = 0;
  const running = { value: true };
  const adapter = new MacroAdapter({ exe: f.exe, lockPath: f.lockPath, processRunning: async () => running.value, launch: async (...args) => { launches++; return fakeLaunch()(...args); } });
  assert.equal(adapter.allowRunning, false);
  await assert.rejects(adapter.createSample(f), { code: 'ERR_ICHITARO_ALREADY_RUNNING' });
  assert.equal(launches, 0);
  assert.equal(adapter.uncertain, false); // nothing was dispatched, so the outcome is known
  assert.equal(adapter.busy, false);
  await assert.rejects(access(f.lockPath), { code: 'ENOENT' }); // the lock is released
  await assert.rejects(access(f.sample.documentPath), { code: 'ENOENT' });
  // The same adapter works once Ichitaro has quit.
  running.value = false;
  const g = await fixture(t);
  assert.equal((await new MacroAdapter({ exe: g.exe, lockPath: g.lockPath, processRunning: async () => running.value, launch: fakeLaunch() }).createSample(g)).verification.passed, true);
  // exportPdf is guarded by the same check.
  running.value = true;
  const jtd = path.join(path.dirname(f.exe), 'existing.jtd');
  await writeFile(jtd, 'jtd bytes');
  await assert.rejects(adapter.exportPdf({ jtd, pdf: path.join(path.dirname(f.exe), 'out.pdf'), workDir: path.join(path.dirname(f.exe), 'out.macro') }), { code: 'ERR_ICHITARO_ALREADY_RUNNING' });
  assert.equal(launches, 0);
  await assert.rejects(access(f.lockPath), { code: 'ENOENT' });
  // allowRunning (the --allow-running-ichitaro flag or ICHITARO_ALLOW_RUNNING=1) continues.
  // (The running Ichitaro is then expected to quit with the macro, as the second unknown outcome requires.)
  const h = await fixture(t), afterLaunch = { launched: false };
  const allowed = new MacroAdapter({ exe: h.exe, lockPath: h.lockPath, allowRunning: true, processRunning: async () => !afterLaunch.launched, launch: async (...launch) => { afterLaunch.launched = true; return fakeLaunch()(...launch); } });
  assert.equal((await allowed.createSample(h)).verification.passed, true);
  const byEnvironment = new MacroAdapter({ exe: h.exe, lockPath: h.lockPath, allowRunning: allowRunningIchitaro(undefined, { ICHITARO_ALLOW_RUNNING: '1' }), processRunning: async () => true, launch: fakeLaunch() });
  assert.equal(byEnvironment.allowRunning, true);
});
