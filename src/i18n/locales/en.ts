import {
    Translation,
    CommonTranslation,
    BookSmithViewTranslation,
    ToolViewTranslation,
    SettingsTranslation,
    ModalTranslation,
    ManagerTranslation,
    ToolbarModalTranslation,
    ComponentTranslation
} from '../interfaces';

// 通用翻译
const commonTranslation: CommonTranslation = {
    PLUGIN_NAME: 'BookSmith',
    SETTINGS: 'Settings',
    SAVE: 'Save',
    CANCEL: 'Cancel',
    HIDE: 'Hide',
    SHOW: 'Show',

    OPEN_BOOK_PANEL: 'Open book panel',
    OPEN_TOOL_PANEL: 'Open tool panel',
    OPEN_ALL_PANELS: 'Open all panels',

    PREFACE: 'Preface',
    OUTLINE: 'Outline',
    VOLUME_1: 'Volume 1',
    CHAPTER_1: 'Chapter 1',
    CHAPTER_2: 'Chapter 2',
    AFTERWORD: 'Afterword',
    TEMPLATE_OPTIONS_DESC: 'Standard structure with preface, outline, chapters and afterword'
};

// 书籍管理视图翻译
const bookSmithViewTranslation: BookSmithViewTranslation = {
    // 主界面
    BOOK_MANAGER: 'Book Smith',
    NEW_BOOK: 'New Project',
    SWITCH_BOOK: 'Switch Project',
    MANAGE_BOOK: 'Manage Projects',

    // 书籍相关
    BOOK_TITLE: 'Title',
    BOOK_AUTHOR: 'Author',
    BOOK_DESCRIPTION: 'Description',
    BOOK_TAGS: 'Tags',
    BOOK_COVER: 'Cover',

    // 章节相关
    CHAPTER: 'Chapter',
    ADD_CHAPTER: 'Add chapter',
    DELETE_CHAPTER: 'Delete chapter',
    RENAME_CHAPTER: 'Rename chapter',

    // 统计相关
    STATS: 'Statistics',
    WORD_COUNT: 'Word count',
    CHAPTER_COUNT: 'Chapter count',

    // 帮助提示
    HELP_TOOLTIP: `👋 Welcome to BookSmith

BookSmith helps you organize and compile long-form writing inside Obsidian.

This version is a fork of the excellent plugin by Yeban, streamlined for prose and screenwriting workflows.

🚀 Getting Started

• Open the Writing Toolbox on the right
• Use Focus Mode for distraction-free writing
• Use Export to compile your manuscript

🗂 Manuscript Organization

• View your manuscript structure
• Drag & drop chapters, acts, or scenes to reorder them

📦 Export

Compile your project into a single file:

• Markdown (.md) for prose
• Fountain (.fountain) for screenplays

Options can remove comments, links, and frontmatter.

🔌 Recommended Plugins

• Fountain Editor (ChuangCaleb) - screenplay editing
• Continuous Mode - view multiple notes as one document`,

    // 通知消息
    SWITCHED_TO_BOOK: 'Switched to "{title}"',
    IMPORTED_AND_SWITCHED: 'Imported and switched to new book',
    CURRENT_BOOK_DELETED: 'Current book has been deleted',
    NO_BOOKS_TO_SWITCH: 'No books available to switch',

    // 统计文本
    TODAY_WORDS: 'Today',
    TOTAL_WORDS: 'Total Words',
    CHAPTER_COMPLETION: 'Completion',
    WRITING_DAYS: 'Writing Days',
    AVERAGE_DAILY_WORDS: 'Daily Average',
    WORD_UNIT: ' words',
    DAY_UNIT: ' days',
    TEN_THOUSAND: 'K',

    // 空状态提示
    WELCOME_MESSAGE: '👋 Welcome to BookSmith',
    EMPTY_STATE_HINT: 'Click "New" above to create a work, or use the "Switch" button to select an existing book'
};

