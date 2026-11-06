/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sendMessage } from "@utils/discord";
import type { Channel, CloudUpload as TCloudUpload } from "@vencord/discord-types";
import { CloudUploadPlatform } from "@vencord/discord-types/enums";
import { findLazy } from "@webpack";
import { Constants, FluxDispatcher, MessageActions, PendingReplyStore, PermissionsBits, PermissionStore, RestAPI, showToast, SnowflakeUtils } from "@webpack/common";

import { Emote, fetchCdnFile, logger, sendCandidates } from "./api";
import { settings } from "./settings";

const CloudUpload: typeof TCloudUpload = findLazy(m => m.prototype?.trackUploadFinished);

// Upload limit without Nitro or server boosts
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type PendingReply = ReturnType<typeof PendingReplyStore.getPendingReply>;

function takePendingReply(channelId: string) {
    const reply = PendingReplyStore.getPendingReply(channelId);
    if (reply) FluxDispatcher.dispatch({ type: "DELETE_PENDING_REPLY", channelId });
    return reply;
}

function errorMessage(e: any): string {
    return e?.body?.message ?? e?.message ?? String(e);
}

function fileName(name: string, ext: string) {
    return `${name.replace(/[^\w.-]+/g, "_").slice(0, 64) || "emote"}.${ext}`;
}

async function downloadEmote(emote: Emote, urls: string[]): Promise<File> {
    let lastError: unknown = new Error("No file available");

    for (const url of urls) {
        try {
            const data = await fetchCdnFile(url);
            if (data.byteLength > MAX_UPLOAD_BYTES) {
                lastError = new Error("File is over 10 MB");
                continue;
            }
            const ext = new URL(url).pathname.split(".").pop()?.toLowerCase() || "gif";
            return new File([data], fileName(emote.name, ext), { type: `image/${ext}` });
        } catch (e) {
            lastError = e;
        }
    }

    throw lastError;
}

// Same flow as Vencord's VoiceMessages: upload to Discord's bucket, then post a message referencing it
function uploadAndSend(channelId: string, file: File, reply: PendingReply) {
    return new Promise<void>((resolve, reject) => {
        const upload = new CloudUpload({ file, isThumbnail: false, platform: CloudUploadPlatform.WEB }, channelId);

        upload.on("error", () => reject(new Error("Discord rejected the upload")));
        upload.on("complete", () => {
            RestAPI.post({
                url: Constants.Endpoints.MESSAGES(channelId),
                body: {
                    channel_id: channelId,
                    content: "",
                    nonce: SnowflakeUtils.fromTimestamp(Date.now()),
                    sticker_ids: [],
                    type: 0,
                    attachments: [{
                        id: "0",
                        filename: upload.filename,
                        uploaded_filename: upload.uploadedFilename,
                    }],
                    message_reference: reply ? MessageActions.getSendMessageOptionsForReply(reply)?.messageReference : null,
                },
            }).then(() => resolve(), reject);
        });

        upload.upload().catch(reject);
    });
}

function sendLink(channelId: string, url: string, reply: PendingReply) {
    return sendMessage(channelId, { content: url }, true, reply ? MessageActions.getSendMessageOptionsForReply(reply) : {});
}

export async function sendEmote(channel: Channel, emote: Emote) {
    const urls = sendCandidates(emote, settings.store.size);
    if (!urls.length) {
        showToast(`${emote.name} has no image to send`, "failure");
        return;
    }

    const isDm = channel.isPrivate();
    const canAttach = isDm || PermissionStore.can(PermissionsBits.ATTACH_FILES, channel);
    const canEmbed = isDm || PermissionStore.can(PermissionsBits.EMBED_LINKS, channel);
    const upload = settings.store.sendMode === "upload" ? canAttach : canAttach && !canEmbed;

    const reply = takePendingReply(channel.id);
    const slowToast = upload ? setTimeout(() => showToast(`Sending ${emote.name}…`, "clock"), 800) : undefined;

    try {
        if (upload) {
            const file = await downloadEmote(emote, urls).catch(e => {
                logger.warn(`Couldn't download ${emote.name}, sending its link instead`, e);
                return null;
            });

            if (file) {
                await uploadAndSend(channel.id, file, reply);
                return;
            }
        }

        await sendLink(channel.id, urls[0], reply);
    } catch (e) {
        logger.error(`Failed to send ${emote.name}`, e);
        showToast(`Couldn't send ${emote.name}: ${errorMessage(e)}`, "failure");
    } finally {
        clearTimeout(slowToast);
    }
}
