import { ChapterTree } from '../types/book';

export const defaultTemplate: ChapterTree = {
    tree: [
        {
            id: 'epigraph',
            title: 'Epigraph',
            type: 'file',
            path: 'Epigraph.md',
            order: 0,
            default_status: 'draft',
            created_at: new Date().toISOString(),
            last_modified: new Date().toISOString()
        },
        {
            id: 'act1',
            title: 'ACT I',
            type: 'group',
            path: 'ACT I',
            order: 1,
            default_status: 'draft',
            is_expanded: false,
            created_at: new Date().toISOString(),
            last_modified: new Date().toISOString(),
            children: []
        },
        {
            id: 'act2',
            title: 'ACT II',
            type: 'group',
            path: 'ACT II',
            order: 2,
            default_status: 'draft',
            is_expanded: false,
            created_at: new Date().toISOString(),
            last_modified: new Date().toISOString(),
            children: []
        },
        {
            id: 'act3',
            title: 'ACT III',
            type: 'group',
            path: 'ACT III',
            order: 3,
            default_status: 'draft',
            is_expanded: false,
            created_at: new Date().toISOString(),
            last_modified: new Date().toISOString(),
            children: []
        }
    ]
};