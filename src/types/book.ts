
// Book basic information
export interface BookBasicInfo {
    title: string;                // Book title
    subtitle?: string;            // Subtitle
    author: string[];            // Authors (supports multiple)
    projectFolder?: string;      // Virtual folder for grouping in Book Smith UI
    cover?: string;              // Cover image path
    coverSettings?: CoverSettings; // Cover design settings
    desc?: string;               // Book description
    uuid: string;                // Unique identifier
    created_at: string;          // Creation timestamp
    template?: string;           // Template type (default, screenplay, etc.)
}
export interface CoverSettings {
    imageUrl: string;
    scale: number;
    position: { x: number; y: number };
    titleStyle: string;
    authorStyle: string;
    bookSize?: string; // Book size
    // Additional: text content and position info
    customTitle?: string;  // Custom book title text
    customAuthor?: string; // Custom author text
    customSubtitle?: string; // Custom subtitle text
    titlePosition?: { x: number; y: number }; // Title position
    authorPosition?: { x: number; y: number }; // Author position
    subtitlePosition?: { x: number; y: number }; // Subtitle position
    // Additional: detailed style configuration
    titleStyleConfig?: TextStyleConfig;
    authorStyleConfig?: TextStyleConfig;
    subtitleStyleConfig?: TextStyleConfig;
}

// Text style configuration interface
export interface TextStyleConfig {
    fontSize: number;        // Font size
    color: string;          // Text color
    fontWeight: 'normal' | 'bold'; // Font weight
    fontStyle: 'normal' | 'italic'; // Font style
    textShadow?: string;    // Text shadow
    fontFamily?: string;    // Font family
}

// Chapter node structure
export interface ChapterNode {
    id: string;                  // Unique chapter ID
    title: string;               // Chapter title
    type: 'file' | 'group';      // Node type: file or folder
    path: string;                // Node relative path
    order: number;               // Order index
    children?: ChapterNode[];    // Child nodes (folders only)
    default_status: 'draft' | 'editing' | 'done';  // Default status for new chapters
    exclude?: boolean;           // Whether to exclude this node (from stats/export)
    is_expanded?: boolean;       // Folder expanded state
    created_at: string;          // Creation timestamp
    last_modified: string;       // Last modified timestamp
}

// Chapter tree structure
export interface ChapterTree {
    tree: ChapterNode[];         // 章节树
}

export interface BookWritingPeriod {
    id: string;
    name: string;
    start_date: string;
    end_date?: string;
    schedule: {
        mode: 'specific-days' | 'days-per-week';
        selected_weekdays: number[];
        days_per_week: number;
    };
    average_missed_scheduled_days: boolean;
    average_window_days: number;
    created_at: string;
    updated_at: string;
}

// Book statistics
export interface BookStats {
    // Basic stats
    total_words: number;         // Current total words
    target_total_words: number;  // Target total words
    
    // Progress stats
    progress_by_words: number;   // Progress by words
    progress_by_chapter: number; // Progress by chapter completion
    
    // Writing stats
    daily_words: Record<string, number>;  // Daily word counts
    daily_progress?: Record<string, {
        positive_change: number;
        negative_change: number;
        net_change: number;
        words_added?: number;
        words_deleted?: number;
        iteration_deletions?: number;
        old_deletions?: number;
    }>; // Daily net progress breakdown
    daily_comments: Record<string, string>; // Daily writing comments
    writing_periods?: BookWritingPeriod[];
    writing_days: number;        // Total writing days
    average_daily_words: number; // Average daily words
    daily_goal_words?: number;   // Daily goal stored in words for unified conversion
    show_daily_goal_in_today_stat?: boolean; // Show today as current/goal in left pane
    last_writing_date: string;   // Last writing date
    last_modified: string;       // Last modified timestamp
    goal_reached_sound?: string; // Sound to play when goal is reached
    countCommentsInWordCount?: boolean; // Whether to include comments/annotations in word count
}

// Export configuration
export interface BookExportConfig {
    default_format: string;      // 默认导出格式
    template: string;            // 导出模板
    include_cover: boolean;      // 是否包含封面
}

// Complete book structure
export interface Book {
    basic: BookBasicInfo;        // 基本信息
    structure: ChapterTree;      // 结构信息
    stats: BookStats;            // 统计信息
    export: BookExportConfig;    // 导出配置
    navigatorFolder?: string;    // Optional project resource folder path
    focusStats?: {
        dailyMinutes: Record<string, number>;
    };
}