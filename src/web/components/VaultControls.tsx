// Encryption controls of a doc page, inside Backlog Hub (see lib/hub-vault.ts): the header button
// (Encrypt / Encrypted / Locks in N min, with its menu) and the card shown instead of a locked body.
import { useEffect, useRef, useState } from "react";
import { type VaultState, vault, vaultDoc } from "../lib/hub-vault";
import { quietButton } from "./RecordHeader";

const Padlock = ({ open, className = "w-4 h-4" }: { open?: boolean; className?: string }) => (
	<svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
		<path d={open ? "M4.5 7.5V5.5a3.5 3.5 0 0 1 6.8-1.2" : "M4.5 7.5V5.5a3.5 3.5 0 0 1 7 0v2"} />
		<rect x="3" y="7.5" width="10" height="6.5" rx="1.5" />
	</svg>
);
export { Padlock };

// The header's button size (RecordHeader); Encrypted and Unlocked keep a coloured outline.
const button = "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 disabled:opacity-50";
const minutes = (until: number) => Math.max(1, Math.round((until - Date.now()) / 60_000));

// beforeLock: saves what is waiting, so the doc is not written after it is encrypted.
export function VaultButton({ state, docId, beforeLock }: { state: VaultState | null; docId?: string; beforeLock: () => Promise<void> }) {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const doc = vaultDoc(state, docId);
	useEffect(() => {
		if (!open) return;
		const close = (event: Event) => {
			if (event instanceof KeyboardEvent ? event.key === "Escape" : !box.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("pointerdown", close);
		document.addEventListener("keydown", close);
		return () => {
			document.removeEventListener("pointerdown", close);
			document.removeEventListener("keydown", close);
		};
	}, [open]);
	if (!state || !doc || !docId) return null;

	const run = async (action: "mark" | "unmark" | "unlock" | "lock") => {
		setOpen(false);
		setBusy(true);
		if (action === "mark" || action === "lock") await beforeLock();
		await vault(action, docId);
		setBusy(false);
	};

	if (!doc.marked) {
		return (
			<button className={quietButton} disabled={busy} onClick={() => void run("mark")} title="Keep this doc encrypted on disk, unlocked with Touch ID">
				<Padlock open /> Encrypt
			</button>
		);
	}
	if (doc.locked) {
		return (
			<button className={`${button} border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300`} disabled={busy} onClick={() => void run("unlock")} title="Unlock with Touch ID">
				<Padlock /> Encrypted
			</button>
		);
	}
	return (
		<div className="relative" ref={box}>
			<button className={`${button} border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300`} disabled={busy} onClick={() => setOpen(!open)}>
				<Padlock open /> {state.until ? `Locks in ${minutes(state.until)} min` : "Unlocked"}
			</button>
			{open && (
				<div className="absolute right-0 top-full mt-1.5 z-20 w-72 p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg text-sm">
					<p className="mx-2.5 mt-1.5 mb-2 text-xs text-gray-500 dark:text-gray-400">
						Encrypted on disk. Every encrypted doc of this project locks again{state.until ? ` in ${minutes(state.until)} min` : " soon"}.
					</p>
					<button className="block w-full text-left px-2.5 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200" onClick={() => void run("lock")}>Lock now</button>
					<button className="block w-full text-left px-2.5 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-red-700 dark:text-red-400" onClick={() => void run("unmark")}>Stop encrypting this doc</button>
				</div>
			)}
		</div>
	);
}

// In place of a body encrypted on disk: unlock with Touch ID (inside the hub), else where to do it.
export function LockedDoc({ state, docId }: { state: VaultState | null; docId?: string }) {
	const [busy, setBusy] = useState(false);
	const count = state?.docs.filter((d) => d.marked && d.locked).length || 1;
	const canUnlock = Boolean(state && docId);
	return (
		<div className="mx-auto my-6 max-w-md w-full text-center rounded-xl border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-6">
			<Padlock className="w-7 h-7 mx-auto text-amber-700 dark:text-amber-400" />
			<div className="mt-2 mb-1 font-semibold text-gray-900 dark:text-gray-100">This doc is encrypted</div>
			<div className="mb-4 text-sm text-gray-500 dark:text-gray-400">
				{canUnlock
					? `Unlocks the ${count === 1 ? "encrypted doc" : `${count} encrypted docs`} of this project for 5 minutes.`
					: "Open this board in Backlog Hub to unlock it."}
			</div>
			{canUnlock && (
				<button
					className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
					disabled={busy}
					onClick={async () => {
						setBusy(true);
						await vault("unlock", docId);
						setBusy(false);
					}}
				>
					{busy ? "Waiting for Touch ID…" : "Unlock with Touch ID"}
				</button>
			)}
			{state?.error && <div className="mt-3 text-sm text-red-600 dark:text-red-400">{state.error}</div>}
		</div>
	);
}
