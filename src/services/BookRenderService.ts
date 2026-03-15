import { App, Component, MarkdownRenderer, MarkdownView, TFile, TFolder } from 'obsidian';
import { Book, ChapterNode, CoverSettings } from '../types/book';
import { HeaderFooterTocSettings } from '../modals/HeaderFooterTocModal';
import * as electron from 'electron';

export interface RenderConfig {
    showTitle: boolean;
    scale: number;
    displayHeader: boolean;
    displayFooter: boolean;
    cssSnippet?: string;
    abortSignal?: AbortSignal;
    onProgress?: (current: number, total: number, fileName: string) => void;
    headerFooterToc?: HeaderFooterTocSettings; // Table of contents settings
    showCover?: boolean;
    coverSettings?: CoverSettings;
}

export interface DocType {
    doc: Document;
    frontMatter: any;
    file: TFile;
    title: string;
}

export interface ParamType {
    app: App;
    file: TFile;
    config: RenderConfig;
    book: Book;
    rootPath: string;
    extra?: {
        title?: string;
        id?: string;
    };
}

export class BookRenderService {
    private docs: DocType[] = [];
    private scale = 1;

    constructor(private app: App) { }

    /**
     * Main render method - based on obsidian-better-export-pdf architecture
     */
    async renderToWebview(
        webview: electron.WebviewTag,
        book: Book,
        rootPath: string,
        config: RenderConfig
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Webview setup timeout'));
            }, 10000);


            webview.addEventListener('dom-ready', async () => {
                try {
                    clearTimeout(timeout);

                    // 1. Collect all files and render to documents
                    const { data, docs } = await this.getAllFiles(book, rootPath, config);
                    await this.renderFiles(data, docs, config);

                    // 2. If TOC is enabled, generate TOC HTML
                    let tocHtml = '';
                    if (config.headerFooterToc?.tocEnabled) {
                        tocHtml = this.generateTOC(config.headerFooterToc, book);
                    }

                    // 3. Inject all styles
                    const styles = this.getAllStyles();
                    for (const css of styles) {
                        await webview.insertCSS(css);
                    }

                    // 4. Handle custom CSS snippets
                    if (config?.cssSnippet && config.cssSnippet !== '0') {
                        try {
                            await webview.insertCSS(config.cssSnippet);
                        } catch (error) {
                            console.warn('Failed to load CSS snippet:', error);
                        }
                    }

                    // 5. Inject TOC and rendered documents into webview
                    // Process TOC first, insert at the beginning of the content
                    if (tocHtml) {
                        const doc = this.docs[0].doc;
                        const contentEl = doc.querySelector('.markdown-preview-view');
                        if (contentEl) {
                            const tocContainer = doc.createElement('div');
                            tocContainer.innerHTML = tocHtml;
                            contentEl.insertBefore(tocContainer, contentEl.firstChild);
                        }
                    }

                    await this.appendWebview(webview, this.docs[0]);

                    
                    // 6. Inject patch styles
                    const patchStyles = this.getPatchStyles();
                    for (const css of patchStyles) {
                        await webview.insertCSS(css);
                    }

                    resolve();
                } catch (error) {
                    clearTimeout(timeout);
                    reject(error);
                }
            });
        });
    }

    /**
     * Build file list directly from the vault folder instead of Book Smith's stored tree.
     * The filesystem is now the single source of truth.
     */
    private async getAllFiles(book: Book, rootPath: string, config: RenderConfig): Promise<{ data: ParamType[], docs: DocType[] }> {
        const fileNodes = this.getFolderNodes(book, rootPath);

        const data: ParamType[] = fileNodes.map(node => ({
            app: this.app,
            file: this.getFileFromNode(node, book, rootPath),
            config,
            book,
            rootPath,
            extra: {
                title: node.title,
                id: node.id
            }
        })).filter(param => param.file !== null) as ParamType[];

        return { data, docs: [] };
    }

    /**
     * Render all files - corresponds to modal.ts renderFiles
     */
    private async renderFiles(
        data: ParamType[],
        docs: DocType[] = [],
        config: RenderConfig
    ): Promise<void> {
        const totalFiles = data.length;

        // Render all files concurrently
        const inputs = data.map((param, i) =>
            this.renderMarkdown(param).then(res => {
                config.onProgress?.(i + 1, totalFiles, param.file.basename);
                return res;
            })
        );

        let _docs = [...docs, ...(await Promise.all(inputs))];

        // Merge all documents into a complete book document
        _docs = this.mergeDoc(_docs);

        // Fix documents
        this.docs = _docs.map(({ doc, ...rest }) => {
            return { ...rest, doc: this.fixDoc(doc, doc.title) };
        });
    }

    /**
     * Render single Markdown file - based on render.ts renderMarkdown
     */
    private async renderMarkdown({ app, file, config, book, extra }: ParamType): Promise<DocType> {
        // Check for abort signal
        if (config.abortSignal?.aborted) {
            throw new Error('Render aborted');
        }

        const leaf = app.workspace.getLeaf(true);
        await leaf.openFile(file);
        const view = leaf.view as MarkdownView;
        const data: string = view?.data || await app.vault.cachedRead(file);

        const frontMatter = this.getFrontMatter(file);
        const cssclasses = this.extractCssClasses(frontMatter);

        const comp = new Component();
        comp.load();

        try {
            const printEl = document.body.createDiv('print');
            const viewEl = printEl.createDiv({
                cls: 'markdown-preview-view markdown-rendered ' + cssclasses.join(' '),
            });

            // Set RTL and property display
            // @ts-ignore
            viewEl.toggleClass('rtl', app.vault.getConfig('rightToLeft'));
            // @ts-ignore
            viewEl.toggleClass('show-properties', 'hidden' !== app.vault.getConfig('propertiesInDocument'));

            // Set Title
            const title = extra?.title || frontMatter?.title || file.basename;
            viewEl.createEl('h1', { text: title }, (e) => {
                e.addClass('__title__');
                e.style.display = config.showTitle ? 'block' : 'none';
                e.id = extra?.id || '';
            });

            // Process block references
            const processedData = this.processBlockReferences(data || '', file);

            // Render markdown
            const fragment = this.createRenderFragment();
            const promises: Array<() => Promise<unknown>> = [];

            try {
                await MarkdownRenderer.render(app, processedData, fragment, file.path, comp);
            } catch (error) {
                // Expected error to avoid postProcess
            }

            // Add rendered content to viewEl
            const el = createFragment();
            Array.from(fragment.children).forEach((item) => {
                el.createDiv({}, (t) => {
                    //@ts-ignore
                    return t.appendChild(item);
                });
            });
            viewEl.appendChild(el);

            // Post-processing
            // @ts-ignore
            await MarkdownRenderer.postProcess(app, {
                docId: this.generateDocId(16),
                sourcePath: file.path,
                frontmatter: {},
                promises,
                addChild: function (e: Component) {
                    return comp.addChild(e);
                },
                getSectionInfo: function () {
                    return null;
                },
                containerEl: viewEl,
                el: viewEl,
                displayMode: true,
            });

            await Promise.all(promises);

            // Fix internal links
            this.fixInternalLinks(printEl, file);

            // Wait for dynamic content to render
            await this.fixWaitRender(data || '', viewEl);

            // Fix canvas to image
            this.fixCanvasToImage(viewEl);

            // Create document
            const doc = document.implementation.createHTMLDocument('document');
            doc.body.appendChild(printEl.cloneNode(true));
            doc.title = title;

            // Cleanup
            printEl.detach();
            printEl.remove();
            leaf.detach();

            return { doc, frontMatter, file, title };

        } finally {
            comp.unload();
        }
    }

    /**
     * Merge all documents - corresponds to modal.ts mergeDoc
     */
    private mergeDoc(docs: DocType[]): DocType[] {
        if (docs.length <= 1) return docs;

        const { doc: doc0, frontMatter, file, title } = docs[0];
        const sections = [];

        for (const { doc } of docs) {
            const element = doc.querySelector('.markdown-preview-view');
            if (element) {
                const section = doc0.createElement('section');
                section.className = 'book-chapter';
                Array.from(element.children).forEach((child) => {
                    section.appendChild(doc0.importNode(child, true));
                });
                sections.push(section);
            }
        }

        const root = doc0.querySelector('.markdown-preview-view');
        if (root) {
            root.innerHTML = '';
            sections.forEach((section, index) => {
                root.appendChild(section);
            });
        }

        return [{ doc: doc0, frontMatter, file, title }];
    }

    /**
     * Inject documents into webview - corresponds to modal.ts appendWebview
     */
    private async appendWebview(webview: electron.WebviewTag, docData: DocType): Promise<void> {
        const { doc } = docData;

        const webviewJs = this.makeWebviewJs(doc);

        try {
            await webview.executeJavaScript(webviewJs);
        } catch (error) {
            console.error('Failed to inject content to webview:', error);
            throw new Error(`Failed to render book: ${error.message}`);
        }
    }

    /**
     * Generate webview injection script - corresponds to modal.ts makeWebviewJs
     */
    private makeWebviewJs(doc: Document): string {
        const bodyContent = doc.body.innerHTML;
        const headContent = doc.head.innerHTML;
        const docTitle = doc.title;

        return `
            try {
                document.body.innerHTML = decodeURIComponent(\`${encodeURIComponent(bodyContent)}\`);
                document.head.innerHTML = decodeURIComponent(\`${encodeURIComponent(headContent)}\`);
                
                function decodeAndReplaceEmbed(element) {
                    if (!element || !element.innerHTML) return;
                    try {
                        element.innerHTML = decodeURIComponent(element.innerHTML);
                        const newEmbeds = element.querySelectorAll("span.markdown-embed");
                        newEmbeds.forEach(decodeAndReplaceEmbed);
                    } catch (e) {
                        console.warn('Failed to decode embed:', e);
                    }
                }
                
                document.querySelectorAll("span.markdown-embed").forEach(decodeAndReplaceEmbed);
                
                const currentBodyClasses = "${Array.from(document.body.classList).join(' ')}";
                const currentHtmlClasses = "${Array.from(document.documentElement.classList).join(' ')}";
                
                if (currentBodyClasses) {
                    document.body.className = currentBodyClasses;
                }
                if (currentHtmlClasses) {
                    document.documentElement.className = currentHtmlClasses;
                }
                
                const themeAttr = "${document.documentElement.getAttribute('data-theme') || ''}";
                const modeAttr = "${document.documentElement.getAttribute('data-mode') || ''}";
                
                if (themeAttr) document.documentElement.setAttribute('data-theme', themeAttr);
                if (modeAttr) document.documentElement.setAttribute('data-mode', modeAttr);
                
                document.body.addClass("theme-light");
                document.body.removeClass("theme-dark");
                document.title = \`${docTitle.replace(/[`\\]/g, '\\$&')}\`;
                
            } catch (error) {
                console.error('Error in webview script:', error);
                throw error;
            }
        `;
    }

    /**
     * Fix document - corresponds to render.ts fixDoc
     */
    private fixDoc(doc: Document, title: string): Document {
        this.encodeEmbeds(doc);
        return doc;
    }

    /**
     * Encode embedded content - corresponds to render.ts encodeEmbeds
     */
    private encodeEmbeds(doc: Document): void {
        const spans = Array.from(doc.querySelectorAll('span.markdown-embed')).reverse();
        spans.forEach((span: HTMLElement) => {
            span.innerHTML = encodeURIComponent(span.innerHTML);
        });
    }

    /**
     * Read markdown files directly from the book folder.
     * Uses Obsidian's native manual sort order. No artificial sorting.
     */
    private getFolderNodes(book: Book, rootPath: string): ChapterNode[] {
        const basePath = `${rootPath}/${book.basic.title}`;
        const folder = this.app.vault.getAbstractFileByPath(basePath);

        if (!(folder instanceof TFolder)) return [];

        // Access Obsidian's File Explorer (this holds the real sort order)
        const explorer = (this.app as any).internalPlugins?.getPluginById('file-explorer')?.instance;
        if (!explorer) return [];

        const fileItems: TFile[] = [];

        const collect = (folderPath: string) => {
            const children = explorer.fileItems?.[folderPath]?.children;
            if (!children) return;

            for (const child of Object.values(children)) {
                const file = (child as any).file;
                if (file instanceof TFile && file.extension === 'md') {
                    fileItems.push(file);
                }
            }
        };

        collect(basePath);

        return fileItems.map((file, index) => ({
            id: file.path,
            title: file.basename,
            path: file.name,
            type: 'file' as const,
            order: index,
            exclude: false,
            default_status: 'draft',
            created_at: new Date(file.stat.ctime).toISOString(),
            last_modified: new Date(file.stat.mtime).toISOString(),
        }));
    }

    /**
     * Get file object based on chapter node
     */
    private getFileFromNode(node: ChapterNode, book: Book, rootPath: string): TFile | null {
        const filePath = `${rootPath}/${book.basic.title}/${node.path}`;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        return file instanceof TFile ? file : null;
    }

    /**
     * Collect file nodes from a chapter tree in book structure order.
     * This is used for exports that must follow the user-defined order rather than filesystem order.
     */
    public collectFileNodes(nodes: ChapterNode[]): ChapterNode[] {
        const result: ChapterNode[] = [];

        const traverse = (nodeList: ChapterNode[]) => {
            for (const node of nodeList) {
                if (node.exclude) continue;
                if (node.type === 'file') {
                    result.push(node);
                } else if (node.type === 'group' && Array.isArray(node.children)) {
                    traverse(node.children);
                }
            }
        };

        traverse(nodes);
        return result;
    }

    /**
     * Get Frontmatter
     */
    private getFrontMatter(file: TFile) {
        const cache = this.app.metadataCache.getFileCache(file);
        return cache?.frontmatter || {};
    }

    /**
     * Extract CSS classes from frontmatter
     */
    private extractCssClasses(frontMatter: any): string[] {
        const cssclasses: string[] = [];
        for (const [key, val] of Object.entries(frontMatter)) {
            if (key.toLowerCase() === 'cssclass' || key.toLowerCase() === 'cssclasses') {
                if (Array.isArray(val)) {
                    cssclasses.push(...val);
                } else {
                    cssclasses.push(val as string);
                }
            }
        }
        return cssclasses;
    }

    /**
     * Process block references
     */
    private processBlockReferences(data: string, file: TFile): string {
        const cache = this.app.metadataCache.getFileCache(file);
        const blocks = new Map(Object.entries(cache?.blocks || {}));

        const lines = data.split('\n').map((line, i) => {
            for (const { id, position: { start, end } } of blocks.values()) {
                const blockid = `^${id}`;
                if (line.includes(blockid) && i >= start.line && i <= end.line) {
                    blocks.delete(id);
                    return line.replace(blockid, `<span id="${blockid}" class="blockid"></span> ${blockid}`);
                }
            }
            return line;
        });

        [...blocks.values()].forEach(({ id, position: { start } }) => {
            const idx = start.line;
            lines[idx] = `<span id="^${id}" class="blockid"></span>\n\n` + lines[idx];
        });

        return lines.join('\n');
    }

    /**
     * Create render fragment
     */
    private createRenderFragment(): any {
        return {
            children: undefined,
            appendChild(e: DocumentFragment) {
                this.children = e?.children;
                throw new Error('exit');
            },
        } as unknown as HTMLElement;
    }

    /**
     * Fix internal links
     */
    private fixInternalLinks(printEl: HTMLElement, file: TFile): void {
        printEl.findAll('a.internal-link').forEach((el: HTMLAnchorElement) => {
            const [title, anchor] = el.dataset.href?.split('#') || [];
            if ((!title || title?.length === 0 || title === file.basename) && anchor?.startsWith('^')) {
                return;
            }
            el.removeAttribute('href');
        });
    }

    /**
     * Wait for dynamic content to render
     */
    private async fixWaitRender(data: string, viewEl: HTMLElement): Promise<void> {
        if (data.includes('```dataview') || data.includes('```gEvent') || data.includes('![[')) {
            await this.sleep(2000);
        }
        try {
            await this.waitForDomChange(viewEl);
        } catch (error) {
            await this.sleep(1000);
        }
    }

    /**
     * Fix canvas elements by converting them to images
     */
    private fixCanvasToImage(el: HTMLElement): void {
        for (const canvas of Array.from(el.querySelectorAll('canvas'))) {
            const data = canvas.toDataURL();
            const img = document.createElement('img');
            img.src = data;
            img.className = '__canvas__';
            Array.from(canvas.attributes).forEach(attr => {
                img.setAttribute(attr.name, attr.value);
            });
            canvas.replaceWith(img);
        }
    }

    /**
     * Get all style rules
     */
    private getAllStyles(): string[] {
        const cssTexts: string[] = [];

        Array.from(document.styleSheets).forEach((sheet) => {
            // @ts-ignore
            const id = sheet.ownerNode?.id;
            if (id?.startsWith('svelte-')) return;

            // @ts-ignore
            const href = sheet.ownerNode?.href;
            const division = `/* ----------${id ? `id:${id}` : href ? `href:${href}` : 'inline'}---------- */`;
            cssTexts.push(division);

            try {
                Array.from(sheet?.cssRules || []).forEach((rule) => {
                    cssTexts.push(rule.cssText);
                });
            } catch (error) {
                console.error('Error reading CSS rules:', error);
            }
        });

        return cssTexts;
    }

    /**
     * Get CSS patch for printing
     */
    private getPatchStyles(): string[] {
        const patchCSS = `
            /* ---------- css patch ---------- */
            body {
                overflow: auto !important;
            }
            
            @media print {
                .print .markdown-preview-view {
                    height: auto !important;
                }
                
                .md-print-anchor, .blockid {
                    white-space: pre !important;
                    border: none !important;
                    display: inline-block !important;
                    position: absolute !important;
                    width: 1px !important;
                    height: 1px !important;
                    right: 0 !important;
                }
            }
            
            img.__canvas__ {
                width: 100% !important;
                height: 100% !important;
            }
            
            .book-chapter {
                margin-bottom: 2em;
            }
            
            .page-break {
                page-break-after: always;
                break-after: page;
            }
        `;

        return [patchCSS];
    }

    /**
     * Utility Methods
     */
    private generateDocId(n: number): string {
        return Array.from({ length: n }, () => ((16 * Math.random()) | 0).toString(16)).join('');
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private waitForDomChange(target: HTMLElement, timeout = 2000, interval = 200): Promise<boolean> {
        return new Promise((resolve, reject) => {
            let timer: NodeJS.Timeout;
            const observer = new MutationObserver(() => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    observer.disconnect();
                    resolve(true);
                }, interval);
            });

            observer.observe(target, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true
            });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`timeout ${timeout}ms`));
            }, timeout);
        });
    }

    /**
     * Generate TOC HTML
     * @param settings TOC settings
     * @param book Book info
     * @returns TOC HTML string
     */
    public generateTOC(settings: any, book: Book): string {
        if (!settings?.tocEnabled) return '';

        const headings = this.collectHeadings();

        if (headings.length === 0) return '';

        let tocHtml = `
            <div class="table-of-contents" style="
                page-break-after: ${settings.tocPageBreak ? 'always' : 'auto'};
                font-family: ${settings.tocFontFamily || 'serif'};
                font-size: ${settings.tocFontSize}px;
                color: ${settings.tocColor || '#000000'};
                margin: 20px 0;
                line-height: ${settings.tocLineHeight};
            ">
                <h1 style="text-align: center; margin-bottom: 30px;">${settings.tocTitle}</h1>
                <div class="toc-content">
        `;

        headings.forEach(heading => {
            if (heading.level <= settings.tocMaxLevel) {
                const indent = (heading.level - 1) * (settings.tocIndent || settings.tocIndentSize || 20);
                tocHtml += `
                    <div class="toc-item" style="
                        margin-left: ${indent}px;
                        margin-bottom: 8px;
                        display: flex;
                        justify-content: space-between;
                        align-items: baseline;
                    ">
                        <span class="toc-text">${heading.text}</span>
                        <span class="toc-dots" style="
                            flex: 1;
                            border-bottom: 1px dotted #ccc;
                            margin: 0 10px;
                            height: 1px;
                            align-self: center;
                        "></span>
                        <span class="toc-page" data-heading-id="${heading.id}">?</span>
                    </div>
                `;
            }
        });

        tocHtml += `
                </div>
            </div>
        `;

        return tocHtml;
    }

    /**
     * Collect all headings from documents
     * @returns Array of headings
     */
    private collectHeadings(): Array<{ level: number, text: string, id: string }> {
        interface Heading {
            level: number;
            text: string;
            id: string;
        }
        const headings: Heading[] = [];

        this.docs.forEach(docData => {
            const { doc } = docData;
            const headingElements = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');

            headingElements.forEach((el, index) => {
                const level = parseInt(el.tagName.substring(1));
                const id = el.id || `heading-${index}`;
                if (!el.id) el.id = id;

                headings.push({
                    level,
                    text: el.textContent?.trim() || '',
                    id
                });
            });
        });

        return headings;
    }
}