// 工具箱视图翻译
const toolViewTranslation: ToolViewTranslation = {
    WRITING_TOOLBOX: 'BookSmith+',
    BACK_TO_TOOLBOX: 'Back to Menu',
    WRITING_STATS_CALENDAR: 'Stats',
    GLOBAL_STATS: 'Global Stats',
    SELECT_PROJECT: 'Select Project',
    NO_ACTIVE_BOOK: 'Select a book first to view writing statistics.',
    PREVIOUS_MONTH: 'Previous',
    NEXT_MONTH: 'Next',
    DISPLAY_MODE: 'Display',
    WRITING_STATS_MODE: 'Writing stats',
    PROGRESS_DISPLAY_TYPE: 'Progress Display Type',
    PROGRESS_DISPLAY: 'Progress Display',
    PROGRESS_DISPLAY_TYPE_DESC: 'Choose how progress is interpreted in the left pane and the mini widget.',
    PROGRESS_DISPLAY_TYPE_INFO: 'Most writing software only shows net word count change. If you start the day with 10,000 words and end with 10,000 words, the tracker simply shows: 0\n\nThat number alone does not tell you what actually happened during the day. The New Material metric shows your net progress plus useful context about how the manuscript changed.\n\nExample:\n0 (+10000 | -10000)\n\nThe net is still 0, but the additional data reveals that you rewrote an entire 10,000-word scene.\n\n🟣 Purple: new material written that day\n🔴 Red: older material removed from the manuscript\n\nPurple values can only increase, and red values can only decrease, making it easy to see what kind of work happened.',
    PROGRESS_MODE_NET_HINT: 'New Material (Net) (Default)\nShows net manuscript progress as the main number, with a breakdown of new material written and old material removed.\nThis is the recommended view for most writing.\n\n🟣 New material\n🔴 Old material removed\n\nExample:\n+3\n(+4 | -1)',
    PROGRESS_MODE_DAILY_HINT: 'New Material (Daily Output)\nShows new material written today as the main number.\nNet manuscript change is still shown, but as secondary context.\n\n🟣 New material\n🔴 Old material removed\n\nExample:\n+4\n(+4 | -1)',
    PROGRESS_MODE_RAW_HINT: 'Raw Data\nShows all writing and deletions exactly as they occurred, counting daily iteration as full writing activity.\n\n🟣 Additions\n🔴 Deletions\n\nExample:\n+3\n(+5 | -2)',
    STATS_PERIOD: 'Period',
    WORDS_MODE: 'Words',
    PAGES_MODE: 'Pages',
    POMODOROS_MODE: 'Pomodoros',
    HOURS_MODE: 'Hours',
    NEW_MATERIAL_NET_MODE: 'New Material (Net)',
    NEW_MATERIAL_DAILY_OUTPUT_MODE: 'New Material (Daily Output)',
    RAW_DATA_MODE: 'Raw Data',
    PERIOD_DAY: 'Day',
    PERIOD_WEEK: 'Week',
    PERIOD_MONTH: 'Month',
    PERIOD_YEAR: 'Year',
    WORDS_PER_PAGE: 'Words Per Page',
    APPLY_STATS_SETTINGS: 'Apply',
    JUMP_TO_YEAR: 'Go',
    INVALID_YEAR: 'Please enter a valid year.',
    WORDS_WRITTEN_ON: '{date}: {words} words written',
    PAGES_WRITTEN_ON: '{date}: {pages} pages written',
    WORDS_WRITTEN_IN_PERIOD: '{period}: {words} words written',
    PAGES_WRITTEN_IN_PERIOD: '{period}: {pages} pages written',
    POMODOROS_IN_PERIOD: '{period}: {pomodoros} pomodoros completed',
    NO_WRITING_RECORD: 'No words recorded for the selected day.',
    NO_WRITING_RECORD_PERIOD: 'No words recorded for the selected period.',
    NO_POMODORO_RECORD_PERIOD: 'No focus sessions recorded for the selected period.',
    ENTER_WORDS_PER_PAGE: 'Average Words Per Page?',
    INVALID_WORDS_PER_PAGE: 'Please enter a valid number greater than 0.',
    WORD_UNIT_SHORT: 'w',
    PAGE_UNIT_SHORT: 'p',
    POMODORO_UNIT_SHORT: 'pomo',
    HOURS_UNIT_SHORT: 'h',
    DAY_COMMENT: 'How did writing go today?',
    DAY_COMMENT_PLACEHOLDER: 'Write a quick reflection for this day...',
    SAVE_DAY_COMMENT: 'Save comment',
    DAY_COMMENT_SAVED: 'Day comment saved',
    NAVIGATOR: 'Navigator',
    NAVIGATOR_REFRESH: 'Refresh Navigator',
    NAVIGATOR_NOT_SET_TITLE: 'No Navigator folder set for this project.',
    NAVIGATOR_NOT_SET_DESC: 'Select a folder to use as the project resource navigator.',
    NAVIGATOR_NO_FILES: 'No supported files found in the selected folder.',
    NAVIGATOR_FOLDER_SAVED: 'Navigator folder saved for this project.',
    NAVIGATOR_SELECT_FOLDER: 'Select Navigator Folder',
    NAVIGATOR_FOLDER_SEARCH_PLACEHOLDER: 'Search folders...',
    NAVIGATOR_NO_MATCHING_FOLDERS: 'No matching folders',
    SELECT_FOLDER: 'Select Folder',

    // 写作助手
    WRITING_ASSISTANT: 'Writing assistant',
    FOCUS_MODE: 'Focus Mode',
    FOCUS_SELECT_PROJECT: 'Select Focus Project',
    FOCUS_UNASSIGNED: 'Unassigned',
    CREATIVE_INSPIRATION: 'Creative inspiration',
    CHARACTER_PROFILES: 'Character profiles',
    WORLD_BUILDING: 'World building',

    // 导出发布
    EXPORT_PUBLISH: 'Export & publish',
    DESIGN_TYPOGRAPHY: 'Export',
    GENERATE_EBOOK: 'Export',
    MORE_FEATURES: 'More features...',
    MORE_FEATURES_MESSAGE: 'More features coming with your participation',

    // 写作圈子
    WRITING_COMMUNITY: 'Writing community',
    CREATIVE_COMMUNITY: 'Creative community',
    CONTACT_AUTHOR: 'Contact author',
    DONATE_SUPPORT: 'Donate & support',

    // 面板设置
    PANEL_SETTINGS: 'Panel settings',
    FEATURE_COMING_SOON: '{feature} feature coming soon'
};

