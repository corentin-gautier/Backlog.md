import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { remarkGFMPlugin } from '@milkdown/kit/preset/gfm';

// Keeps the file as people write it: "-" lists, tables without padded columns and with "---"
// under the header, bare links and email addresses (GFM autolinks) rather than <…>.
const tidy = (markdown: string) =>
	markdown
		.replace(/<(https?:\/\/[^\s<>]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)>/g, '$1')
		.replace(/^\|(?: *:?-+:? *\|)+ *$/gm, (row) => row.replace(/(:?)-+(:?)/g, '$1---$2'));

// A document edited where it is shown (Milkdown Crepe): text formatted on selection, "/" to insert
// a block, Markdown shortcuts, editable tables. `value` is read once, when the editor mounts: give
// it a new `key` to load other content. `onChange` gets the Markdown after each edit. `children`
// (the rendered document) show until the editor is ready, and stay if it cannot start.
const DocEditor = memo(function DocEditor({
	value,
	onChange,
	children,
}: {
	value: string;
	onChange: (markdown: string) => void;
	children?: ReactNode;
}) {
	const [ready, setReady] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const changed = useRef(onChange);
	changed.current = onChange;

	useEffect(() => {
		if (!root.current) return;
		const crepe = new Crepe({
			root: root.current,
			defaultValue: value,
			features: {
				[CrepeFeature.ImageBlock]: false, // its upload would put blob: URLs in the file
				[CrepeFeature.Latex]: false,
			},
			featureConfigs: {
				[CrepeFeature.Placeholder]: { text: 'Write, or type / for a block…', mode: 'doc' },
			},
		});
		crepe.editor.config((ctx) => {
			ctx.update(remarkGFMPlugin.options.key, (options) => ({ ...options, tablePipeAlign: false }));
			ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: '-' as const, rule: '-' as const }));
		});
		crepe.on((listener) => {
			listener.markdownUpdated((_ctx, markdown, previous) => {
				if (markdown !== previous) changed.current(tidy(markdown));
			});
		});
		let created = false;
		const creating = crepe.create().then(
			() => {
				created = true;
				setReady(true);
			},
			(error) => console.error('The document editor could not start:', error),
		);
		return () => {
			void creating.then(() => {
				if (created) void crepe.destroy();
			});
		};
	}, []);

	return (
		<>
			{!ready && children}
			<div ref={root} className="doc-editor" hidden={!ready} />
		</>
	);
});

export default DocEditor;
