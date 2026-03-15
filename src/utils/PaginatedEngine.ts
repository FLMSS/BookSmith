/**
 * Base block interface, defines basic operations required for pagination
 */
export interface IBlock {
    type: string;
    isEmpty(): boolean;
    splitTail(minLength?: number): IBlock | null;    // Only allow splitting tail when paginating
    mergeTail(other: IBlock): void;                  // Merge only supports tail merging
    toHTMLElement(): HTMLElement;
    clone(): IBlock;
}

/**
 * Paragraph/TextBlock: supports splitting from the end based on punctuation,
 * falls back to equal-length split when necessary to ensure robust behavior
 */
export class TextBlock implements IBlock {
    type: string;
    content: string;

    constructor(type: string, content: string) {
        this.type = type;
        this.content = content;
    }

    isEmpty(): boolean {
        return this.content.trim().length === 0;
    }

    splitTail(minLength = 40): TextBlock | null {
        if (this.content.length <= minLength * 2) return null;
    
        const punctuation = /[。！？；.?!;]/;
        let splitPoint = -1;
    
        for (let i = this.content.length - minLength; i >= minLength; i--) {
            if (punctuation.test(this.content[i])) {
                splitPoint = i + 1;
                break;
            }
        }
    
        // fallback: if no punctuation found, force split at midpoint
        if (splitPoint === -1) {
            splitPoint = Math.floor(this.content.length / 2);
        }
    
        const head = this.content.slice(0, splitPoint).trim();
        const tail = this.content.slice(splitPoint).trim();
    
        if (tail.length < minLength) return null;
    
        this.content = head;
        return new TextBlock(this.type, tail);
    }

    mergeTail(other: IBlock): void {
        if (other instanceof TextBlock) {
            this.content += other.content;
        }
    }

    toHTMLElement(): HTMLElement {
        const el = document.createElement(this.type);
        el.innerHTML = this.content;
        return el;
    }

    clone(): TextBlock {
        return new TextBlock(this.type, this.content);
    }
}

/**
 * DOMBlock: non-splittable blocks such as lists/tables/blockquote, etc.
 */
export class DOMBlock implements IBlock {
    type: string;
    element: HTMLElement;

    constructor(element: HTMLElement) {
        this.type = element.tagName.toLowerCase();
        this.element = element.cloneNode(true) as HTMLElement;
    }

    isEmpty(): boolean {
        return !this.element.textContent?.trim();
    }
    splitTail(): IBlock | null { return null; }       // DOM块不可分割
    mergeTail(other: IBlock): void { }                 // DOM块不可合并
    toHTMLElement(): HTMLElement {
        return this.element.cloneNode(true) as HTMLElement;
    }
    clone(): DOMBlock {
        return new DOMBlock(this.element);
    }
}

/**
 * ImageBlock: handles image elements; also non-splittable/non-mergeable
 */
export class ImageBlock implements IBlock {
    type: string;
    element: HTMLElement;

    constructor(element: HTMLImageElement) {
        this.type = 'img';
        this.element = element.cloneNode(true) as HTMLElement;
    }

    isEmpty(): boolean { return false; }
    splitTail(): IBlock | null { return null; }
    mergeTail(other: IBlock): void { }
    toHTMLElement(): HTMLElement {
        return this.element.cloneNode(true) as HTMLElement;
    }
    clone(): ImageBlock {
        return new ImageBlock(this.element as HTMLImageElement);
    }
}

/**
 * 单页结构
 */
export class Page {
    blocks: IBlock[] = [];
    element: HTMLElement;
    bookSize: string;

    constructor(bookSize: string = 'a4') {
        this.bookSize = bookSize;
        this.element = this.createPageElement();
    }

    private createPageElement(): HTMLElement {
        const page = document.createElement('div');
        page.classList.add('book-page', `book-size-${this.bookSize}`);
        // Page number placeholder
        const pageNumber = document.createElement('div');
        pageNumber.classList.add('page-number');
        page.appendChild(pageNumber);
        return page;
    }