// 设置面板翻译
const settingsTranslation: SettingsTranslation = {
    PLUGIN_NAME: 'Book Smith',
    BASIC_OPTIONS: 'Basic options',
    TEMPLATE_OPTIONS: 'Template options',
    WRITING_TOOLS_OPTIONS: 'Writing tools options',

    // Basic Settings
    LANGUAGE_SETTING: 'Language',
    LANGUAGE_DESC: 'Choose plugin language / 选择插件界面语言',
    DEFAULT_AUTHOR: 'Default author',
    DEFAULT_AUTHOR_DESC: 'Default author name for new books',
    DEFAULT_AUTHOR_PLACEHOLDER: 'Enter default author name',
    BOOK_STORAGE_PATH: 'Book storage path',
    BOOK_STORAGE_DESC: 'Default storage path for new books',
    STORAGE_PATH_CHANGED: 'Storage path changed, please restart Obsidian or reload for changes to take effect',

    // Template Settings
    DEFAULT_TEMPLATE: 'Prose',
    DEFAULT_TEMPLATE_DESC: 'Prose template used when creating new books',
    BOOK_TEMPLATES: 'Book templates',
    ADD_NEW_TEMPLATE: 'Add new template',
    EDIT_TEMPLATE: 'Edit template',
    DELETE_TEMPLATE: 'Delete template',
    DELETE_TEMPLATE_TITLE: 'Delete template',
    DELETE_TEMPLATE_DESC: 'Are you sure you want to delete this template? This action cannot be undone.',

    // Writing Tools Settings
    FOCUS_MODE_OPTIONS: 'Focus mode options',
    FOCUS_DURATION: 'Focus duration',
    FOCUS_DURATION_DESC: 'Work duration for each focus session (minutes)',
    BREAK_DURATION: 'Break duration',
    BREAK_DURATION_DESC: 'Break duration after each focus session (minutes)',
    WORD_GOAL: 'Word goal',
    WORD_GOAL_DESC: 'Target word count for each focus session',
    WRITING_DAY_ENDS_AT: 'Writing day ends at',
    WRITING_DAY_ENDS_AT_DESC: 'Writing tracked before this time counts toward the previous day.'
};

