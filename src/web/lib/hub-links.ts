// Inside Backlog Hub (https://github.com/corentin-gautier/backlog-hub) the board is a pane of the hub:
// a link to another site opens in the browser (a new tab, or the default browser in the desktop app)
// instead of replacing the board. Links within the board, and anything outside the hub, are untouched.
const embedded = typeof window !== "undefined" && window.parent !== window;

if (embedded) {
	// Capture phase: the task modal stops clicks from bubbling up to the document.
	document.addEventListener(
		"click",
		(event) => {
			if (event.button !== 0) return;
			const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
			if (!link || link.hasAttribute("download")) return;
			const url = new URL(link.href, location.href);
			if (!/^https?:$/.test(url.protocol) || url.origin === location.origin) return;
			event.preventDefault();
			window.open(url.href, "_blank", "noopener");
		},
		true,
	);
}
