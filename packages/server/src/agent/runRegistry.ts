/**
 * In-memory registry of active pipeline runs with AbortController support.
 * Used for run cancellation — when a user clicks "Stop Run",
 * we signal the AbortController to halt API calls mid-stream.
 */

const activeRuns = new Map<string, AbortController>();

export function registerRun(runId: string): AbortController {
  const controller = new AbortController();
  activeRuns.set(runId, controller);
  return controller;
}

export function cancelRun(runId: string): boolean {
  const controller = activeRuns.get(runId);
  if (!controller) return false;
  controller.abort();
  activeRuns.delete(runId);
  return true;
}

export function unregisterRun(runId: string): void {
  activeRuns.delete(runId);
}

export function isRunActive(runId: string): boolean {
  return activeRuns.has(runId);
}

export function getActiveRunIds(): string[] {
  return Array.from(activeRuns.keys());
}