// 模态框翻译
const modalTranslation: ModalTranslation = {
    // Common
    COVER: 'Cover',
    COVER_DESC: 'Select cover image (optional)',
    BOOK_TITLE: 'Title',
    BOOK_TITLE_DESC: 'Please enter book title',
    BOOK_TITLE_PLACEHOLDER: 'Book title',
    SUBTITLE: 'Subtitle',
    SUBTITLE_DESC: 'Optional',
    SUBTITLE_PLACEHOLDER: 'Subtitle',
    TARGET_UNIT: 'Target Unit',
    TARGET_UNIT_DESC: 'Choose whether the target value is entered as words or pages.',
    TARGET_UNIT_PAGES_DESC: 'Used when Target Unit is Pages. Shared with right-side statistics settings.',
    TARGET_VALUE_DESC: 'Set target in the selected unit.',
    TARGET_WORD_COUNT: 'Target Word Count',
    TARGET_PAGE_COUNT: 'Target Page Count',
    TARGET_WORDS: 'Target Word Count',
    TARGET_WORDS_DESC: 'Set estimated total word count (enter the full number, e.g., 10000)',
    TARGET_WORDS_PLACEHOLDER: 'e.g., 12000',
    AUTHOR: 'Author',
    AUTHOR_DESC: 'Enter author names, separate multiple authors with commas',
    AUTHOR_PLACEHOLDER: 'Author',
    DESCRIPTION: 'Description',
    DESCRIPTION_DESC: 'Please enter book description',
    DESCRIPTION_PLACEHOLDER: 'Book description',
    REQUIRED_FIELDS: 'Please fill in required fields',

    // CreateBookModal
    CREATE_BOOK_TITLE: 'Create New Project',
    BOOK_TEMPLATE: 'Template',
    TEMPLATE_CHECK_DESC: 'Please select a book template',
    SELECT_IMAGE: 'Select image',
    COVER_UPLOAD_SUCCESS: 'Cover uploaded successfully',
    COVER_UPLOAD_FAILED: 'Cover upload failed: ',
    CREATE: 'Create',
    CREATE_SUCCESS: 'Book created successfully',
    CREATE_FAILED: 'Creation failed: ',

    // EditBookModal
    EDIT_BOOK_TITLE: 'Edit Project',
    CHANGE_COVER: 'Change cover',
    SELECT_COVER: 'Select cover',
    COVER_UPDATE_SUCCESS: 'Cover updated successfully',
    COVER_UPDATE_FAILED: 'Failed to update cover: ',
    SAVE: 'Save',
    SAVE_SUCCESS: 'Saved successfully',
    SAVE_FAILED: 'Save failed: ',

    // ManageBooksModal
    MANAGE_BOOKS_TITLE: 'Manage Projects',
    SEARCH_BOOKS_PLACEHOLDER: 'Search books...',
    IMPORT_BOOK: 'Import Project',
    BOOK_AUTHOR_PREFIX: 'Author: ',
    BOOK_DESC_PREFIX: '\nDescription: ',
    BOOK_PROGRESS_PREFIX: '\nProgress: ',
    DELETE_BOOK: 'Delete',
    EDIT_BOOK: 'Edit',
    DELETE_BOOK_TITLE: 'Delete book',
    DELETE_BOOK_DESC: 'Are you sure you want to delete "{title}"?\nThis action cannot be undone.',
    DELETE_SUCCESS: 'Deleted successfully',
    DELETE_FAILED: 'Delete failed: ',
    BOOKS_ROOT_NOT_FOUND: 'Books root directory does not exist or is inaccessible',
    NO_UNIMPORTED_BOOKS: 'No unimported book directories found',
    DETECT_UNIMPORTED_FAILED: 'Failed to detect unimported books: ',
    IMPORT_SUCCESS: 'Successfully imported book "{title}"',
    IMPORT_FAILED: 'Failed to create book configuration: ',

    // SwitchBookModal
    SWITCH_BOOK_TITLE: 'Switch Project',
    SEARCH_BOOK_PLACEHOLDER: 'Search books...',
    BOOK_AUTHOR_LABEL: 'Author',
    BOOK_PROGRESS_LABEL: 'Progress',
    BOOK_WORDCOUNT_LABEL: 'Words',
    BOOK_LASTMOD_LABEL: 'Last modified',
    SELECT_BOOK: 'Select',

    // UnimportedBooksModal
    UNIMPORTED_BOOKS_TITLE: 'Select book directory to import',
    NO_UNIMPORTED_FOLDERS: 'No unimported book directories found',
    CLOSE: 'Close',
    SEARCH_FOLDERS_PLACEHOLDER: 'Search directories...',
    NO_MATCHING_FOLDERS: 'No matching directories',
    IMPORT: 'Import',
    SELECT_FOLDER_FIRST: 'Please select a directory first',

    // ReferenceModal
    REFERENCE_MODAL_TITLE: 'Add reference',
    REFERENCE_CONTENT: 'Reference content',
    REFERENCE_CONTENT_DESC: 'Please enter the details of the reference',

    // NamePromptModal
    NAME_LABEL: 'Name',
    CONFIRM: 'Confirm',
    CANCEL: 'Cancel',

    // TemplateEditModal
    TEMPLATE_EDIT_TITLE: 'Edit template',
    TEMPLATE_CREATE_TITLE: 'Create template',
    TEMPLATE_NAME: 'Template name',
    TEMPLATE_NAME_PLACEHOLDER: 'Enter template name',
    TEMPLATE_DESC: 'Template description',
    TEMPLATE_DESC_PLACEHOLDER: 'Describe the template structure',
    TEMPLATE_STRUCTURE: 'Chapter tree',
    ADD_FILE: 'Add file',
    ADD_FOLDER: 'Add folder',
    DELETE_FOLDER_CONFIRM: 'Are you sure you want to delete this folder and all its contents?',
    NEW_CHAPTER: 'New chapter',
    NEW_DIRECTORY: 'New directory',
    ENTER_NAME_PLACEHOLDER: 'Enter name',
    TEMPLATE_NAME_REQUIRED: 'Please enter template name',
    TEMPLATE_NODE_REQUIRED: 'Please add at least one node',
    TEMPLATE_NAME_EXISTS: 'Template with this name already exists',
    TEMPLATE_SAVE_SUCCESS: 'Template saved successfully',
    TEMPLATE_SAVE_FAILED: 'Failed to save template, check console for details',
    
    // ExportModal
    EXPORT_BOOK_TITLE: 'Export Project',
    PDF_FORMAT_DESC: 'Portable Document Format',
    MARKDOWN_FORMAT_DESC: 'Export as a single Markdown (.md) file',
    FOUNTAIN_FORMAT_DESC: 'Export as a single Fountain (.fountain) file',
    DOCX_FORMAT_DESC: 'Word document format',
    REMOVE_COMMENTS: 'Remove comments',
    REMOVE_LINKS: 'Remove links',
    REMOVE_FRONTMATTER: 'Remove frontmatter',
    SELECT_EXPORT_FORMAT_FIRST: 'Please select export format first',
    
    // BookSelectionModal
    SELECT_BOOKS_TO_EXPORT: 'Select Project to Export',
    EXPORT_SETTINGS: 'Export settings',
    NO_BOOKS_FOUND: 'No books found',
    CREATE_BOOK_FIRST_TO_EXPORT: 'Please create a book first before exporting',
    CREATED_DATE: 'Created date',
    SELECT_BOOK_FIRST_TO_EXPORT: 'Please select a book first',
    LOAD_BOOKS_FAILED: 'Failed to load book list',
    OPEN_EXPORT_FAILED: 'Failed to open export modal'
};

