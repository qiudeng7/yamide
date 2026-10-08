import { readFileSync, readdirSync } from 'node:fs';
/** Linux runtime: terminate descendants before their parent, then enforce cleanup. */
export function stopProcessTree(pid: number) {
  const processes = new Map<number, { parent: number; start: string }>();
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const text = readFileSync(`/proc/${entry}/stat`, 'utf8');
      const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
      processes.set(Number(entry), {
        parent: Number(fields[1]),
        start: fields[19]!,
      });
    } catch {
      /* Process disappeared. */
    }
  }
  const owned: number[] = [];
  function collect(parent: number) {
    for (const [child, info] of processes)
      if (info.parent === parent) {
        collect(child);
        owned.push(child);
      }
  }
  collect(pid);
  owned.push(pid);
  function signal(kind: NodeJS.Signals) {
    for (const child of owned) {
      try {
        const text = readFileSync(`/proc/${child}/stat`, 'utf8');
        const start = text.slice(text.lastIndexOf(')') + 2).split(' ')[19];
        if (start === processes.get(child)?.start) process.kill(child, kind);
      } catch {
        /* Already exited. */
      }
    }
  }
  signal('SIGTERM');
  const timer = setTimeout(() => signal('SIGKILL'), 2000);
  timer.unref();
}
