// Encrypted docs, when the board runs inside Backlog Hub (https://github.com/corentin-gautier/backlog-hub):
// the hub encrypts marked docs on disk and unlocks them with Touch ID. The board asks it through
// postMessage and only listens to its parent window. Outside the hub there is no parent and no state.
import { useSyncExternalStore } from "react";

export type VaultDoc = { id: string; marked: boolean; locked: boolean };
export type VaultState = { docs: VaultDoc[]; until: number | null; error?: string };
export type VaultAction = "status" | "mark" | "unmark" | "unlock" | "lock";

// Whether a doc's text is encrypted: the marker alone on its line with its base64 payload, in place
// of the body. A doc that only quotes the marker (the format's own doc) is not encrypted.
export const isVaultLocked = (text: string) => /^<!-- backlogs-vault v1 [A-Za-z0-9+/]{40,}={0,2} -->$/m.test(text);

const embedded = typeof window !== "undefined" && window.parent !== window;
let state: VaultState | null = null;
const listeners = new Set<() => void>();
const waiting = new Map<number, (state: VaultState | null) => void>();
let seq = 0;

if (embedded) {
	window.addEventListener("message", (event) => {
		const data = event.data;
		if (event.source !== window.parent || data?.backlogHub !== "vault") return;
		const next = data.state as VaultState;
		// An error keeps the docs known before it.
		state = next.error ? { docs: state?.docs || [], until: state?.until ?? null, error: next.error } : next;
		for (const listener of listeners) listener();
		waiting.get(data.seq)?.(state);
		waiting.delete(data.seq);
	});
	void vault("status");
	setInterval(() => void vault("status"), 30_000);
}

// Sends an action for a doc (its id) and resolves with the project's state, or null outside the hub.
export function vault(action: VaultAction, id?: string): Promise<VaultState | null> {
	if (!embedded) return Promise.resolve(null);
	const n = ++seq;
	window.parent.postMessage({ backlogHub: "vault", seq: n, do: action, id }, "*");
	// Touch ID waits for the user; anything else answers at once.
	const wait = action === "unlock" || action === "unmark" ? 120_000 : 5_000;
	return new Promise((resolve) => {
		waiting.set(n, resolve);
		setTimeout(() => waiting.delete(n) && resolve(null), wait);
	});
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

// The project's state, null outside the hub (until it first answers).
export function useVault(): VaultState | null {
	return useSyncExternalStore(
		subscribe,
		() => state,
		() => null,
	);
}

export function vaultDoc(state: VaultState | null, id: string | undefined): VaultDoc | undefined {
	return id ? state?.docs.find((d) => d.id === id.toLowerCase()) : undefined;
}
