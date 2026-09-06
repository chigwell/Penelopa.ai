export type DesktopAuthState = { authenticated: boolean; signedOut: boolean; error?: string };
export type DesktopApiRequest = { path: string; method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown };
export type DesktopBridge = {
  version: 1;
  auth: { state(): Promise<DesktopAuthState>; signOut(): Promise<void> };
  request(request: DesktopApiRequest): Promise<{ status: number; data: unknown }>;
  openConnection(): Promise<void>;
};
export type AppPreferences = { paused: boolean; notifications: boolean; autostart: boolean };
export type AgentStatus = {
  name: 'Codex' | 'Claude Code'; configured: boolean; detected: boolean; lastEventAt: string | null;
  state: 'needs-repair' | 'awaiting-event' | 'connected'; error: string | null;
};
export type ConnectionStatus = {
  installed: boolean; version: string | null; paused: boolean; agents: AgentStatus[];
  pendingEvents: number; queuedSegments: number; queuedBytes: number; quarantinedSegments: number;
  lastUploadAt: string | null; selfTest: { passed: boolean; at: string } | null;
  desktop: { version: string; signed: 'ad-hoc' | 'unsigned'; error: string | null } | null;
  errors: { at?: string; error: string }[];
};
export type UpdateState = {
  phase: 'idle' | 'downloading' | 'building' | 'ready-to-restart' | 'complete' | 'error';
  available?: boolean; version?: string; checkedAt?: string; error?: string;
};
export type LocalAction = 'state' | 'navigate' | 'retry' | 'repair' | 'connect' | 'sign-out' | 'preferences' |
  'test-notification' | 'export-diagnostics' | 'check-update' | 'update' | 'uninstall' | 'quit';
