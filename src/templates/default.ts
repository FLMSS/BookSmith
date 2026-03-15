import { ChapterTree } from '../types/book';

export const defaultTemplate: ChapterTree = {
    tree: [
        {
            id: 'preface',
            title: 'Preface',
            type: 'file',
            path: 'Preface.md',
            order: 0,
            default_status: 'draft',
            created_at: new Date().toISOString(),
            last_modified: new Date().toISOString()
        },
        {
            id: 'outline',
            title: 'Outline',
            type: 'file',
            path: 'Outline.md',
            order: 1,
            default_status: 'draft',
            created_at: new Date().toISOString(),
            last_modified: new Date().toISOString()
        },
        {
            id: 'volume1',
            title: 'Volume 1',
            type: 'group',
            path: 'Volume 1',
            order: 2,
            default_status: 'draft',
            is_expanded: true,  // Default to expanded for Volume 1
            created_at: new Date().toISOString(),
            last_modified: new Date().toISOString(),
            children: [
                {
                    id: 'chapter1',
                    title: 'Chapter 1',
                    type: 'file',
                    path: 'Volume 1/Chapter 1.md',
                    order: 0,
                    default_status: 'draft',
                    created_at: new Date().toISOString(),
                    last_modified: new Date().toISOString()
                },
                {
                    id: 'chapter2',
                    title: 'Chapter 2',
                    type: 'file',
                    path: 'Volume 1/Chapter 2.md',
                    order: 1,
                    default_status: 'draft',
                    created_at: new Date().toISOString(),
                    last_modified: new Date().toISOString()
                }
            ]
        },
        {
            id: 'afterword',
            title: 'Afterword',
            type: 'file',
            path: 'Afterword.md',
            order: 3,
            default_status: 'draft',
            created_at: new Date().toISOString(),
            last_modified: new Date().toISOString()
        }
    ]
};