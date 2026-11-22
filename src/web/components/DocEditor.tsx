import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import { commandsCtx, editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import type { Ctx } from '@milkdown/kit/ctx';
import { headingSchema, paragraphSchema, setBlockTypeCommand } from '@milkdown/kit/preset/commonmark';
import { remarkGFMPlugin } from '@milkdown/kit/preset/gfm';

// Keeps the file as people write it: "-" lists, tables without padded columns and with "---"
// under the header, bare links and email addresses (GFM autolinks) rather than <…>.
const tidy = (markdown: string) =>
	markdown
		.replace(/<(https?:\/\/[^\s<>]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)>/g, '$1')
		.replace(/^\|(?: *:?-+:? *\|)+ *$/gm, (row) => row.replace(/(:?)-+(:?)/g, '$1---$2'));

// Crepe's own text and heading icons (not exported by the package).
const icon = (d: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const frame = 'M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19Z';
const BLOCKS = [
	{ key: 'text', label: 'Text', level: 0, icon: icon('M5 5.5C5 6.33 5.67 7 6.5 7H10.5V17.5C10.5 18.33 11.17 19 12 19C12.83 19 13.5 18.33 13.5 17.5V7H17.5C18.33 7 19 6.33 19 5.5C19 4.67 18.33 4 17.5 4H6.5C5.67 4 5 4.67 5 5.5Z') },
	{ key: 'h1', label: 'Heading 1', level: 1, icon: icon(`${frame}M12 17H14V7H10V9H12V17Z`) },
	{ key: 'h2', label: 'Heading 2', level: 2, icon: icon(`${frame}M15 15H11V13H13C14.1 13 15 12.11 15 11V9C15 7.89 14.1 7 13 7H9V9H13V11H11C9.9 11 9 11.89 9 13V17H15V15Z`) },
	{ key: 'h3', label: 'Heading 3', level: 3, icon: icon(`${frame}M15 15V13.5C15 12.67 14.33 12 13.5 12C14.33 12 15 11.33 15 10.5V9C15 7.89 14.1 7 13 7H9V9H13V11H11V13H13V15H9V17H13C14.1 17 15 16.11 15 15Z`) },
];
// The level of the block holding the selection: 0 for a paragraph, null for anything else.
const levelAt = (ctx: Ctx) => {
	const block = ctx.get(editorViewCtx).state.selection.$from.parent;
	return block.type.name === 'heading' ? (block.attrs.level as number) : block.type.name === 'paragraph' ? 0 : null;
};

// A document edited where it is shown (Milkdown Crepe): text formatted on selection, "/" to insert
// a block, Markdown shortcuts, editable tables. The selection toolbar also sets the block's level
// (text, heading 1 to 3). The block handle (+ and drag) is hidden in source.css: "/" does it all. `value` is read once, when the editor mounts: give
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
				[CrepeFeature.Toolbar]: {
					buildToolbar: (builder) => {
						const group = builder.addGroup('block', 'Block');
						for (const block of BLOCKS)
							group.addItem(block.key, {
								label: block.label,
								icon: block.icon,
								active: (ctx) => levelAt(ctx) === block.level,
								onRun: (ctx) =>
									ctx.get(commandsCtx).call(setBlockTypeCommand.key, block.level
										? { nodeType: headingSchema.type(ctx), attrs: { level: block.level } }
										: { nodeType: paragraphSchema.type(ctx) }),
							});
					},
				},
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
