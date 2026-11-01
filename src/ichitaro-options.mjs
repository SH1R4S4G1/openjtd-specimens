// Options shared by the commands that start Ichitaro (bin/ichitaro-macro.mjs,
// ichitaro-request.mjs and ichitaro-pdf.mjs; an external executor passes them on):
//   --exe <taro36.exe>         the Ichitaro to run; then ICHITARO_EXE, then the default
//   --allow-running-ichitaro   run the macro although an Ichitaro is already running
//                              (ICHITARO_ALLOW_RUNNING=1 does the same)
// takeIchitaroOptions removes them from the arguments and returns what was
// given; MacroAdapter resolves the rest (resolveIchitaroExe, allowRunningIchitaro
// in src/adapters/macro.mjs), so the executable that runs, the one recorded and
// the lock path always agree.
export const ICHITARO_OPTIONS_USAGE = '[--exe <taro36.exe>] [--allow-running-ichitaro]';

export function takeIchitaroOptions(argv) {
  const args = [];
  let exe, allowRunning;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--exe' || arg.startsWith('--exe=')) {
      exe = arg === '--exe' ? argv[++i] : arg.slice('--exe='.length);
      if (!exe || exe.startsWith('--')) throw Object.assign(new Error('--exe needs the path of the Ichitaro executable.'), { code: 'ERR_CLI_USAGE' });
    } else if (arg === '--allow-running-ichitaro') allowRunning = true;
    else args.push(arg);
  }
  return { args, exe, allowRunning };
}
