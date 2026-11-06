/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import type { Emote } from "./api";

export const settings = definePluginSettings({
    sendMode: {
        type: OptionType.SELECT,
        description: "How emotes are sent. If a channel doesn't allow the chosen method, the other one is used",
        options: [
            { label: "Upload as a GIF (animated) or PNG (static) file", value: "upload", default: true },
            { label: "Send the 7TV image link and let Discord embed it", value: "link" },
        ],
    },
    size: {
        type: OptionType.SELECT,
        description: "Size of sent emotes. Uploads drop to a smaller size if the file is over 10 MB",
        options: [
            { label: "1x", value: 1 },
            { label: "2x", value: 2 },
            { label: "3x", value: 3 },
            { label: "4x (largest)", value: 4, default: true },
        ],
    },
    closeOnSend: {
        type: OptionType.BOOLEAN,
        description: "Close the picker after sending. Shift+click an emote to do the opposite",
        default: true,
    },
    favorites: {
        type: OptionType.CUSTOM,
        default: [] as Emote[],
    },
});

// Settings values are proxies; store plain copies
function copyEmote(e: Emote): Emote {
    return {
        id: e.id,
        name: e.name,
        animated: e.animated,
        preview: e.preview,
        previewStatic: e.previewStatic,
        files: { ...e.files },
    };
}

export function toggleFavorite(emote: Emote) {
    const current: Emote[] = settings.plain.favorites ?? [];
    settings.store.favorites = current.some(f => f.id === emote.id)
        ? current.filter(f => f.id !== emote.id)
        : [copyEmote(emote), ...current];
}
