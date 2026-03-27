import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const defaultPorts = [3344, 3345];

const normalizeText = (value) => value.toLowerCase().replaceAll('\\', '/');

const normalizedRepoRoot = normalizeText(repoRoot);
const candidateProcessPatterns = ['electron-forge', 'electron-forge-start.js', '/electron ', '/electron.app/'];

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    return { ok: false, stdout: '', stderr: result.error.message, status: null };
  }

  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    status: result.status,
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseForgePorts = () => {
  const forgeConfigPath = path.join(repoRoot, 'forge.config.ts');

  if (!existsSync(forgeConfigPath)) {
    return defaultPorts;
  }

  const source = readFileSync(forgeConfigPath, 'utf8');
  const matchedPorts = [
    source.match(/\bport:\s*(\d+)/)?.[1],
    source.match(/\bloggerPort:\s*(\d+)/)?.[1],
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  return matchedPorts.length > 0 ? [...new Set(matchedPorts)] : defaultPorts;
};

const isCandidateCommand = (commandLine) => {
  const normalizedCommand = normalizeText(commandLine);

  return (
    normalizedCommand.includes(normalizedRepoRoot) ||
    candidateProcessPatterns.some((pattern) => normalizedCommand.includes(pattern))
  );
};

const getUnixListeningPids = (port) => {
  const result = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);

  if (!result.ok || !result.stdout) {
    return [];
  }

  return [...new Set(result.stdout.split(/\s+/).map((value) => Number(value)).filter(Boolean))];
};

const getUnixCommandLine = (pid) => run('ps', ['-o', 'command=', '-p', String(pid)]).stdout;

const killUnixProcess = (pid, signal) => run('kill', [`-${signal}`, String(pid)]).ok;

const getWindowsListeningPids = (ports) => {
  const psScript = [
    `$ports = @(${ports.join(',')})`,
    'Get-NetTCPConnection -State Listen |',
    'Where-Object { $ports -contains $_.LocalPort } |',
    'Select-Object -ExpandProperty OwningProcess -Unique',
  ].join(' ');

  const result = run('powershell.exe', ['-NoProfile', '-Command', psScript]);

  if (!result.ok || !result.stdout) {
    return [];
  }

  return [...new Set(result.stdout.split(/\s+/).map((value) => Number(value)).filter(Boolean))];
};

const getWindowsCommandLine = (pid) => {
  const psScript = `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`;
  return run('powershell.exe', ['-NoProfile', '-Command', psScript]).stdout;
};

const killWindowsProcess = (pid) =>
  run('powershell.exe', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force`]).ok;

const isPortStillListening = (port) => {
  if (process.platform === 'win32') {
    return getWindowsListeningPids([port]).length > 0;
  }

  return getUnixListeningPids(port).length > 0;
};

const waitForPortsToClose = async (ports, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (ports.every((port) => !isPortStillListening(port))) {
      return true;
    }

    await sleep(250);
  }

  return ports.every((port) => !isPortStillListening(port));
};

const describeTargetProcesses = (ports) => {
  const processMap = new Map();

  if (process.platform === 'win32') {
    for (const pid of getWindowsListeningPids(ports)) {
      processMap.set(pid, getWindowsCommandLine(pid));
    }
    return processMap;
  }

  for (const port of ports) {
    for (const pid of getUnixListeningPids(port)) {
      if (!processMap.has(pid)) {
        processMap.set(pid, getUnixCommandLine(pid));
      }
    }
  }

  return processMap;
};

const terminateProcesses = async (ports) => {
  const processMap = describeTargetProcesses(ports);
  const targetEntries = [...processMap.entries()].filter(([, commandLine]) => isCandidateCommand(commandLine));

  if (targetEntries.length === 0) {
    if (processMap.size > 0) {
      const skipped = [...processMap.entries()]
        .map(([pid, commandLine]) => `${pid}: ${commandLine || '(unknown command line)'}`)
        .join('\n');

      console.log('[prestart] ports are busy, but the listeners do not look like this repo\'s Electron Forge dev process');
      console.log(skipped);
      return;
    }

    console.log(`[prestart] no existing Electron Forge dev process found on ports ${ports.join(', ')}`);
    return;
  }

  for (const [pid, commandLine] of targetEntries) {
    console.log(`[prestart] stopping pid ${pid}: ${commandLine}`);
    if (process.platform === 'win32') {
      killWindowsProcess(pid);
    } else {
      killUnixProcess(pid, 'TERM');
    }
  }

  if (await waitForPortsToClose(ports, 5000)) {
    return;
  }

  console.log('[prestart] escalating to force-stop for lingering dev processes');

  for (const [pid] of targetEntries) {
    if (process.platform === 'win32') {
      killWindowsProcess(pid);
    } else {
      killUnixProcess(pid, 'KILL');
    }
  }

  if (!(await waitForPortsToClose(ports, 5000))) {
    const busyPorts = ports.filter((port) => isPortStillListening(port));
    throw new Error(`unable to free Electron Forge dev ports: ${busyPorts.join(', ')}`);
  }
};

await terminateProcesses(parseForgePorts());
