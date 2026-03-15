export interface Reference {
    id: string;          // Changed to string to store a randomly generated unique identifier
    text: string;        // Original quoted text
    content: string;     // Referenced content (may include annotations)
    createTime: string;  // Creation timestamp
    order: number;       // Order index within the chapter
}

export interface ChapterReferences {
    chapterId: string;    // Chapter ID
    chapterTitle: string; // Chapter title
    orderPath: number[];  // Ordering path, e.g. [1,2] represents volume 1, chapter 2
    references: Reference[];
}

export interface ReferenceData {
    chapters: ChapterReferences[];
}