/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import type { Channel, RenderModalProps } from "@vencord/discord-types";
import { Modal, showToast, useEffect, useMemo, useRef, useState } from "@webpack/common";
import type { ReactNode, UIEvent } from "react";

import { Emote, logger, searchEmotes, SortBy } from "./api";
import { sendEmote } from "./send";
import { settings, toggleFavorite } from "./settings";

const cl = classNameFactory("vc-7tv-");

const SORTS: { value: SortBy; label: string; }[] = [
    { value: "TOP_ALL_TIME", label: "Popular" },
    { value: "TRENDING_WEEKLY", label: "Trending" },
    { value: "UPLOAD_DATE", label: "New" },
];

type Tab = "search" | "favorites";

interface SearchState {
    query: string;
    sort: SortBy;
    emotes: Emote[];
    page: number;
    pageCount: number;
    loading: boolean;
    error: string | null;
}

const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        || document.documentElement.classList.contains("reduce-motion");
}

function useEmoteSearch(query: string, sort: SortBy, active: boolean) {
    const [state, setState] = useState<SearchState | null>(null);
    const stateRef = useRef(state);
    stateRef.current = state;

    const requestId = useRef(0);
    const inflight = useRef<{ query: string; sort: SortBy; } | null>(null);

    function load(q: string, s: SortBy, page: number) {
        const id = ++requestId.current;
        inflight.current = { query: q, sort: s };
        setState(prev => prev
            ? { ...prev, loading: true, error: null }
            : { query: q, sort: s, emotes: [], page: 0, pageCount: 0, loading: true, error: null });

        searchEmotes(q, s, page).then(
            res => {
                if (id !== requestId.current) return;
                inflight.current = null;
                setState(prev => {
                    const emotes = page === 1 ? res.emotes : [...(prev?.emotes ?? [])];
                    if (page !== 1) {
                        const seen = new Set(emotes.map(e => e.id));
                        for (const e of res.emotes) if (!seen.has(e.id)) emotes.push(e);
                    }
                    return { query: q, sort: s, emotes, page, pageCount: res.pageCount, loading: false, error: null };
                });
            },
            err => {
                if (id !== requestId.current) return;
                inflight.current = null;
                logger.error("7TV search failed", err);
                setState(prev => page === 1 || !prev
                    ? { query: q, sort: s, emotes: [], page: 0, pageCount: 0, loading: false, error: errorText(err) }
                    : { ...prev, loading: false, error: errorText(err) });
            }
        );
    }

    useEffect(() => {
        if (!active) return;

        const { current } = stateRef;
        if (current && current.query === query && current.sort === sort && !current.error) {
            // Already showing these results. Drop a request for a different query that's still running
            const { current: pending } = inflight;
            if (pending && (pending.query !== query || pending.sort !== sort)) {
                requestId.current++;
                inflight.current = null;
                setState(prev => prev && { ...prev, loading: false });
            }
            return;
        }

        const timer = setTimeout(() => load(query, sort, 1), current && query ? 300 : 0);
        return () => clearTimeout(timer);
    }, [query, sort, active]);

    return {
        state,
        loadMore() {
            const s = stateRef.current;
            if (!s || s.loading || s.error || s.page >= s.pageCount) return;
            load(s.query, s.sort, s.page + 1);
        },
        retry() {
            const s = stateRef.current;
            load(s?.query ?? query, s?.sort ?? sort, (s?.page ?? 0) + 1);
        },
    };
}

function StarIcon() {
    return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
        </svg>
    );
}

interface CellProps {
    emote: Emote;
    favorite: boolean;
    reduceMotion: boolean;
    onSend(emote: Emote, shift: boolean): void;
}

