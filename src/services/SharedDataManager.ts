import { App, TFile } from 'obsidian';

interface SharedDataShape {
    sharedDailyComments: Record<string, string>;
    sharedPeriodComments: Record<string, string>;
    projectFolderMap: Record<string, string>;
    projectFolders: string[];
    projectFolderExpanded: Record<string, boolean>;
}

const DEFAULT_SHARED_DATA: SharedDataShape = {
    sharedDailyComments: {},
    sharedPeriodComments: {},
    projectFolderMap: {},
    projectFolders: [],
    projectFolderExpanded: {}
};

export class SharedDataManager {
    private filePath: string;
    private legacyFilePaths: string[] = [];
    private fileName: string;
    private data: SharedDataShape = { ...DEFAULT_SHARED_DATA };

    constructor(private app: App, rootPath: string, legacyRootPaths: string[] = [], fileName: string = 'booksmith-shared.json') {
        this.fileName = fileName;
        this.filePath = this.buildFilePath(rootPath, this.fileName);

        const allLegacyPaths = [
            ...legacyRootPaths.map((root) => this.buildFilePath(root, this.fileName)),
            // Backward compatibility with previous shared filename.
            ...legacyRootPaths.map((root) => this.buildFilePath(root, 'booksmith-shared.json')),
            this.buildFilePath(rootPath, 'booksmith-shared.json')
        ];

        this.legacyFilePaths = allLegacyPaths
            .filter((path, index, arr) => !!path && path !== this.filePath && arr.indexOf(path) === index);
    }

    async load() {
        try {
            const primaryData = await this.readDataFile(this.filePath);
            let mergedData = { ...DEFAULT_SHARED_DATA };
            let foundAny = false;

            for (const legacyPath of this.legacyFilePaths) {
                const legacyData = await this.readDataFile(legacyPath);
                if (legacyData) {
                    mergedData = this.mergeData(mergedData, legacyData);
                    foundAny = true;
                }
            }

            // Primary shared data is the source of truth; legacy files only fill gaps.
            if (primaryData) {
                mergedData = this.mergeData(mergedData, primaryData);
                foundAny = true;
            }

            if (foundAny) {
                this.data = mergedData;
                this.normalizePeriodCommentKeys();
                await this.save();
                return;
            }

            this.data = { ...DEFAULT_SHARED_DATA };
            await this.ensureRootFolder(this.filePath);
            await this.app.vault.create(this.filePath, JSON.stringify(this.data, null, 2));
        } catch (err) {
            console.error('BookSmith shared data load error:', err);
            this.data = { ...DEFAULT_SHARED_DATA };
        }
    }

    async save() {
        try {
            const content = JSON.stringify(this.data || DEFAULT_SHARED_DATA, null, 2);
            const file = this.app.vault.getAbstractFileByPath(this.filePath);

            if (!file) {
                await this.ensureRootFolder(this.filePath);
                await this.app.vault.create(this.filePath, content);
                return;
            }

            if (!(file instanceof TFile)) {
                console.error('BookSmith shared data save error: target path is not a file', this.filePath);
                return;
            }

            await this.app.vault.modify(file, content);
        } catch (err) {
            console.error('BookSmith shared data save error:', err);
        }
    }

    private async readDataFile(path: string): Promise<SharedDataShape | null> {
        const file = this.app.vault.getAbstractFileByPath(path);

            if (!file) {
                return null;
            }

            if (!(file instanceof TFile)) {
                console.error('BookSmith shared data load error: target path is not a file', path);
                return null;
            }

            const content = await this.app.vault.read(file);

            if (!content || content.trim().length === 0) {
                return { ...DEFAULT_SHARED_DATA };
            }

            const parsed = JSON.parse(content) as Partial<SharedDataShape>;
            return {
                sharedDailyComments: parsed.sharedDailyComments || {},
                sharedPeriodComments: parsed.sharedPeriodComments || {},
                projectFolderMap: parsed.projectFolderMap || {},
                projectFolders: parsed.projectFolders || [],
                projectFolderExpanded: parsed.projectFolderExpanded || {}
            };
    }

    getComments(): Record<string, string> {
        return { ...(this.data?.sharedDailyComments || {}) };
    }

    getPeriodComments(): Record<string, string> {
        return { ...(this.data?.sharedPeriodComments || {}) };
    }

    getProjectFolderMap(): Record<string, string> {
        return { ...(this.data?.projectFolderMap || {}) };
    }

    getProjectFolders(): string[] {
        const folderSet = new Set<string>(this.data?.projectFolders || []);
        Object.values(this.data?.projectFolderMap || {}).forEach((folder) => {
            const normalized = this.normalizeFolder(folder);
            if (normalized) folderSet.add(normalized);
        });
        return Array.from(folderSet).sort((a, b) => a.localeCompare(b));
    }

    setComment(date: string, text: string) {
        const trimmed = text.trim();
        if (!this.data || !this.data.sharedDailyComments) {
            this.data = { ...DEFAULT_SHARED_DATA };
        }

        if (!trimmed) {
            delete this.data.sharedDailyComments[date];
            return;
        }

        this.data.sharedDailyComments[date] = trimmed;
    }

