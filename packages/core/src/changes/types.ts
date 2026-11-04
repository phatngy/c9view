export interface ChangeHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}
export interface ToolChange {
  toolUseId: string;
  messageUuid: string;
  timestamp: string | null;
  tool: string;
  filePath: string;
  kind: 'create' | 'update';
  hunks: ChangeHunk[];
  additions: number;
  deletions: number;
  source: 'structuredPatch' | 'computed';
  userModified: boolean;
  tooLarge?: boolean;
}
export interface FileHistoryVersion {
  version: number;
  backupFileName: string | null;
  messageId: string;
  backupTime: string;
}
export interface SessionChangedFile {
  fileId: string;
  filePath: string;
  relPath: string;
  kind: 'create' | 'update';
  /** Sum of returned step counts; sessionFileDiff supplies exact net counts. */
  additions: number;
  deletions: number;
  toolUseIds: string[];
  firstAt: string | null;
  lastAt: string | null;
}
export interface SessionFileDiff {
  fileId: string;
  filePath: string;
  hunks: ChangeHunk[];
  additions: number;
  deletions: number;
  source: 'file-history' | 'tool-hunks';
  steps: ToolChange[];
  tooLarge: boolean;
  partial: boolean;
  truncated?: boolean;
}
