export interface PendingJobPlaceholder {
  error?: string;
  phase?: "queued" | "generating" | "interrupted";
  prePending?: boolean;
  tab?: "images" | "videos";
  folderId?: string | null;
}

export interface JobCleanupScope {
  tab: "images" | "videos";
  folderIds: string[] | null;
}

/** Placeholder-only cleanup: never infer a failure from elapsed time. */
export function shouldClearJob(job: PendingJobPlaceholder, scope: JobCleanupScope): boolean {
  return !job.prePending && (!!job.error || job.phase === "interrupted")
    && (job.tab == null || job.tab === scope.tab)
    && (scope.folderIds === null || (job.folderId != null && scope.folderIds.includes(job.folderId)));
}