const managerTranslation: ManagerTranslation = {
    // BookManager related
    BOOK_EXISTS: 'Book already exists',
    BOOK_NOT_FOUND: 'Book not found',
    BOOK_FOLDER_NOT_FOUND: 'Book folder not found',
    SAVE_CONFIG_FAILED: 'Failed to save configuration file',
    IMPORT_BOOK_FAILED: 'Failed to import book',
    UNKNOWN_AUTHOR: 'Unknown author',

    // TemplateManager related
    TEMPLATE_TYPE_NOT_FOUND: 'Template "{type}" does not exist',
    TEMPLATE_EXISTS: 'Template already exists',
    TEMPLATE_SAVE_FAILED: 'Failed to save template',

    // FileManager related
    CREATE_FOLDER_FAILED: 'Failed to create folder',
    CREATE_FILE_FAILED: 'Failed to create file',
    READ_FILE_FAILED: 'Failed to read file',
    WRITE_FILE_FAILED: 'Failed to write file',

    // FocusManager related
    BREAK_TIME_START: 'Break time started',
    FOCUS_SUMMARY: 'Focus completed!\nDuration: {duration} minutes\nInterruptions: {interruptions}\nWords written: {words}',

    // ReferenceManager 相关
    REFERENCE_FILE_NAME: 'references.md',
    REFERENCE_FILE_NOT_FOUND: 'Please create "references.md" file in the book directory first',
    REFERENCE_FILE_ERROR: 'Reference file does not exist or type error',
    SELECT_TEXT_TO_REFERENCE: 'Please select text to reference',
    CHAPTER_INFO_ERROR: 'Unable to get current chapter information',

    // ReferenceManager 菜单项
    EDIT_REFERENCE: 'Edit reference',
    DELETE_REFERENCE: 'Delete reference',
    INSERT_REFERENCE: 'Insert reference'
};

