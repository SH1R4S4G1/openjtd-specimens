// A component for callers that run catalogs unattended: keep Windows from
// sleeping while a catalog runs (0.20.1). An idle sleep six seconds into a macro once suspended Ichitaro and the
// wait for 2.5 hours (openjtd-borders-r3, br3-top31). A helper PowerShell process
// asks for ES_CONTINUOUS | ES_SYSTEM_REQUIRED (SetThreadExecutionState) and holds
// it until it is released or this process ends. Only idle sleep is held off: the
// display may still turn off, and a person's own sleep (power button, lid) is not
// prevented. Between catalogs nothing is held, so the computer sleeps as usual.
import { spawn } from 'node:child_process';

const ES_CONTINUOUS_SYSTEM_REQUIRED = 0x80000001;
export const keepAwakeScript = parentPid => [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -Namespace IchitaroUse -Name Power -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint flags);'",
  `$previous = [IchitaroUse.Power]::SetThreadExecutionState([uint32]${ES_CONTINUOUS_SYSTEM_REQUIRED})`,
  "[Console]::Out.WriteLine(\"awake $previous\"); [Console]::Out.Flush()",
  // The request ends with this thread; the loop keeps it until the parent is gone.
  `while (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 5 }`,
].join('\n');

// Resolves once the helper has made the request ({ held: true, pid }) or could
// not ({ held: false, reason }); a failure never stops the catalog. release()
// ends the helper, which ends the request.
export async function keepAwake({ spawnFn = spawn, platform = process.platform, parentPid = process.pid, readyMs = 20000 } = {}) {
  if (platform !== 'win32') return { held: false, reason: 'NOT_WINDOWS', release: async () => {} };
  const encoded = Buffer.from(keepAwakeScript(parentPid), 'utf16le').toString('base64');
  let child;
  try { child = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); }
  catch (error) { return { held: false, reason: error.code ?? error.message, release: async () => {} }; }
  let exited = false;
  const gone = new Promise(resolve => child.once('exit', () => { exited = true; resolve(); }));
  const state = await new Promise(resolve => {
    let out = '';
    const timer = setTimeout(() => resolve({ held: false, reason: 'NO_ANSWER' }), readyMs);
    const finish = value => { clearTimeout(timer); resolve(value); };
    child.stdout?.on('data', data => { out += data; const match = /awake (\d+)/.exec(out); if (match) finish(match[1] === '0' ? { held: false, reason: 'REFUSED' } : { held: true }); });
    child.once('error', error => finish({ held: false, reason: error.code ?? error.message }));
    child.once('exit', code => finish({ held: false, reason: `EXITED_${code}` }));
  });
  const release = async () => { if (!exited) { child.kill(); await gone; } };
  if (!state.held) await release();
  return { ...state, pid: child.pid ?? null, release };
}
