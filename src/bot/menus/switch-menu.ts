import { InlineKeyboard } from "grammy";
import type { DispatchResponse } from "../services/switch-manager.js";

export const SWITCH_CALLBACK_PREFIX = "switch:";

export function buildSwitchPromptKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("❌ Cancel", `${SWITCH_CALLBACK_PREFIX}cancel_wait`);
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

export function buildSwitchResultsMenu(result: DispatchResponse): { text: string; keyboard: InlineKeyboard } {
  const keyboard = new InlineKeyboard();

  let text = `🔍 *Session Search Results*\n\n`;
  text += `*Query:* ${escapeMarkdown(result.utterance)}\n`;
  text += `*Action:* \`${result.intent.action}\` (confidence: ${result.intent.confidence})\n`;
  if (result.intent.session_goal) {
    text += `*Goal:* ${escapeMarkdown(result.intent.session_goal)}\n`;
  }
  text += `*Target Dir:* \`${result.target_dir}\`\n\n`;

  if (!result.candidates || result.candidates.length === 0) {
    text += `_No matching sessions found across OpenCode, ChatGPT, or Claude._\n`;
    keyboard.text("➕ New session", `${SWITCH_CALLBACK_PREFIX}new`).row();
    return { text, keyboard };
  }

  const topCandidates = result.candidates.slice(0, 5);
  topCandidates.forEach((cand, index) => {
    const src = cand.source.toUpperCase();
    const costStr = cand.cost > 0 ? ` • $${cand.cost.toFixed(2)}` : "";
    const tokStr = cand.token_count > 0 ? ` • ${Math.round(cand.token_count / 1000)}k tok` : "";
    text += `*${index + 1}. [${src}]* ${escapeMarkdown(cand.title)}\n`;
    text += `📅 ${cand.date}${tokStr}${costStr}\n`;
    if (cand.directory) {
      text += `📁 \`${cand.directory}\`\n`;
    }
    text += `\n`;

    if (cand.source === "opencode") {
      keyboard
        .text(`▶️ Continue #${index + 1}`, `${SWITCH_CALLBACK_PREFIX}cont:${index}`)
        .text(`🍴 Fork #${index + 1}`, `${SWITCH_CALLBACK_PREFIX}fork:${index}`)
        .row();
    } else {
      keyboard
        .text(`🍴 Fork #${index + 1} (${src})`, `${SWITCH_CALLBACK_PREFIX}fork:${index}`)
        .row();
    }
  });

  keyboard.text("➕ New session", `${SWITCH_CALLBACK_PREFIX}new`).row();

  return { text, keyboard };
}