function EmoteCell({ emote, favorite, reduceMotion, onSend }: CellProps) {
    const [active, setActive] = useState(false);
    const [pop, setPop] = useState(false);
    const src = emote.animated && reduceMotion && !active ? emote.previewStatic : emote.preview;

    return (
        <div
            className={cl("cell")}
            onMouseEnter={() => setActive(true)}
            onMouseLeave={() => setActive(false)}
            onFocus={() => setActive(true)}
            onBlur={() => setActive(false)}
        >
            <button
                type="button"
                className={cl("emote")}
                title={emote.name}
                aria-label={`Send ${emote.name}`}
                onClick={e => onSend(emote, e.shiftKey)}
            >
                <img
                    className={cl("img")}
                    src={src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    onError={e => { e.currentTarget.style.visibility = "hidden"; }}
                />
                <span className={cl("name")}>{emote.name}</span>
            </button>
            <button
                type="button"
                className={cl("star", { "star-on": favorite, pop })}
                aria-pressed={favorite}
                aria-label={favorite ? `Remove ${emote.name} from favorites` : `Add ${emote.name} to favorites`}
                title={favorite ? "Remove from favorites" : "Add to favorites"}
                onClick={() => {
                    setPop(!favorite);
                    toggleFavorite(emote);
                }}
                onAnimationEnd={() => setPop(false)}
            >
                <StarIcon />
            </button>
        </div>
    );
}

function State({ children, error }: { children: ReactNode; error?: boolean; }) {
    return <div className={cl("state", { error })}>{children}</div>;
}

function PickerContent({ channel, onClose }: { channel: Channel; onClose(): void; }) {
    const { favorites } = settings.use(["favorites"]);
    const [tab, setTab] = useState<Tab>("search");
    const [input, setInput] = useState("");
    const [sort, setSort] = useState<SortBy>("TOP_ALL_TIME");
    const [cspBlocked, setCspBlocked] = useState(false);
    const [reduceMotion] = useState(prefersReducedMotion);
    const inputRef = useRef<HTMLInputElement>(null);
    const scrollerRef = useRef<HTMLDivElement>(null);

    const query = input.trim();
    const search = useEmoteSearch(query, sort, tab === "search");
    const results = search.state;

    const favoriteIds = useMemo(() => new Set(favorites.map(f => f.id)), [favorites]);
    const shownFavorites = useMemo(() => {
        const q = query.toLowerCase();
        return q ? favorites.filter(f => f.name.toLowerCase().includes(q)) : favorites;
    }, [favorites, query]);

    useEffect(() => {
        const frame = requestAnimationFrame(() => inputRef.current?.focus());
        const onViolation = (e: SecurityPolicyViolationEvent) => {
            if (e.blockedURI.includes("7tv.app")) setCspBlocked(true);
        };
        document.addEventListener("securitypolicyviolation", onViolation);

        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener("securitypolicyviolation", onViolation);
        };
    }, []);

    useEffect(() => {
        scrollerRef.current?.scrollTo({ top: 0 });
    }, [tab, results?.query, results?.sort]);

    function send(emote: Emote, shift: boolean) {
        void sendEmote(channel, emote);
        if (settings.store.closeOnSend !== shift) onClose();
    }

    async function sendFirst(shift: boolean) {
        if (tab === "favorites") {
            if (shownFavorites[0]) send(shownFavorites[0], shift);
            return;
        }

        if (results && results.query === query && results.sort === sort && results.emotes[0]) {
            send(results.emotes[0], shift);
            return;
        }

        try {
            const { emotes } = await searchEmotes(query, sort, 1);
            if (emotes[0]) send(emotes[0], shift);
            else showToast(`No 7TV emotes match "${query}"`, "failure");
        } catch (e) {
            showToast(`Couldn't search 7TV: ${errorText(e)}`, "failure");
        }
    }

    function onScroll(e: UIEvent<HTMLDivElement>) {
        if (tab !== "search") return;
        const el = e.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) search.loadMore();
    }

    // Results on screen don't match the search box yet (debouncing or loading)
    const stale = tab === "search" && results != null && (results.query !== query || results.sort !== sort);

    const renderGrid = (emotes: Emote[], favoritesTab: boolean) => (
        <div className={cl("grid", { "grid-stale": stale, "grid-favs": favoritesTab })}>
            {emotes.map(e => (
                <EmoteCell
                    key={e.id}
                    emote={e}
                    favorite={favoriteIds.has(e.id)}
                    reduceMotion={reduceMotion}
                    onSend={send}
                />
            ))}
        </div>
    );

    let body: ReactNode;
    if (tab === "favorites") {
        body = shownFavorites.length
            ? renderGrid(shownFavorites, true)
            : <State>{favorites.length ? `No favorites match "${query}".` : "No favorites yet. Star an emote in Search and it shows up here."}</State>;
    } else if (!results || (results.loading && !results.emotes.length && !results.error)) {
        body = <State>Loading emotes…</State>;
    } else if (results.error && !results.emotes.length) {
        body = (
            <State error>
                <p>Couldn't load emotes: {results.error}</p>
                <Button variant="secondary" size="small" onClick={search.retry}>Retry</Button>
            </State>
        );
    } else if (!results.emotes.length) {
        body = <State>{stale ? "Searching…" : results.query ? `No 7TV emotes match "${results.query}". Check the spelling or try fewer letters.` : "7TV returned no emotes."}</State>;
    } else {
        body = (
            <>
                {renderGrid(results.emotes, false)}
                {results.loading && <p className={cl("more")}>Loading more…</p>}
                {results.error && (
                    <div className={cl("more", "error")}>
                        <p>Couldn't load more: {results.error}</p>
                        <Button variant="secondary" size="small" onClick={search.retry}>Retry</Button>
                    </div>
                )}
            </>
        );
    }

    return (
        <div className={cl("picker")}>
            <input
                ref={inputRef}
                className={cl("search")}
                type="text"
                placeholder={tab === "search" ? "Search 7TV emotes" : "Filter favorites"}
                aria-label={tab === "search" ? "Search 7TV emotes" : "Filter favorites"}
                value={input}
                spellCheck={false}
                autoComplete="off"
                onChange={e => setInput(e.currentTarget.value)}
                onKeyDown={e => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    void sendFirst(e.shiftKey);
                }}
            />

            <div className={cl("bar")}>
                <div className={cl("tabs")} role="tablist" aria-label="Emote source">
                    <button type="button" role="tab" className={cl("tab")} aria-selected={tab === "search"} onClick={() => setTab("search")}>
                        Search
                    </button>
                    <button type="button" role="tab" className={cl("tab")} aria-selected={tab === "favorites"} onClick={() => setTab("favorites")}>
                        Favorites <span className={cl("count")}>{favorites.length}</span>
                    </button>
                </div>

                {tab === "search" && (
                    <div className={cl("sorts")} role="radiogroup" aria-label="Sort results">
                        {SORTS.map(o => (
                            <button
                                key={o.value}
                                type="button"
                                role="radio"
                                className={cl("chip")}
                                aria-checked={sort === o.value}
                                onClick={() => setSort(o.value)}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {cspBlocked && (
                <p className={cl("notice")}>
                    Discord's security policy is blocking 7TV. Quit Discord completely and reopen it so the plugin's network permissions load.
                </p>
            )}

            <div ref={scrollerRef} className={cl("scroller")} onScroll={onScroll} aria-busy={stale || !!results?.loading}>
                {body}
            </div>

            <p className={cl("hint")}>
                {settings.store.closeOnSend
                    ? "Click to send, Shift+click to keep this open. Enter sends the first result."
                    : "Click to send, Shift+click to send and close. Enter sends the first result."}
            </p>
        </div>
    );
}

export function PickerModal({ modalProps, channel }: { modalProps: RenderModalProps; channel: Channel; }) {
    return (
        <Modal {...modalProps} size="md" title="7TV emotes">
            <ErrorBoundary>
                <PickerContent channel={channel} onClose={modalProps.onClose} />
            </ErrorBoundary>
        </Modal>
    );
}
