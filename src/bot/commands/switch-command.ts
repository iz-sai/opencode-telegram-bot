import type { Bot, CommandContext, Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { replyWithInlineMenu } from "../menus/inline-menu.js";
import { buildSwitchPromptKeyboard, buildSwitchResultsMenu } from "../menus/switch-menu.js";
import {
  clearSwitchWaiting,
  runDispatchSearch,
  startSwitchWaiting,
  storeSwitchResult,
} from "../services/switch-manager.js";
import { logger } from "../../utils/logger.js";
import { isForegroundBusy } from "../../app/services/run-control-service.js";
import { replyBusyBlocked } from "../messages/busy-blocked-renderer.js";

export type SwitchDeps = AppContainer & {
  bot: Bot<Context>;
};

export async function handleSwitchQuery(
  ctx: Context,
  deps: SwitchDeps,
  query: string,
  existingStatusMessageId?: number,
): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) {
    await ctx.reply("⚠️ Query cannot be empty. Please try /switch again.");
    return;
  }

  let statusMsgId = existingStatusMessageId;
  if (!statusMsgId) {
    const sent = await ctx.reply("🔍 Searching sessions across OpenCode, ChatGPT, and Claude...");
    statusMsgId = sent.message_id;
  }

  try {
    const result = await runDispatchSearch(trimmed);
    if (ctx.chat) {
      storeSwitchResult(ctx.chat.id, result);
    }

    const { text, keyboard } = buildSwitchResultsMenu(result);

    if (ctx.chat && statusMsgId) {
      await ctx.api.deleteMessage(ctx.chat.id, statusMsgId).catch(() => {});
    }

    await replyWithInlineMenu(
      ctx,
      {
        menuKind: "switch",
        text,
        keyboard,
        parseMode: "Markdown",
      },
      deps,
    );
  } catch (error) {
    logger.error("[SwitchCommand] Error running dispatch search:", error);
    if (ctx.chat && statusMsgId) {
      await ctx.api
        .editMessageText(ctx.chat.id, statusMsgId, "❌ Failed to search sessions. Please try again.")
        .catch(() => {});
    } else {
      await ctx.reply("❌ Failed to search sessions. Please try again.");
    }
  }
}

export async function switchCommand(ctx: CommandContext<Context>, deps: SwitchDeps): Promise<void> {
  if (isForegroundBusy(deps)) {
    await replyBusyBlocked(ctx);
    return;
  }

  const query = ctx.match?.trim();
  if (query) {
    clearSwitchWaiting(ctx.chat.id);
    await handleSwitchQuery(ctx, deps, query);
    return;
  }

  startSwitchWaiting(ctx.chat.id);
  await ctx.reply(
    "Where to switch? Send voice or text with your request (or cancel below):",
    {
      reply_markup: buildSwitchPromptKeyboard(),
    },
  );
}
