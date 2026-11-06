/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ConnectSrc, CspPolicies, ImageSrc } from "@main/csp";
import { IpcMainInvokeEvent } from "electron";

// Discord desktop's CSP blocks unknown hosts. Allow 7TV's API (fetch fallback)
// and CDN (picker thumbnails need img-src).
CspPolicies["api.7tv.app"] = ConnectSrc;
CspPolicies["cdn.7tv.app"] = ImageSrc;

const GQL_URL = "https://api.7tv.app/v4/gql";
const CDN_ORIGIN = "https://cdn.7tv.app";

export async function gqlRequest(_: IpcMainInvokeEvent, body: string): Promise<{ status: number; body: string; }> {
    try {
        const res = await fetch(GQL_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body
        });
        return { status: res.status, body: await res.text() };
    } catch (e) {
        return { status: -1, body: String(e) };
    }
}

type FileResult = { status: number; data: Uint8Array<ArrayBuffer> | null; error: string | null; };

// Restricted to the 7TV CDN so this can't be abused as a generic fetch proxy
export async function fetchCdnFile(_: IpcMainInvokeEvent, url: string): Promise<FileResult> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return { status: -1, data: null, error: "Invalid URL" };
    }
    if (parsed.origin !== CDN_ORIGIN) return { status: -1, data: null, error: "Refusing to fetch a non-7TV URL" };

    try {
        const res = await fetch(parsed);
        if (new URL(res.url).origin !== CDN_ORIGIN) return { status: -1, data: null, error: "7TV CDN redirected off-site" };
        if (!res.ok) return { status: res.status, data: null, error: `HTTP ${res.status}` };
        return { status: res.status, data: new Uint8Array(await res.arrayBuffer()), error: null };
    } catch (e) {
        return { status: -1, data: null, error: String(e) };
    }
}
