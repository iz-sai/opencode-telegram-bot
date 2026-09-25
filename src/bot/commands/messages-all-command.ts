import { InputFile, type CommandContext, type Context } from "grammy";
import type { AppContainer } from "../../app/bootstrap/app-container.js";
import { getCurrentSession } from "../../app/services/session-service.js";
import { getCurrentProject } from "../../app/stores/settings-store.js";
import { opencodeClient } from "../../opencode/client.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";
import { sendMessageWithMarkdownFallback } from "../messages/send-with-markdown-fallback.js";

export type MessagesAllCommandDeps = Pick<
  AppContainer,
  "interactionManager"
>;

export async function messagesAllCommand(
  ctx: CommandContext<Context>,
  _deps?: MessagesAllCommandDeps,
): Promise<void> {
  try {
    const currentProject = getCurrentProject();
    if (!currentProject) {
      await ctx.reply(t("messages.project_not_selected"));
      return;
    }

    const currentSession = getCurrentSession();
    if (!currentSession) {
      await ctx.reply(t("messages.session_not_selected"));
      return;
    }

    const { data, error } = await opencodeClient.session.messages({
      sessionID: currentSession.id,
      directory: currentSession.directory,
    });

    if (error || !data) {
      throw error || new Error("No message data received");
    }

    const lines: string[] = [
      `# Session: ${currentSession.title} (${currentSession.id})`,
      `**Project:** \`${currentSession.directory}\``,
      `**Exported:** ${new Date().toISOString()}`,
      "",
      "---",
      "",
    ];

    let count = 0;
    for (const msg of data as any[]) {
      const role = (msg.info?.role || "unknown").toUpperCase();
      const timeStr = msg.info?.time?.created
        ? new Date(msg.info.time.created).toLocaleTimeString()
        : "";
      const textParts = (msg.parts || [])
        .filter((p: any) => typeof p.text === "string" && p.text.trim())
        .map((p: any) => p.text.trim())
        .join("\n\n");

      if (textParts) {
        count++;
        lines.push(`### ${role}${timeStr ? ` (${timeStr})` : ""}`);
        lines.push("");
        lines.push(textParts);
        lines.push("");
        lines.push("---");
        lines.push("");
      }
    }

    if (count === 0) {
      await ctx.reply(t("messages.empty"));
      return;
    }

    const fullMarkdown = lines.join("\n").trim();

    if (fullMarkdown.length < 4000) {
      if (ctx.chat) {
        await sendMessageWithMarkdownFallback({
          api: ctx.api,
          chatId: ctx.chat.id,
          text: fullMarkdown,
          rawFallbackText: fullMarkdown,
        });
      } else {
        await ctx.reply(fullMarkdown);
      }
    } else {
      const buffer = Buffer.from(fullMarkdown, "utf-8");
      const safeTitle =
        currentSession.title.replace(/[^\w\s-]/g, "").slice(0, 30).trim() || "session";
      const filename = `${safeTitle}_${currentSession.id}.md`;
      await ctx.replyWithDocument(new InputFile(buffer, filename), {
        caption: `📄 Complete history for session: ${currentSession.title} (${count} turns)`,
      });
    }
  } catch (error) {
    logger.error("[MessagesAll] Error fetching full messages history:", error);
    await ctx.reply("❌ Failed to fetch complete session history.");
  }
}
