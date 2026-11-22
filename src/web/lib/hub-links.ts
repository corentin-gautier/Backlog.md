// Inside Backlog Hub (https://github.com/corentin-gautier/backlog-hub) the board is a pane of the hub.
// A link to another site opens in the browser (a new tab, or the default browser in the desktop app)
// instead of replacing the board. A link within the board that asks for a new window (the editor's
// link preview has target="_blank", or Cmd-click) opens in the board instead: a new window would
// replace the hub in the desktop app. Outside the hub, links are untouched.
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
			if (!/^https?:$/.test(url.protocol)) return;
			if (url.origin !== location.origin) {
				event.preventDefault();
				window.open(url.href, "_blank", "noopener");
				return;
			}
			const newWindow = link.target === "_blank" || event.metaKey || event.ctrlKey || event.shiftKey;
			if (!newWindow) return;
			event.preventDefault();
			event.stopPropagation();
			// The router follows history changes made outside it through popstate.
			history.pushState(null, "", url.pathname + url.search + url.hash);
			window.dispatchEvent(new PopStateEvent("popstate"));
		},
		true,
	);
}