const toolbarModalTranslation: ToolbarModalTranslation = {
    // CommunityModal
    COMMUNITY_TITLE: 'Writing community',
    COMMUNITY_INTRO: 'Join the Billion Writes community to connect with other writers, get inspiration and feedback.',
    FEATURE_SHARE_TITLE: 'Share works',
    FEATURE_SHARE_DESC: 'Share your creations and get reader feedback',
    FEATURE_DISCUSS_TITLE: 'Writing exchange',
    FEATURE_DISCUSS_DESC: 'Discuss writing techniques with other creators',
    FEATURE_CHALLENGE_TITLE: 'Writing challenges',
    FEATURE_CHALLENGE_DESC: 'Participate in community writing challenges to improve your skills',
    JOIN_SECTION_TITLE: 'How to join',
    JOIN_SECTION_DESC: 'Copy and search the official account below',
    OFFICIAL_ACCOUNT: 'Official account: BilionWrites',
    COPY_ACCOUNT: 'Copy account',

    // ContactModal
    ABOUT_AUTHOR: 'About author',
    AUTHOR_INTRO_1: 'Hello, I\'m Yeban, a full-time writer and independent developer.',
    AUTHOR_INTRO_2_1: 'This plugin is ',
    AUTHOR_INTRO_2_2: 'a tool I developed to help authors write long-form content in Obsidian',
    AUTHOR_INTRO_2_3: ', hoping to ',
    AUTHOR_INTRO_2_4: 'make your writing process smoother and more enjoyable',
    AUTHOR_INTRO_2_5: '.',
    AUTHOR_INTRO_3: 'If this plugin helps with your writing, or if you\'d like to support my independent development and creation, feel free to buy me a coffee ☕.',
    AUTHOR_INTRO_4_1: 'Your support means a lot',
    AUTHOR_INTRO_4_2: ', it allows me to focus on developing more useful tools to aid your creative journey.',
    DONATE_TEXT: 'Support the author:',
    DONATE_BUTTON: 'Support',
    MORE_INFO_TEXT: 'If you want to learn more about writing, creative techniques, or follow my future work updates, welcome to follow my social media.',
    CONTACT_TITLE: 'Contact:',
    CONTACT_WECHAT_OFFICIAL: 'WeChat official',
    CONTACT_XIAOHONGSHU: 'Xiaohongshu',
    CONTACT_WECHAT: 'WeChat',
    CONTACT_GITHUB: 'GitHub',
    COPY_SUCCESS: '{type} copied to clipboard',
    COPY_FAILED: 'Copy failed, please copy manually: {value}',

    // DonateModal
    DONATE_MODAL_TITLE: 'Support me',
    COMMUNITY_STATS_TITLE: 'Community stats',
    COMMUNITY_STATS_USERS: '1200+ users, 32 supporters',
    COMMUNITY_STATS_WORDS: '5000+ words written daily',

    DONATE_AMOUNT_COFFEE: 'Buy me a coffee',
    DONATE_AMOUNT_CHAPTER: 'Chapter sponsor',
    DONATE_AMOUNT_FEATURE: 'Feature builder',
    DONATE_FEEDBACK_COFFEE: 'Thanks for your coffee support!',
    DONATE_FEEDBACK_CHAPTER: 'You get one vote for new features',
    DONATE_FEEDBACK_FEATURE: 'Join our beta testing group, contact via WeChat official account',

    PAYMENT_WECHAT: 'WeChat pay',
    PAYMENT_ALIPAY: 'Alipay',
    PAYMENT_KOFI: 'Ko-fi',
    CURRENCY_UNIT: 'CNY',

    // TypographyModal
    PREVIEW: 'Preview',
    NO_BOOKS_AVAILABLE: 'No books available',
    LOADING: 'Loading...',
    DEFAULT_FONT: 'Default font',
    SERIF_FONT: 'Serif font',
    SANS_SERIF_FONT: 'Sans-serif font',
    MONOSPACE_FONT: 'Monospace font',
    SONGTI_FONT: 'Songti font',
    HEITI_FONT: 'Heiti font',
    KAITI_FONT: 'Kaiti font',
    FANGSONG_FONT: 'Fangsong font',
    APPLY: 'Apply',
    TYPOGRAPHY_APPLIED: 'Typography applied',
    EXPORT: 'Export',
    SELECT_BOOK_FIRST: 'Please select a book first',
    EXPORT_SUCCESS: 'Export successful',
    EXPORT_FAILED: 'Export failed: ',
    FORMAT: 'Format',
    CUSTOM_SIZE: 'Custom size',
    SELECT_EXPORT_FORMAT: 'Select export format',

    // CoverModal
    DESIGN_COVER: 'Design cover',
    SHOW_COVER: 'Show cover',
    COVER_DESIGN: 'Cover design',
    COVER_IMAGE: 'Cover image',
    CLEAR_IMAGE: 'Clear image',
    BACKGROUND_COLOR: 'Background color',
    OVERLAY: 'Overlay',
    OVERLAY_DESC: 'Add an overlay to the cover',
    OVERLAY_OPACITY: 'Overlay opacity',
    SCALE: 'Scale',
};

