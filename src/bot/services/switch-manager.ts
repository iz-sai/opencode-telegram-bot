import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../../utils/logger.js";

const execFileAsync = promisify(execFile);

export interface SessionCandidate {
  source: string;
  session_id: string;
  title: string;
  date: string;
  timestamp: number;
  token_count: number;
  cost: number;
  directory: string | null;
  messages_count: number;
}

export interface DispatchIntent {
  action: "continue" | "fork_with_summary" | "new_session" | "search_only";
  confidence: "high" | "low";
  query_terms: string[];
  date_filter: string | null;
  target_dir_mode: string;
  target_dir_name: string | null;
  prompt_continuation: string | null;
  session_goal: string | null;
}

export interface DispatchResponse {
  utterance: string;
  intent: DispatchIntent;
  target_dir: string;
  candidates: SessionCandidate[];
}

interface WaitingState {
  promptMessageId?: number | undefined;
  createdAt: number;
}

const waitingMap = new Map<number, WaitingState>();
const resultsMap = new Map<number, DispatchResponse>();
const WAITING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function startSwitchWaiting(chatId: number, promptMessageId?: number): void {
  waitingMap.set(chatId, {
    promptMessageId,
    createdAt: Date.now(),
  });
}

export function isSwitchWaiting(chatId: number): boolean {
  const state = waitingMap.get(chatId);
  if (!state) return false;
  if (Date.now() - state.createdAt > WAITING_TIMEOUT_MS) {
    waitingMap.delete(chatId);
    return false;
  }
  return true;
}

export function getSwitchWaiting(chatId: number): WaitingState | undefined {
  if (!isSwitchWaiting(chatId)) return undefined;
  return waitingMap.get(chatId);
}

export function clearSwitchWaiting(chatId: number): void {
  waitingMap.delete(chatId);
}

export function storeSwitchResult(chatId: number, result: DispatchResponse): void {
  resultsMap.set(chatId, result);
}

export function getSwitchResult(chatId: number): DispatchResponse | undefined {
  return resultsMap.get(chatId);
}

export function clearSwitchResult(chatId: number): void {
  resultsMap.delete(chatId);
}

export async function runDispatchSearch(query: string): Promise<DispatchResponse> {
  const scriptPath = "/Users/iz/work/scripts/o-dispatch.py";
  logger.info(`[SwitchManager] Executing dispatch search for: "${query}"`);
  const { stdout } = await execFileAsync("python3", [scriptPath, "--json", query], {
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
  });

  const parsed = JSON.parse(stdout);
  return parsed as DispatchResponse;
}

export async function runDispatchPackageContext(
  sessionId: string,
  targetDir: string,
  source: string = "opencode",
  goal?: string | null,
): Promise<{ context_file: string; prompt: string }> {
  const scriptPath = "/Users/iz/work/scripts/o-dispatch.py";
  const args = [scriptPath, "--package-context", sessionId, targetDir, "--source", source];
  if (goal) {
    args.push("--goal", goal);
  }
  logger.info(`[SwitchManager] Packaging context for session=${sessionId} to ${targetDir}`);
  const { stdout } = await execFileAsync("python3", args, {
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return JSON.parse(stdout);
}
