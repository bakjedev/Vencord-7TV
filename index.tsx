/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import definePlugin, { IconComponent } from "@utils/types";
import { openModal } from "@webpack/common";

import { PickerModal } from "./Picker";
import { settings } from "./settings";
import managedStyle from "./styles.css?managed";

const SevenTVIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg width={width} height={height} className={className} viewBox="0 0 24 24" aria-hidden="true">
        <path
            fill="currentColor"
            fillRule="evenodd"
            d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Zm0 2a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H7Zm2 3.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM7.5 13.5h9a4.5 4.5 0 0 1-9 0Z"
        />
    </svg>
);

const SevenTVButton: ChatBarButtonFactory = ({ channel, isAnyChat }) => {
    if (!isAnyChat) return null;

    return (
        <ChatBarButton
            tooltip="7TV emotes"
            onClick={() => openModal(props => <PickerModal modalProps={props} channel={channel} />)}
            buttonProps={{ "aria-haspopup": "dialog" }}
        >
            <SevenTVIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "SevenTVEmotes",
    description: "Search 7TV emotes, keep favorites, and send them as GIF/PNG images",
    authors: [{ name: "YourName", id: 0n }],
    tags: ["Emotes", "Chat"],
    settings,
    managedStyle,

    chatBarButton: {
        icon: SevenTVIcon,
        render: SevenTVButton,
    },
});