    addBlock(block: IBlock): void {
        this.blocks.push(block.clone());
        this.element.appendChild(block.toHTMLElement());
    }
    removeLastBlock(): IBlock | null {
        if (!this.blocks.length) return null;
        this.element.removeChild(this.element.lastChild as Node);
        return this.blocks.pop() || null;
    }
    isOverflow(maxHeight: number): boolean {
        return this.element.scrollHeight > maxHeight + 20;
    }
}

/**
 * Extract all content blocks from a DOM container
 */
export function extractBlocks(container: HTMLElement): IBlock[] {
    const blocks: IBlock[] = [];
    const selectors = 'p, h1, h2, h3, h4, h5, h6, ul, ol, pre, blockquote, table, .callout, img';
    const elements = Array.from(container.querySelectorAll(selectors));
    for (const el of elements) {
        if (el.tagName.toLowerCase() === 'img') {
            blocks.push(new ImageBlock(el as HTMLImageElement));
        } else if (['p','h1','h2','h3','h4','h5','h6'].includes(el.tagName.toLowerCase())) {
            const block = new TextBlock(el.tagName.toLowerCase(), el.innerHTML);
            blocks.push(block);
        } else {
            blocks.push(new DOMBlock(el as HTMLElement));
        }
    }
    return blocks;
}

/**
 * Pagination engine
 */
export class PaginatedEngine {
    private container: HTMLElement;
    private pages: Page[] = [];
    private bookSize: string = 'a4';
    private pageHeight: number = 800;

    constructor(container: HTMLElement) {
        this.container = container;
    }

    setOptions(options: { bookSize?: string; pageHeight?: number }) {
        if (options.bookSize) this.bookSize = options.bookSize;
        if (options.pageHeight) this.pageHeight = options.pageHeight;
    }

    /**
    * Main pagination process with extra safety to avoid infinite loops
     */
    paginate(blocks: IBlock[]): number {
        this.container.innerHTML = '';
        this.pages = [];
        const pageHeightMap = {
            'a4': 1123, 'a5': 794, 'b5': 945, '16k': 983, 'custom': 907
        };
        const actualPageHeight = pageHeightMap[this.bookSize as keyof typeof pageHeightMap] || this.pageHeight;

        let currentPage = this.createNewPage();
        let unpaginatedBlocks = blocks.map(b => b.clone());
        let safetyCounter = 0;
        const maxIterations = blocks.length * 6;

        while (unpaginatedBlocks.length > 0 && safetyCounter < maxIterations) {
            safetyCounter++;
            const nextBlock = unpaginatedBlocks[0];
            currentPage.addBlock(nextBlock);
        
            if (currentPage.isOverflow(actualPageHeight)) {
                const removed = currentPage.removeLastBlock();
                if (!removed) break;
        
                let splitBlock = removed;
                let splitSuccess = false;
        
                while (true) {
                    const tail = splitBlock.splitTail?.() ?? null;
                    if (!tail) break;
        
                    currentPage.addBlock(splitBlock);
                    if (!currentPage.isOverflow(actualPageHeight)) {
                        unpaginatedBlocks[0] = tail;
                        splitSuccess = true;
                        break;
                    }
        
                    currentPage.removeLastBlock();
                    splitBlock = tail;
                }
        
                if (!splitSuccess) {
                    unpaginatedBlocks[0] = removed;
                    currentPage = this.createNewPage();
        
                    if (unpaginatedBlocks.length === 1 && unpaginatedBlocks[0] === removed) {
                        currentPage.addBlock(removed);
                        unpaginatedBlocks.shift();
                    }
                }
            } else {
                unpaginatedBlocks.shift();
            }
        }
        return this.pages.length;
    }

    private createNewPage(): Page {
        const page = new Page(this.bookSize);
        this.pages.push(page);
        this.container.appendChild(page.element);
        return page;
    }
    getPages(): Page[] { return this.pages; }
    addPageMarkers(format = "— Page {page} —") {
        this.pages.forEach((page, idx) => {
            const marker = document.createElement('div');
            marker.classList.add('page-marker');
            
                // Format page number as three digits
            const pageNum = (idx + 1).toString().padStart(3, '0');
            
            // Create marker content containing BookSmith label and page number
            const markerContent = document.createElement('div');
            markerContent.classList.add('marker-content');
            
            // Add BookSmith label
            const bookSmithLogo = document.createElement('span');
            bookSmithLogo.classList.add('booksmith-logo');
            bookSmithLogo.textContent = 'BookSmith';
            markerContent.appendChild(bookSmithLogo);
            
            // Add page number
            const pageMarker = document.createElement('span');
            pageMarker.textContent = format.replace("{page}", pageNum);
            markerContent.appendChild(pageMarker);
            
            marker.appendChild(markerContent);
            page.element.appendChild(marker);
        });
    }
}
/**
 * Create a paginated container that simulates a page
 */
