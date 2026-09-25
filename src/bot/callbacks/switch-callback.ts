import fs from "node:fs";
import os from "node:os";
import type { Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { setCurrentSession, type SessionInfo } from "../../app/services/session-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { switchToProject } from "../../app/services/project-switch-service.js";
import { createProjectSwitchPresentation } from "../services/project-switch-presentation.js";
import { selectSessionById } from "./session-callback-handler.js";
import { attachToSession } from "../../app/services/attach-service.js";
import { ingestSessionInfoForCache } from "../../app/services/session-cache-service.js";
import { processUserPrompt } from "../handlers/prompt.js";
import { createIncomingPrompt } from "../../app/types/prompt.js";
import {
  clearSwitchResult,
  clearSwitchWaiting,
  getSwitchResult,
  runDispatchPackageContext,
} from "../services/switch-manager.js";
import { logger } from "../../utils/logger.js";
import type { SwitchDeps } from "../commands/switch-command.js";

export async function handleSwitchCallback(ctx: Context, deps: SwitchDeps): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith("switch:")) {
    return false;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) {
    return false;
  }

  if (data === "switch:cancel_wait") {
    clearSwitchWaiting(chatId);
    await ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => {});
    await ctx.editMessageText("❌ Session switch cancelled.").catch(() => {});
    return true;
  }

  if (data === "switch:cancel") {
    clearSwitchResult(chatId);
    await ctx.answerCallbackQuery({ text: "Cancelled" }).catch(() => {});
    await ctx.editMessageText("❌ Session switch cancelled.").catch(() => {});
    return true;
  }

  const result = getSwitchResult(chatId);

  if (data === "switch:new") {
    const targetDir = result?.target_dir || os.homedir() + "/work/opencode-general";
    fs.mkdirSync(targetDir, { recursive: true });

    await ctx.answerCallbackQuery({ text: "Creating new session..." }).catch(() => {});

    try {
      if (getCurrentProject()?.worktree !== targetDir) {
        const project = { id: targetDir, worktree: targetDir, name: targetDir };
        await switchToProject(ctx, project, "switch_new_session_project", {
          ...deps,
          presentation: createProjectSwitchPresentation(deps),
        });
      }

      const { data: session, error } = await opencodeClient.session.create({
        directory: targetDir,
      });

      if (error || !session) {
        throw error || new Error("Failed to create session");
      }

      const sessionInfo: SessionInfo = {
        id: session.id,
        title: session.title,
        directory: targetDir,
      };
      setCurrentSession(sessionInfo);
      deps.resetInteractions("session_created_switch");
      await ingestSessionInfoForCache(session);

      await attachToSession({
        ...deps,
        chatId,
        session: sessionInfo,
      });

      try {
        await ctx.deleteMessage();
      } catch {}

      if (result?.intent?.session_goal) {
        await processUserPrompt(ctx, createIncomingPrompt(result.intent.session_goal), deps);
      } else {
        await ctx.reply(`✅ Created new session in \`${targetDir}\`: *${session.title}*`, {
          parse_mode: "Markdown",
        });
      }

      clearSwitchResult(chatId);
      return true;
    } catch (err) {
      logger.error("[SwitchCallback] Failed to create new session:", err);
      await ctx.reply("❌ Error creating new session.").catch(() => {});
      return true;
    }
  }

  if (data.startsWith("switch:cont:")) {
    const index = parseInt(data.slice("switch:cont:".length), 10);
    const candidate = result?.candidates?.[index];

    if (!candidate || !result) {
      await ctx
        .answerCallbackQuery({
          text: "Session search result expired. Please run /switch again.",
          show_alert: true,
        })
        .catch(() => {});
      return true;
    }

    await ctx.answerCallbackQuery({ text: `Switching to #${index + 1}...` }).catch(() => {});

    try {
      const directory = candidate.directory || result.target_dir;
      if (getCurrentProject()?.worktree !== directory) {
        const project = { id: candidate.session_id, worktree: directory, name: directory };
        await switchToProject(ctx, project, "switch_continue_project", {
          ...deps,
          presentation: createProjectSwitchPresentation(deps),
        });
      }

      await selectSessionById(ctx, deps, candidate.session_id, {
        source: "menu",
        deleteCallbackMessage: true,
        removeCallbackReplyMarkup: false,
        postSelectAction: "preview",
      });

      if (result.intent.session_goal) {
        await processUserPrompt(ctx, createIncomingPrompt(result.intent.session_goal), deps);
      }

      clearSwitchResult(chatId);
      return true;
    } catch (err) {
      logger.error("[SwitchCallback] Failed to continue session:", err);
      await ctx.reply("❌ Failed to switch to session.").catch(() => {});
      return true;
    }
  }

  if (data.startsWith("switch:fork:")) {
    const index = parseInt(data.slice("switch:fork:".length), 10);
    const candidate = result?.candidates?.[index];

    if (!candidate || !result) {
      await ctx
        .answerCallbackQuery({
          text: "Session search result expired. Please run /switch again.",
          show_alert: true,
        })
        .catch(() => {});
      return true;
    }

    await ctx.answerCallbackQuery({ text: "Packaging context and forking..." }).catch(() => {});

    const statusMsg = await ctx.reply("⏳ Summarizing context and creating fork...");
    const targetDir = result.target_dir;
    fs.mkdirSync(targetDir, { recursive: true });

    try {
      const { prompt } = await runDispatchPackageContext(
        candidate.session_id,
        targetDir,
        candidate.source,
        result.intent.session_goal,
      );

      if (getCurrentProject()?.worktree !== targetDir) {
        const project = { id: targetDir, worktree: targetDir, name: targetDir };
        await switchToProject(ctx, project, "switch_fork_project", {
          ...deps,
          presentation: createProjectSwitchPresentation(deps),
        });
      }

      const { data: session, error } = await opencodeClient.session.create({
        directory: targetDir,
      });

      if (error || !session) {
        throw error || new Error("Failed to create session for fork");
      }

      const sessionInfo: SessionInfo = {
        id: session.id,
        title: session.title,
        directory: targetDir,
      };
      setCurrentSession(sessionInfo);
      deps.resetInteractions("session_forked");
      await ingestSessionInfoForCache(session);

      await attachToSession({
        ...deps,
        chatId,
        session: sessionInfo,
      });

      await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
      try {
        await ctx.deleteMessage();
      } catch {}

      await processUserPrompt(ctx, createIncomingPrompt(prompt), deps);
      clearSwitchResult(chatId);
      return true;
    } catch (err) {
      logger.error("[SwitchCallback] Failed to fork session:", err);
      await ctx.api
        .editMessageText(chatId, statusMsg.message_id, "❌ Error creating session fork.")
        .catch(() => {});
      return true;
    }
  }

  return false;
}
