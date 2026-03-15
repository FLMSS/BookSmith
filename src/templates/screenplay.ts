import { ChapterTree } from '../types/book';

export const screenplayTemplate: ChapterTree = {
    tree: [
        {
            id: 'title-page',
            title: 'Title Page',
            type: 'file',
            path: 'Title Page.md',
            order: 0,
            default_status: 'draft',
            created_at: new Date().toISOString(),
            last_modified: new Date().toISOString()
        },
        {
            id: 'epigraph',
            title: 'Epigraph',
            type: 'file',
            path: 'Epigraph.md',
            order: 1,
            default_status: 'draft',
            created_at: new Date().toISOString(),
            last_modified: new Date().toISOString()
        },
        {
            id: 'act1',
            title: 'ACT I',
            type: 'group',
            path: 'ACT I',
            order: 2,
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
            order: 3,
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
            order: 4,
            default_status: 'draft',
            is_expanded: false,
            created_at: new Date().toISOString(),
            last_modified: new Date().toISOString(),
            children: []
        }
    ]
};