export function createNewPage(bookSize: string = 'a4'): HTMLElement {
    const page = document.createElement('div');
    page.classList.add('book-page');
    page.classList.add(`book-size-${bookSize}`);

    // Add page number placeholder element
    const pageNumber = document.createElement('div');
    pageNumber.classList.add('page-number');
    page.appendChild(pageNumber);

    return page;
}

export function generatePaginatedTOC(contentContainer: HTMLElement, bookSize: string = 'a4'): HTMLElement[] {
    const pageHeightMap = {
        'a4': 1123, 'a5': 794, 'b5': 945, '16k': 983, 'custom': 907
    };
    const maxHeight = pageHeightMap[bookSize as keyof typeof pageHeightMap] || 1000;

    const headingsWithPages: Array<{
        level: number;
        text: string;
        id: string;
        pageNumber: number;
    }> = [];

    // Extract headings and corresponding page numbers
    const pages = Array.from(contentContainer.querySelectorAll('.book-page'));
    pages.forEach((page, pageIndex) => {
        const headings = Array.from(page.querySelectorAll('h1, h2, h3'));
        headings.forEach((heading, index) => {
            const level = (heading as HTMLElement).dataset.actualLevel
                ? parseInt((heading as HTMLElement).dataset.actualLevel || '1')
                : parseInt(heading.tagName.substring(1));
            const text = heading.textContent || '';
            const id = `heading-${pageIndex}-${index}`;
            heading.id = id;
            headingsWithPages.push({
                level,
                text,
                id,
                pageNumber: pageIndex + 1
            });
        });
    });

    const tocPages: HTMLElement[] = [];

    // Helper: create a TOC page structure
    const createTocPage = (): {
        page: HTMLElement;
        list: HTMLElement;
    } => {
        const tocPage = document.createElement('div');
        tocPage.classList.add('book-page', 'toc-page', `book-size-${bookSize}`);

        const tocContainer = document.createElement('div');
        const tocTitle = document.createElement('h1');
        tocTitle.textContent = 'Table of Contents';
        tocContainer.appendChild(tocTitle);

        const tocList = document.createElement('div');
        tocList.classList.add('toc-list');
        tocContainer.appendChild(tocList);

        tocPage.appendChild(tocContainer);
        document.body.appendChild(tocPage); // Temporarily append to measure scrollHeight

        return { page: tocPage, list: tocList };
    };

    let { page: currentPage, list: currentList } = createTocPage();
    tocPages.push(currentPage);

    for (let i = 0; i < headingsWithPages.length; ) {
        const { level, text, id, pageNumber } = headingsWithPages[i];

        // Build TOC item
        const listItem = document.createElement('li');
        listItem.classList.add(`toc-level-${level}`);

        const itemContent = document.createElement('div');
        itemContent.classList.add('toc-item-content');

        const link = document.createElement('a');
        link.href = `#${id}`;
        link.textContent = text;
        itemContent.appendChild(link);

        const pageRef = document.createElement('span');
        pageRef.classList.add('toc-page-ref');
        pageRef.textContent = pageNumber.toString().padStart(3, '0');
        itemContent.appendChild(pageRef);

        listItem.appendChild(itemContent);
        currentList.appendChild(listItem);

        // Check for overflow
        if (currentPage.scrollHeight > maxHeight) {
            currentList.removeChild(listItem); // Remove current item

            // Create a new page
            const next = createTocPage();
            currentPage = next.page;
            currentList = next.list;
            tocPages.push(currentPage);

            continue; // Do not advance i; retry this item on next page
        }

        i++; // 成功添加才推进
    }

    // Remove temporary mounts
    tocPages.forEach(p => document.body.contains(p) && p.remove());

    return tocPages;
}