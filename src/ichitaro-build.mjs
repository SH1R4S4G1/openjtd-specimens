import * as fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// The executable reports FileVersion 1.0, so the build is identified by its hash.
export async function ichitaroBuild(exe) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$v=(Get-Item -LiteralPath '${exe.replaceAll("'", "''")}').VersionInfo; $v.ProductName; $v.FileVersion`], { encoding: 'utf8' });
  const [productName = null, fileVersion = null] = result.status === 0 ? result.stdout.split(/\r?\n/).map(line => line.trim()) : [];
  try { const bytes = await fs.readFile(exe); const stat = await fs.stat(exe); return { exe, productName, fileVersion, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, modifiedAt: stat.mtime.toISOString() }; }
  catch { return { exe, productName, fileVersion }; }
}

// Read-only snapshot of the top-level windows of a running Ichitaro (for
// example a dialog that kept a macro from finishing), through UI Automation.
// Nothing is clicked or closed. The main window's own contents are not walked;
// other windows (dialogs) list up to 40 named elements each (text and buttons).
const WINDOW_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$name = $env:ICHITARO_WINDOW_PROCESS
$ids = @(Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$A = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$all = [System.Windows.Automation.Condition]::TrueCondition
$out = @()
foreach ($w in $A::RootElement.FindAll($scope::Children, $all)) {
  if ($ids -notcontains $w.Current.ProcessId) { continue }
  $texts = @()
  if ($w.Current.ClassName -eq '#32770' -or $w.Current.ControlType.ProgrammaticName -ne 'ControlType.Window' -or $w.FindAll($scope::Children, $all).Count -lt 30) {
    foreach ($e in $w.FindAll($scope::Descendants, $all)) {
      # Ichitaro's message boxes expose their text as Pane elements of class Static.
      if ($e.Current.Name) { $texts += [pscustomobject]@{ type = $e.Current.ControlType.ProgrammaticName.Substring(12); className = $e.Current.ClassName; name = $e.Current.Name } }
      if ($texts.Count -ge 40) { break }
    }
  }
  $out += [pscustomobject]@{ title = $w.Current.Name; className = $w.Current.ClassName; texts = $texts }
}
ConvertTo-Json -InputObject @($out) -Depth 5 -Compress
`;
export function ichitaroWindows(exe, { timeoutMs = 30000 } = {}) {
  const processName = exe.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOW_SCRIPT], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, env: { ...process.env, ICHITARO_WINDOW_PROCESS: processName } });
  if (result.status !== 0) return { error: (result.stderr || result.error?.message || `exit ${result.status}`).trim().slice(0, 500) };
  try { return { windows: JSON.parse(result.stdout.replace(/^﻿/, '').trim() || '[]') }; }
  catch (error) { return { error: `unreadable window list: ${error.message}` }; }
}
