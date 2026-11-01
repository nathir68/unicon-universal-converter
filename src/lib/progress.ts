const progressMap = new Map<string, number>();

export function getProgress(jobId: string): number {
  return progressMap.get(jobId) ?? 0;
}

export function setProgress(jobId: string, pct: number): void {
  progressMap.set(jobId, pct);
}

export function clearProgress(jobId: string): void {
  progressMap.delete(jobId);
}
