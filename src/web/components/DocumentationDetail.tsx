import {useState, useEffect, useRef, memo, useCallback} from 'react';
import {Navigate, useParams, useNavigate, useSearchParams} from 'react-router-dom';
import {apiClient, isAmbiguousIdConflict} from '../lib/api';
import MDEditor from '@uiw/react-md-editor';
import MermaidMarkdown from './MermaidMarkdown';
import DocEditor from './DocEditor';
import {type Document} from '../../types';
import AmbiguousIdNotice from './AmbiguousIdNotice';
import ErrorBoundary from '../components/ErrorBoundary';
import {SuccessToast} from './SuccessToast';
import { useTheme } from '../contexts/ThemeContext';
import { useBrowserAccess } from "../contexts/BrowserAccessContext";
import { sanitizeUrlTitle } from '../utils/urlHelpers';
import StoredDate from './StoredDate';
import { documentIdKey } from '../../utils/document-id';
import { ArchiveButton, ArchivedLabel, ArchiveRefusal, useRecordArchive } from './RecordArchive';
import { ButtonDivider, primaryButton, quietButton, RecordHeader, RecordId, titleClass } from './RecordHeader';
import { useVault, VAULT_MARKER } from '../lib/hub-vault';
import { LockedDoc, VaultButton } from './VaultControls';

// Custom MDEditor wrapper for proper height handling
const MarkdownEditor = memo(function MarkdownEditor({
	value,
	onChange,
	isEditing
}: {
    value: string;
    onChange?: (val: string | undefined) => void;
    isEditing: boolean;
    isReadonly?: boolean;
}) {
    const { theme } = useTheme();
    if (!isEditing) {
        // Preview mode - just show the rendered markdown without editor UI
        return (
            <div
                className="prose prose-sm !max-w-none w-full p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
                data-color-mode={theme}>
                <MermaidMarkdown source={value} />
            </div>
        );
    }

    // Edit mode - show full editor that fills the available space
    return (
        <div className="h-full w-full flex flex-col">
            <div className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
                <MDEditor
                    value={value}
                    onChange={onChange}
                    preview="edit"
                    height="100%"
                    hideToolbar={false}
                    data-color-mode={theme}
                    textareaProps={{
                        placeholder: 'Write your documentation here...',
                        style: {
                            fontSize: '14px',
                            resize: 'none'
                        }
                    }}
                />
            </div>
        </div>
    );
});

// Utility function to add doc prefix for API calls
const addDocPrefix = (id: string): string => {
    return id.startsWith('doc-') ? id : `doc-${id}`;
};

// Edits in the visual editor are saved this long after the last keystroke.
const AUTOSAVE_MS = 800;

const getDocumentDirectory = (path?: string): string => {
    if (!path) return '';
    return path.split(/[\\/]+/).slice(0, -1).join('/');
};

interface DocumentationDetailProps {
    docs: Document[];
    onRefreshData: () => Promise<void>;
    dateFormat?: string;
}

