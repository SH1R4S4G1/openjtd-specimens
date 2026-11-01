import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { keepAwake, keepAwakeScript } from '../src/keep-awake.mjs';
import { MacroAdapter, awakeTimer, SLEEP_GAP_MS } from '../src/adapters/macro.mjs';

// A helper process that answers like the PowerShell script.
function fakeSpawn(answer) {
  const calls = [];
  const spawnFn = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.pid = 777; child.killed = false;
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('exit', 1)); return true; };
    calls.push({ command, args, options, child });
    setImmediate(() => answer(child));
    return child;
  };
  return { spawnFn, calls };
}

test('0.20.1: keepAwake holds ES_CONTINUOUS | ES_SYSTEM_REQUIRED through a helper until released', async () => {
  const { spawnFn, calls } = fakeSpawn(child => child.stdout.emit('data', 'awake 2147483648\r\n'));
  const awake = await keepAwake({ spawnFn, platform: 'win32', parentPid: 4242 });
  assert.equal(awake.held, true);
  assert.equal(awake.pid, 777);
  const { command, args, options, child } = calls[0];
  assert.equal(command, 'powershell.exe');
  assert.equal(options.windowsHide, true);
  const script = Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
  assert.equal(script, keepAwakeScript(4242));
  assert.match(script, /SetThreadExecutionState\(\[uint32\]2147483649\)/);
  assert.match(script, /Get-Process -Id 4242/);
  assert.equal(child.killed, false);
  await awake.release();
  assert.equal(child.killed, true);
  await awake.release(); // a second release is harmless
});

test('0.20.1: a refused, silent or failing helper is reported, not thrown, and is ended', async () => {
  const refused = fakeSpawn(child => child.stdout.emit('data', 'awake 0\r\n'));
  const r = await keepAwake({ spawnFn: refused.spawnFn, platform: 'win32' });
  assert.deepEqual([r.held, r.reason, refused.calls[0].child.killed], [false, 'REFUSED', true]);
  const silent = fakeSpawn(() => {});
  assert.equal((await keepAwake({ spawnFn: silent.spawnFn, platform: 'win32', readyMs: 50 })).reason, 'NO_ANSWER');
  const exited = fakeSpawn(child => child.emit('exit', 1));
  assert.equal((await keepAwake({ spawnFn: exited.spawnFn, platform: 'win32' })).reason, 'EXITED_1');
  const missing = await keepAwake({ spawnFn: () => { throw Object.assign(new Error('no'), { code: 'ENOENT' }); }, platform: 'win32' });
  assert.equal(missing.reason, 'ENOENT');
  assert.equal((await keepAwake({ platform: 'linux' })).reason, 'NOT_WINDOWS');
});

test('0.20.1: a gap of more than SLEEP_GAP_MS between polls is left out of a wait', () => {
  const times = [100, 200, 200 + 9_280_000, 200 + 9_280_100, 200 + 9_280_100 - 5];
  const timer = awakeTimer(0, { now: () => times.shift() });
  assert.deepEqual([timer.elapsed(), timer.elapsed(), timer.elapsed(), timer.elapsed(), timer.elapsed()], [100, 200, 200, 300, 300]);
  assert.equal(timer.suspendedMs, 9_280_000);
  assert.equal(SLEEP_GAP_MS, 10000);
});

test('0.20.1: the marker wait survives a sleep in the middle of a macro, and still times out without one', async () => {
  // The r3 case: the computer slept 2.5 hours a few seconds into the macro; after
  // waking, Ichitaro finished and wrote the marker.
  let clock = 0, polls = 0;
  const nonce = '12345678-1234-1234-1234-123456789abc';
  const slept = new MacroAdapter({ now: () => clock, readFile: async () => {
    polls++;
    clock += polls === 3 ? 9_280_000 : 500;
    if (polls < 6) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return nonce;
  } });
  await slept.waitForMarker('done.txt', nonce, 0, 2000, 'Macro timed out');
  assert.equal(slept.suspendedMs, 9_280_000);
  clock = 0;
  const stuck = new MacroAdapter({ now: () => clock, readFile: async () => { clock += 600; throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } });
  await assert.rejects(stuck.waitForMarker('done.txt', nonce, 0, 2000, 'Macro timed out'), { code: 'ERR_MACRO_TIMEOUT' });
  assert.equal(stuck.suspendedMs, 0);
});

test('0.20.1: the exit wait leaves out a sleep too', async () => {
  let clock = 0, checks = 0;
  const adapter = new MacroAdapter({ now: () => clock, processRunning: async () => { checks++; clock += checks === 2 ? 3_600_000 : 100; return checks < 4; } });
  assert.equal(await adapter.waitForExit({ limitMs: 1000 }), 300);
  assert.equal(adapter.suspendedMs, 3_600_000);
});