    setPeriodComment(key: string, text: string) {
        const trimmed = text.trim();
        if (!this.data || !this.data.sharedPeriodComments) {
            this.data = { ...DEFAULT_SHARED_DATA };
        }

        if (!trimmed) {
            delete this.data.sharedPeriodComments[key];
            return;
        }

        this.data.sharedPeriodComments[key] = trimmed;
    }

    addProjectFolder(folder: string) {
        const normalized = this.normalizeFolder(folder);
        if (!normalized) return;

        if (!this.data) {
            this.data = { ...DEFAULT_SHARED_DATA };
        }

        if (!this.data.projectFolders) {
            this.data.projectFolders = [];
        }

        if (!this.data.projectFolders.includes(normalized)) {
            this.data.projectFolders.push(normalized);
            this.data.projectFolders.sort((a, b) => a.localeCompare(b));
        }
    }

    setProjectFolder(bookId: string, folder: string) {
        if (!this.data || !this.data.projectFolderMap) {
            this.data = { ...DEFAULT_SHARED_DATA };
        }

        const normalized = this.normalizeFolder(folder);
        if (!normalized) {
            delete this.data.projectFolderMap[bookId];
            return;
        }

        this.data.projectFolderMap[bookId] = normalized;
        this.addProjectFolder(normalized);
    }

    isProjectFolderExpandedByDefault(folder: string): boolean {
        const key = this.getFolderPreferenceKey(folder);
        const expandedMap = this.data?.projectFolderExpanded || {};
        if (Object.prototype.hasOwnProperty.call(expandedMap, key)) {
            return !!expandedMap[key];
        }
        return true;
    }

    isProjectFolderPinned(folder: string): boolean {
        const key = this.getFolderPreferenceKey(folder);
        return Object.prototype.hasOwnProperty.call(this.data?.projectFolderExpanded || {}, key);
    }

    setProjectFolderExpandedByDefault(folder: string, expanded: boolean) {
        if (!this.data || !this.data.projectFolderExpanded) {
            this.data = { ...DEFAULT_SHARED_DATA };
        }
        const key = this.getFolderPreferenceKey(folder);
        this.data.projectFolderExpanded[key] = expanded;
    }

    clearProjectFolderExpandedByDefault(folder: string) {
        if (!this.data || !this.data.projectFolderExpanded) {
            this.data = { ...DEFAULT_SHARED_DATA };
        }
        const key = this.getFolderPreferenceKey(folder);
        delete this.data.projectFolderExpanded[key];
    }

    mergeComments(comments: Record<string, string>) {
        if (!this.data || !this.data.sharedDailyComments) {
            this.data = { ...DEFAULT_SHARED_DATA };
        }

        this.data.sharedDailyComments = {
            ...this.data.sharedDailyComments,
            ...comments
        };
    }

    mergePeriodComments(comments: Record<string, string>) {
        if (!this.data || !this.data.sharedPeriodComments) {
            this.data = { ...DEFAULT_SHARED_DATA };
        }

        this.data.sharedPeriodComments = {
            ...this.data.sharedPeriodComments,
            ...comments
        };
    }

    private normalizeFolder(folder: string): string {
        return folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    }

    private getFolderPreferenceKey(folder: string): string {
        const normalized = this.normalizeFolder(folder);
        return normalized || '__root__';
    }

    private mergeData(base: SharedDataShape, incoming: SharedDataShape): SharedDataShape {
        const folderSet = new Set<string>([...(base.projectFolders || []), ...(incoming.projectFolders || [])]);

        return {
            sharedDailyComments: {
                ...(base.sharedDailyComments || {}),
                ...(incoming.sharedDailyComments || {})
            },
            sharedPeriodComments: {
                ...(base.sharedPeriodComments || {}),
                ...(incoming.sharedPeriodComments || {})
            },
            projectFolderMap: {
                ...(base.projectFolderMap || {}),
                ...(incoming.projectFolderMap || {})
            },
            projectFolders: Array.from(folderSet),
            projectFolderExpanded: {
                ...(base.projectFolderExpanded || {}),
                ...(incoming.projectFolderExpanded || {})
            }
        };
    }

    private normalizePeriodCommentKeys() {
        if (!this.data || !this.data.sharedPeriodComments) return;

        const normalizedMap: Record<string, string> = {};
        Object.entries(this.data.sharedPeriodComments).forEach(([key, value]) => {
            const parts = key.split('|');
            if (parts.length === 3) {
                const migratedKey = `${parts[1]}|${parts[2]}`;
                if (!Object.prototype.hasOwnProperty.call(normalizedMap, migratedKey)) {
                    normalizedMap[migratedKey] = value;
                }
                return;
            }

            normalizedMap[key] = value;
        });

        this.data.sharedPeriodComments = normalizedMap;
    }

    private buildFilePath(rootPath: string, fileName: string): string {
        const normalizedRoot = (rootPath || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        return normalizedRoot ? `${normalizedRoot}/${fileName}` : fileName;
    }

    private async ensureRootFolder(path: string) {
        const separatorIndex = path.lastIndexOf('/');
        if (separatorIndex < 0) return;

        const rootPath = path.slice(0, separatorIndex);
        if (!rootPath) return;

        const segments = rootPath.split('/').filter(Boolean);
        let current = '';
        for (const segment of segments) {
            current = current ? `${current}/${segment}` : segment;
            if (!this.app.vault.getAbstractFileByPath(current)) {
                await this.app.vault.createFolder(current);
            }
        }
    }
}