export default function DocumentationDetail({docs, onRefreshData, dateFormat}: DocumentationDetailProps) {
    const {id, title} = useParams<{ id: string; title: string }>();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { canWrite } = useBrowserAccess();
    const { theme } = useTheme();
    const isNewDocument = id === "new";
    const [document, setDocument] = useState<Document | null>(null);
    const [content, setContent] = useState<string>('');
    const [originalContent, setOriginalContent] = useState<string>('');
    const [docTitle, setDocTitle] = useState<string>('');
    const [originalDocTitle, setOriginalDocTitle] = useState<string>('');
    const [docPath, setDocPath] = useState<string>('');
    const [originalDocPath, setOriginalDocPath] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [editRequested, setEditRequested] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [saveError, setSaveError] = useState<Error | null>(null);
    const [showSaveSuccess, setShowSaveSuccess] = useState(false);
    // Visual editor: its content is remounted (editorVersion) only when the file changes elsewhere.
    const [editorVersion, setEditorVersion] = useState(0);
    const [autosave, setAutosave] = useState<'saved' | 'saving' | 'failed'>('saved');
    const latest = useRef(''); // the Markdown in the editor, or last loaded
    const sent = useRef(''); // the last Markdown saved from here
    const pending = useRef<{ timer: ReturnType<typeof setTimeout>; docId: string; markdown: string } | null>(null);
    const loadedIdentity = useRef<string | null>(null);
    // An archived document is read-only: it shows the Archived label and neither Edit nor Archive.
    const routeIdentity = id && !isNewDocument ? documentIdKey(id) : null;
    const currentDocument = document && routeIdentity && documentIdKey(document.id) === routeIdentity ? document : null;
    const isArchived = currentDocument?.archived === true;
    // Encrypted on disk (Backlog Hub): read-only until unlocked, so the encrypted file is never overwritten.
    const vaultState = useVault();
    const lockedOnDisk = !isNewDocument && content.includes(VAULT_MARKER);
    const canEdit = canWrite && !isArchived && !lockedOnDisk;
    const isEditing = canEdit && editRequested;
    const showEditAction = canEdit && !isEditing;
    const archiveRecord = showEditAction && !isLoading ? currentDocument : null;
    const {archive, isArchiving, archiveError, dismissArchiveError} = useRecordArchive(
        'document',
        archiveRecord,
        routeIdentity,
        onRefreshData,
    );

    useEffect(() => {
        let active = true;
        if (isNewDocument) {
            if (!canWrite) return;
            // Handle new document creation
            setEditRequested(true);
            setIsLoading(false);
            // Creating is unrelated to whatever failed to load before, so clear any load error.
            // Otherwise a previous ambiguity notice keeps rendering instead of the create editor.
            setError(null);
            setDocument(null);
            setDocTitle('');
            setOriginalDocTitle('');
            setDocPath('');
            setOriginalDocPath('');
            setContent('');
            setOriginalContent('');
        } else if (id) {
            // Same document again (the list refreshed, often after our own save): reload quietly.
            const quiet = loadedIdentity.current === routeIdentity;
            if (!quiet) setEditRequested(false); // Ensure we start in preview mode for existing documents
            void loadDocContent(() => active, quiet);
        }
        return () => { active = false; };
    }, [id, docs, isNewDocument, canWrite]);

    // Check for edit query parameter to start in edit mode
    useEffect(() => {
        if (searchParams.get('edit') === 'true') {
            setEditRequested(canWrite);
            // Remove the edit parameter from URL
            setSearchParams(params => {
                params.delete('edit');
                return params;
            });
        }
    }, [searchParams, setSearchParams, canWrite]);

    const loadDocContent = useCallback(async (isCurrent: () => boolean, quiet = false) => {
        if (quiet && routeIdentity) {
            try {
                const fullDoc = await apiClient.fetchDoc(routeIdentity);
                if (!isCurrent()) return;
                setDocument(fullDoc);
                const raw = fullDoc.rawContent || '';
                if (raw.includes(VAULT_MARKER) && pending.current) {
                    // Encrypted meanwhile (Backlog Hub locked it): the waiting edit must not write it back in clear.
                    clearTimeout(pending.current.timer);
                    pending.current = null;
                    setAutosave('saved');
                }
                const ours = [latest.current, sent.current].some((m) => m.trimEnd() === raw.trimEnd());
                if (!ours && !pending.current) {
                    // Changed elsewhere (another window, an agent, git): show it.
                    latest.current = raw;
                    setContent(raw);
                    setOriginalContent(raw);
                    setEditorVersion((v) => v + 1);
                }
            } catch (err) {
                console.error('Failed to refresh document:', err);
            }
            return;
        }
        try {
            setIsLoading(true);
            setError(null);
            setDocument(null);
            setContent('');
            setOriginalContent('');
            if (!routeIdentity) {
                setDocTitle('');
                setOriginalDocTitle('');
                setDocPath('');
                setOriginalDocPath('');
                return;
            }
            // Find document from props using the same identity as the route.
            const prefixedId = routeIdentity;
            const doc = docs.find(d => documentIdKey(d.id) === routeIdentity);
            
            // Always try to fetch the document from API, whether we found it in docs or not
            // This ensures deep linking works even before the parent component loads the docs array
            try {
                const fullDoc = await apiClient.fetchDoc(prefixedId);
                if (!isCurrent()) return;
                setContent(fullDoc.rawContent || '');
                setOriginalContent(fullDoc.rawContent || '');
                latest.current = fullDoc.rawContent || '';
                sent.current = '';
                loadedIdentity.current = routeIdentity;
                setEditorVersion((v) => v + 1);
                setAutosave('saved');
                setDocTitle(fullDoc.title || '');
                setOriginalDocTitle(fullDoc.title || '');
                setDocPath(getDocumentDirectory(fullDoc.path));
                setOriginalDocPath(getDocumentDirectory(fullDoc.path));
                // Update document state with full data
                setDocument(fullDoc);
            } catch (fetchError) {
                if (!isCurrent()) return;
                // Never fall back to the cached list entry when the ID is ambiguous: that entry is
                // one of the candidates, and showing it would silently pick a winner.
                if (isAmbiguousIdConflict(fetchError)) {
                    setDocument(null);
                    setError(fetchError);
                    console.error('Failed to load document:', fetchError);
                } else if (!doc) {
                    // If fetch fails and we don't have the doc in props, show error
                    setError(new Error(`Document with ID "${prefixedId}" not found`));
                    console.error('Failed to load document:', fetchError);
                } else {
                    // We have basic info from props even if fetch failed
                    setDocument(doc);
                    setDocTitle(doc.title || '');
                    setOriginalDocTitle(doc.title || '');
                    setDocPath(getDocumentDirectory(doc.path));
                    setOriginalDocPath(getDocumentDirectory(doc.path));
                }
            }
        } catch (err) {
            if (!isCurrent()) return;
            const error = err instanceof Error ? err : new Error('Failed to load document');
            setError(error);
            console.error('Failed to load document:', error);
        } finally {
            if (isCurrent()) setIsLoading(false);
        }
    }, [routeIdentity, docs]);

    // ---- visual editor: autosave ----

    const flush = useCallback(async () => {
        const job = pending.current;
        if (!job) return;
        clearTimeout(job.timer);
        pending.current = null;
        setAutosave('saving');
        try {
            sent.current = job.markdown;
            await apiClient.updateDoc(job.docId, job.markdown);
            setOriginalContent(job.markdown);
            if (!pending.current) setAutosave('saved');
        } catch (err) {
            console.error('Failed to save document:', err);
            setAutosave('failed');
        }
    }, []);

    const handleEditorChange = useCallback((markdown: string) => {
        if (!id) return;
        latest.current = markdown;
        setContent(markdown);
        if (pending.current) clearTimeout(pending.current.timer);
        pending.current = { docId: addDocPrefix(id), markdown, timer: setTimeout(() => void flush(), AUTOSAVE_MS) };
        setAutosave('saving');
    }, [id, flush]);

    // Leaving the document (or the page) saves what is waiting.
    useEffect(() => () => void flush(), [id, flush]);
    useEffect(() => {
        const beforeUnload = () => void flush();
        window.addEventListener('beforeunload', beforeUnload);
        return () => window.removeEventListener('beforeunload', beforeUnload);
    }, [flush]);

    // The title, edited in place: saved on Enter or when leaving it.
    const saveTitle = useCallback(async (text: string, heading: HTMLElement) => {
        const normalizedTitle = text.trim();
        if (!id || normalizedTitle === originalDocTitle) return;
        if (!normalizedTitle) {
            heading.textContent = originalDocTitle;
            return;
        }
        await flush();
        try {
            await apiClient.updateDoc(addDocPrefix(id), latest.current, normalizedTitle);
            setDocTitle(normalizedTitle);
            setOriginalDocTitle(normalizedTitle);
            await onRefreshData();
            navigate(`/documentation/${id}/${sanitizeUrlTitle(normalizedTitle)}`, { replace: true });
        } catch (err) {
            setSaveError(err instanceof Error ? err : new Error('Failed to rename document'));
            heading.textContent = originalDocTitle;
        }
    }, [id, originalDocTitle, flush, onRefreshData, navigate]);

    const handleSave = useCallback(async () => {
        if (!docTitle.trim()) {
            setSaveError(new Error('Document title is required'));
            return;
        }

        try {
            setIsSaving(true);
            setSaveError(null);
            const normalizedTitle = docTitle.trim();
            const normalizedPath = docPath.trim();

            if (isNewDocument) {
                // Create new document
                const result = await apiClient.createDoc(normalizedTitle, content, normalizedPath);
                // Refresh data and navigate to the new document
                await onRefreshData();
                // Show success toast
                setShowSaveSuccess(true);
                setTimeout(() => setShowSaveSuccess(false), 4000);
                // Exit edit mode and navigate to the new document
                setEditRequested(false);
                setDocTitle(normalizedTitle);
                setOriginalDocTitle(normalizedTitle);
                setDocPath(getDocumentDirectory(result.path) || normalizedPath);
                setOriginalDocPath(getDocumentDirectory(result.path) || normalizedPath);
                // Use the returned document ID for navigation
                const documentId = result.id.replace('doc-', ''); // Remove prefix for URL
                navigate(`/documentation/${documentId}/${sanitizeUrlTitle(normalizedTitle)}`);
            } else {
                // Update existing document
                if (!id) return;

                // Check if title has changed
                const titleChanged = normalizedTitle !== originalDocTitle;
                const pathChanged = normalizedPath !== originalDocPath;

                // Pass title only if it has changed
                const updatedDocument = await apiClient.updateDoc(
                    addDocPrefix(id),
                    content,
                    titleChanged ? normalizedTitle : undefined,
                    pathChanged ? normalizedPath : undefined
                );

                // Update original title to the new value
                if (titleChanged) {
                    setDocTitle(normalizedTitle);
                    setOriginalDocTitle(normalizedTitle);
                }
                if (pathChanged) {
                    const updatedPath = getDocumentDirectory(updatedDocument.path) || normalizedPath;
                    setDocPath(updatedPath);
                    setOriginalDocPath(updatedPath);
                }

                // Refresh data from parent
                await onRefreshData();
                // Show success toast
                setShowSaveSuccess(true);
                setTimeout(() => setShowSaveSuccess(false), 4000);
                // Exit edit mode and navigate to document detail page (this will load in preview mode)
                latest.current = content;
                sent.current = content;
                setOriginalContent(content);
                setEditorVersion((v) => v + 1);
                setEditRequested(false);
                navigate(`/documentation/${id}/${sanitizeUrlTitle(normalizedTitle)}`);
            }
        } catch (err) {
            const error = err instanceof Error ? err : new Error('Failed to save document');
            setSaveError(error);
            console.error('Failed to save document:', error);
        } finally {
            setIsSaving(false);
        }
    }, [id, docTitle, docPath, originalDocPath, content, isNewDocument, onRefreshData, navigate, loadDocContent]);

    const handleEdit = () => {
        void flush();
        setEditRequested(true);
    };

    const handleCancelEdit = () => {
        if (isNewDocument) {
            // Navigate back for new documents
            navigate('/documentation');
        } else {
            // Revert changes for existing documents
            setContent(originalContent);
            setDocTitle(originalDocTitle);
            setDocPath(originalDocPath);
            setEditRequested(false);
        }
    };

    const hasChanges = content !== originalContent || docTitle !== originalDocTitle || docPath !== originalDocPath;

    if (isNewDocument && !canWrite) return <Navigate to="/documentation" replace />;

    if (!routeIdentity && !isNewDocument) {
        return (
            <div className="flex-1 flex items-center justify-center p-8">
                <div className="text-center">
                    <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor"
                         viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No document selected</h3>
                    <p className="mt-1 text-sm text-gray-500">Select a document from the sidebar to view its
                        content.</p>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="text-gray-500">Loading...</div>
            </div>
        );
    }

    if (isAmbiguousIdConflict(error)) {
        return <AmbiguousIdNotice message={error.message} />;
    }

    return (
        <ErrorBoundary>
            <div className="h-full bg-white dark:bg-gray-900 flex flex-col transition-colors duration-200">
                <RecordHeader
                    title={
                        isEditing ? (
                            <div className="space-y-2">
                                <input
                                    type="text"
                                    value={docTitle}
                                    onChange={(e) => setDocTitle(e.target.value)}
                                    className={`${titleClass} w-full bg-transparent border border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent`}
                                    placeholder="Document title"
                                />
                                <input
                                    type="text"
                                    value={docPath}
                                    onChange={(e) => setDocPath(e.target.value)}
                                    className="w-full max-w-md bg-transparent border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
                                    placeholder="guides/setup"
                                />
                            </div>
                        ) : canEdit ? (
                            <h1
                                key={originalDocTitle}
                                contentEditable="plaintext-only"
                                suppressContentEditableWarning
                                spellCheck={false}
                                aria-label="Document title"
                                onBlur={(e) => void saveTitle(e.currentTarget.textContent || '', e.currentTarget)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        e.currentTarget.blur();
                                    }
                                    if (e.key === 'Escape') {
                                        e.currentTarget.textContent = originalDocTitle;
                                        e.currentTarget.blur();
                                    }
                                }}
                                className={`${titleClass} rounded -mx-1 px-1 outline-none hover:bg-gray-50 dark:hover:bg-gray-800 focus:bg-transparent transition-colors duration-200`}
                            >
                                {originalDocTitle || document?.title || (title ? decodeURIComponent(title) : `Document ${id}`)}
                            </h1>
                        ) : (
                            <h1 className={titleClass}>
                                {docTitle || document?.title || (title ? decodeURIComponent(title) : `Document ${id}`)}
                            </h1>
                        )
                    }
                    actions={
                        <>
                            {showEditAction && (
                                <span
                                    className={`inline-flex items-center gap-1.5 mr-2 text-[13px] ${autosave === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}
                                    title={autosave === 'failed' ? 'Edit the text again to retry' : 'Changes are saved as you type'}
                                >
                                    <span style={{ borderRadius: '50%' }} className={`w-2 h-2 ${autosave === 'saved' ? 'bg-green-500' : autosave === 'saving' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}`} />
                                    {autosave === 'saved' ? 'Saved' : autosave === 'saving' ? 'Saving…' : 'Not saved'}
                                </span>
                            )}
                            {!isEditing && !isNewDocument && (
                                <VaultButton state={vaultState} docId={currentDocument?.id} beforeLock={flush} />
                            )}
                            {showEditAction && (
                                <button onClick={handleEdit} title="Edit the Markdown source, the path and the title" className={quietButton}>
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>
                                    </svg>
                                    Markdown
                                </button>
                            )}
                            {archiveRecord && (
                                <>
                                    {showEditAction && <ButtonDivider />}
                                    <ArchiveButton onClick={archive} disabled={isArchiving} />
                                </>
                            )}
                            {isEditing && (
                                <>
                                    <button onClick={handleCancelEdit} className={quietButton}>Cancel</button>
                                    <button onClick={handleSave} disabled={!hasChanges || isSaving} className={primaryButton}>
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                                        </svg>
                                        {isSaving ? 'Saving...' : 'Save'}
                                    </button>
                                </>
                            )}
                        </>
                    }
                    meta={[
                        isArchived && <ArchivedLabel />,
                        // The file name starts with the id ("doc-6 - Title.md"): no need to show it twice.
                        !document?.path?.split('/').pop()?.toLowerCase().startsWith(`${(document?.id || `doc-${id}`).toLowerCase()} `) && <RecordId id={document?.id || `doc-${id}`} />,
                        document?.path && <span>{document.path}</span>,
                        document?.createdDate && <span>Created <StoredDate value={document.createdDate} dateFormat={dateFormat} /></span>,
                    ]}
                >
                    {archiveError && <ArchiveRefusal message={archiveError} onDismiss={dismissArchiveError} />}
                </RecordHeader>

                {/* Content Section */}
                <div className="flex-1 bg-gray-50 dark:bg-gray-800 transition-colors duration-200 flex flex-col">
                    <div className="flex-1 p-8 flex flex-col min-h-0">
                        {lockedOnDisk ? (
                            <LockedDoc state={vaultState} docId={currentDocument?.id} />
                        ) : canEdit && !isEditing && !isNewDocument ? (
                            <div className="w-full bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                                <DocEditor key={`${routeIdentity}:${editorVersion}`} value={content} onChange={handleEditorChange}>
                                    <div className="prose prose-sm !max-w-none w-full p-6" data-color-mode={theme}>
                                        <MermaidMarkdown source={content} />
                                    </div>
                                </DocEditor>
                            </div>
                        ) : (
                            <MarkdownEditor
                                value={content}
                                onChange={(val) => setContent(val || '')}
                                isEditing={isEditing}
                            />
                        )}
                    </div>
                </div>

                {/* Save Error Alert */}
                {saveError && (
                    <div className="border-t border-red-200 bg-red-50 px-8 py-3">
                        <div className="flex items-center space-x-3">
                            <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.35 16.5c-.77.833.192 2.5 1.732 2.5z"/>
                            </svg>
                            <span className="text-sm text-red-700">Failed to save: {saveError.message}</span>
                            <button
                                onClick={() => setSaveError(null)}
                                className="ml-auto text-red-700 hover:text-red-900"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                          d="M6 18L18 6M6 6l12 12"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Save Success Toast */}
            {showSaveSuccess && (
                <SuccessToast
                    message={`Document "${docTitle}" saved successfully!`}
                    onDismiss={() => setShowSaveSuccess(false)}
                    icon={
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                    }
                />
            )}
        </ErrorBoundary>
    );
}
