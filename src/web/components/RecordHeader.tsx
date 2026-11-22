import { Children, type ReactNode } from "react";

// The header of a doc or decision page: the title with its actions on one line, then the
// metadata on a small line below. Aligned with the content below it (same 2rem side padding).

const quietBase =
	"quiet inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500";
/** A header button: no border, a light background on hover. */
export const quietButton = `${quietBase} text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100`;
/** The same for a destructive action: red on hover only. */
export const quietDangerButton = `${quietBase} text-gray-600 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400`;
/** A small blue button, for Save. */
export const primaryButton =
	"inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:text-gray-500 dark:disabled:text-gray-400 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors duration-200";
export const titleClass = "text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100";

/** A thin line between groups of header buttons. */
export const ButtonDivider = () => <span className="w-px h-4 mx-1.5 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />;

/** The record's id, as shown in the metadata line. */
export const RecordId = ({ id }: { id: ReactNode }) => (
	<code className="px-1.5 py-px rounded bg-gray-100 dark:bg-gray-800 font-mono text-xs text-gray-600 dark:text-gray-300">{id}</code>
);

export function RecordHeader({ title, actions, meta, children }: { title: ReactNode; actions?: ReactNode; meta: ReactNode[]; children?: ReactNode }) {
	const items = Children.toArray(meta.filter(Boolean));
	return (
		<div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 transition-colors duration-200">
			<div className="px-8 py-5">
				{/* Wraps on a narrow window, so the buttons stay on the page. */}
				<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
					<div className="flex-1 min-w-0">{title}</div>
					{/* A quiet button last: its text, not its hover background, meets the right edge. */}
					{actions && <div className="flex flex-wrap items-center gap-1 [&>.quiet:last-child]:-mr-2.5">{actions}</div>}
				</div>
				{items.length > 0 && (
					<div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-gray-500 dark:text-gray-400">
						{items.flatMap((item, i) => (i ? [<span key={`sep${i}`} className="text-gray-300 dark:text-gray-600" aria-hidden="true">·</span>, item] : [item]))}
					</div>
				)}
			</div>
			{children}
		</div>
	);
}
