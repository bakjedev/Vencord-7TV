/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { PluginNative } from "@utils/types";

export const logger = new Logger("SevenTVEmotes");

// Undefined on web builds, where plugins have no native side
const Native = VencordNative.pluginHelpers.SevenTVEmotes as PluginNative<typeof import("./native")> | undefined;

const GQL_URL = "https://api.7tv.app/v4/gql";
const PER_PAGE = 72;

export type SortBy = "TOP_ALL_TIME" | "TRENDING_WEEKLY" | "UPLOAD_DATE";

export interface Emote {
    id: string;
    name: string;
    animated: boolean;
    /** Picker thumbnail, animated if the emote is */
    preview: string;
    /** First-frame thumbnail, used when reduced motion is on */
    previewStatic: string;
    /** Scale (1-4) to the URL that gets sent: GIF for animated emotes, PNG for static ones */
    files: Record<number, string>;
}

interface ApiImage {
    url: string;
    mime: string;
    scale: number;
    frameCount: number;
}

interface ApiEmote {
    id: string;
    defaultName: string;
    deleted: boolean;
    images: ApiImage[];
}

// Same search call 7tv.app makes for its own emote directory
const SEARCH_QUERY = `query SearchEmotes($query: String, $tags: [String!]!, $sortBy: SortBy!, $filters: Filters, $page: Int, $perPage: Int!) {
    emotes {
        search(query: $query, tags: { tags: $tags, match: ANY }, sort: { sortBy: $sortBy, order: DESCENDING }, filters: $filters, page: $page, perPage: $perPage) {
            items {
                id
                defaultName
                deleted
                images { url mime scale frameCount }
            }
            pageCount
        }
    }
}`;

async function postGql(body: string): Promise<{ status: number; body: string; }> {
    if (Native) return Native.gqlRequest(body);

    // Web: the Vencord extension strips Discord's CSP, so this only depends on 7TV's CORS headers
    try {
        const res = await fetch(GQL_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        return { status: res.status, body: await res.text() };
    } catch (e) {
        return { status: -1, body: String(e) };
    }
}

export async function searchEmotes(query: string, sortBy: SortBy, page: number) {
    const res = await postGql(JSON.stringify({
        operationName: "SearchEmotes",
        query: SEARCH_QUERY,
        variables: { query: query || null, tags: [], sortBy, filters: {}, page, perPage: PER_PAGE },
    }));

    if (res.status === -1) {
        logger.error("7TV request failed:", res.body);
        throw new Error("Couldn't reach 7TV");
    }

    let json: any;
    try {
        json = JSON.parse(res.body);
    } catch {
        throw new Error(`7TV responded with HTTP ${res.status}`);
    }

    if (json.errors?.length) throw new Error(json.errors[0]?.message ?? "7TV returned an error");

    const result = json.data?.emotes?.search as { items: ApiEmote[]; pageCount: number; } | undefined;
    if (!result) throw new Error(`7TV responded with HTTP ${res.status}`);

    return {
        emotes: result.items.map(toEmote).filter((e): e is Emote => e != null),
        pageCount: result.pageCount,
    };
}

function variants(images: ApiImage[], mime: string, animated: boolean) {
    return images
        .filter(i => i.mime === mime && (i.frameCount > 1) === animated)
        .sort((a, b) => a.scale - b.scale);
}

/** Largest variant at or below `scale`, otherwise the smallest available */
function closest(list: ApiImage[], scale: number): ApiImage | undefined {
    let best: ApiImage | undefined;
    for (const img of list) if (img.scale <= scale) best = img;
    return best ?? list[0];
}

function toEmote({ id, defaultName, deleted, images }: ApiEmote): Emote | null {
    if (deleted || !images?.length) return null;

    // 7TV also ships static renditions of animated emotes, so check frame counts instead of flags
    const animated = images.some(i => i.frameCount > 1);
    const webp = variants(images, "image/webp", animated);
    let files = variants(images, animated ? "image/gif" : "image/png", animated);
    if (!files.length) files = webp;

    const preview = closest(webp, 2) ?? closest(files, 2);
    if (!preview || !files.length) return null;

    const previewStatic = animated
        ? closest(variants(images, "image/webp", false), 2) ?? preview
        : preview;

    return {
        id,
        name: defaultName,
        animated,
        preview: preview.url,
        previewStatic: previewStatic.url,
        files: Object.fromEntries(files.map(i => [i.scale, i.url])),
    };
}

/** URLs to try when sending: the configured size first, then smaller ones */
export function sendCandidates(emote: Emote, size: number): string[] {
    const scales = Object.keys(emote.files).map(Number).sort((a, b) => b - a);
    const fitting = scales.filter(s => s <= size);
    return (fitting.length ? fitting : scales.slice(-1)).map(s => emote.files[s]);
}

export async function fetchCdnFile(url: string): Promise<Uint8Array<ArrayBuffer>> {
    if (Native) {
        const res = await Native.fetchCdnFile(url);
        if (!res.data) throw new Error(res.error ?? `HTTP ${res.status}`);
        return res.data;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
}