const componentTranslation: ComponentTranslation = {
    // ChapterTree
    NEW_FILE: 'New file',
    NEW_FOLDER: 'New folder',
    ENTER_FILE_NAME: 'Enter file name',
    ENTER_FOLDER_NAME: 'Enter folder name',
    OPEN_IN_NEW_TAB: 'Open in new tab',
    OPEN_IN_NEW_PANE: 'Open in new pane',
    OPEN_FOLDER_FILES_IN_ORDER: 'Open all foldered files in order',
    OPEN_ALL_FILES_IN_ORDER: 'Open all files in order',
    NO_FILES_TO_OPEN: 'No files available to open',
    MARK_AS_COMPLETE: 'Mark as complete',
    MARK_AS_DRAFT: 'Mark as draft',
    EXCLUDE_FROM_STATS: 'Exclude from stats',
    INCLUDE_IN_STATS: 'Include in stats',
    CREATE_COPY: 'Create copy',
    COPY_NAME: '{name} copy',
    RENAME: 'Rename',
    DELETE: 'Delete',
    DELETE_FILE_TITLE: 'Delete file',
    DELETE_FILE_DESC: 'Are you sure you want to delete "{title}"?\nIt will be moved to system trash.',
    DELETE_FOLDER_TITLE: 'Delete folder',
    DELETE_FOLDER_DESC: 'Are you sure you want to delete folder "{title}" and all its contents?\nThey will be moved to system trash.',
    COPY_SUCCESS: 'Copy created successfully',
    COPY_FAILED: 'Failed to create copy: {error}',
    RENAME_SUCCESS: 'Renamed successfully',
    RENAME_FAILED: 'Failed to rename: {error}',
    DELETE_SUCCESS: 'Deleted successfully',
    DELETE_FAILED: 'Failed to delete: {error}',
    MOVE_FAILED: 'Failed to move',
    SOURCE_NOT_FOUND: 'Source file not found',
    TARGET_EXISTS: 'File with same name exists at target location',
    TARGET_FOLDER_NOT_FOUND: 'Target folder not found',
    EXCLUDED_NOTICE: '"{title}" has been excluded',
    INCLUDED_NOTICE: '"{title}" has been included',
    ENTER_NEW_NAME: 'Enter new name',

    // FocusToolView
    FOCUS_MODE: 'Focus Mode',
    START_FOCUS: 'Start focus',
    EXIT: 'Exit',
    FOCUS_SESSIONS: 'Focus sessions',
    INTERRUPTIONS: 'Interruptions',
    CURRENT_WORDS: 'Current words',
    WORD_GOAL: 'Word goal',
    TOTAL_FOCUS_WORDS: 'Total focus words',
    PAUSE: 'Pause',
    RESUME: 'Resume',
    END: 'End',
    ENCOURAGEMENT_1: '🎉 Amazing! You\'ve reached your word goal! Keep it up~',
    ENCOURAGEMENT_2: '✨ Excellent! Goal achieved! Let\'s keep moving forward!',
    ENCOURAGEMENT_3: '🌟 Perfect! Goal reached! Maintain this enthusiasm!',
    ENCOURAGEMENT_4: '🎯 Goal achieved! Your persistence is admirable!',
    ENCOURAGEMENT_5: '💪 Outstanding performance! Goal completed! Keep going!',
    EXIT_FOCUS: 'Exit focus',
    EXIT_FOCUS_DESC: 'Are you sure you want to exit? Current focus progress will be lost.',
    END_FOCUS: 'End focus',
    END_FOCUS_DESC: 'Are you sure you want to end focus? This will count as an interruption.',
    FOCUSING: 'Focusing',
    PAUSED: 'Paused',
    BREAK_TIME: 'Break time',
    READY_TO_START: 'Ready to start'
};
// 合并所有翻译
const translation: Translation = {
    ...commonTranslation,
    ...bookSmithViewTranslation,
    ...toolViewTranslation,
    ...settingsTranslation,
    ...modalTranslation,
    ...managerTranslation,
    ...toolbarModalTranslation,
    ...componentTranslation
};


export default translation;
