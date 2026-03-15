import { Modal, Setting } from 'obsidian';
import BookSmithPlugin from '../main';

export interface HeaderFooterTocSettings {
    // 页眉设置
    headerEnabled: boolean;
    headerLeft: string;
    headerCenter: string;
    headerRight: string;
    headerFontSize: number;
    headerColor: string;
    headerHeight: number;
    
    // 页脚设置
    footerEnabled: boolean;
    footerLeft: string;
    footerCenter: string;
    footerRight: string;
    footerFontSize: number;
    footerColor: string;
    footerHeight: number;
    
    // 目录设置
    tocEnabled: boolean;
    tocTitle: string;
    tocMaxLevel: number;
    tocFontSize: number;
    tocFontFamily: string;  // 新增：目录字体
    tocColor: string;       // 新增：目录颜色
    tocLineHeight: number;
    tocIndentSize: number;
    tocIndent: number;      // 新增：目录缩进（与tocIndentSize可能重复，需要确认用途）
    tocPageBreak: boolean;
}

export class HeaderFooterTocModal extends Modal {
    private settings: HeaderFooterTocSettings;
    private onSubmit: (settings: HeaderFooterTocSettings) => void;
    private previewElement: HTMLElement | null = null;

    constructor(
        plugin: BookSmithPlugin,
        initialSettings: Partial<HeaderFooterTocSettings>,
        onSubmit: (settings: HeaderFooterTocSettings) => void
    ) {
        super(plugin.app);
        this.onSubmit = onSubmit;
        
        // 初始化默认设置
        this.settings = {
            headerEnabled: true,
            headerLeft: '{{title}}',
            headerCenter: '',
            headerRight: '{{author}}',
            headerFontSize: 15,
            headerColor: '#000000',
            headerHeight: 15,
            
            footerEnabled: true,
            footerLeft: '',
            footerCenter: '',
            footerRight: '{{pageNumber}}/{{totalPages}}',
            footerFontSize: 15,
            footerColor: '#000000',
            footerHeight: 20,
            
            tocEnabled: true,
            tocTitle: 'Table of Contents',
            tocMaxLevel: 3,
            tocFontSize: 15,
            tocFontFamily: 'serif',     // 新增默认值
            tocColor: '#000000',        // 新增默认值
            tocLineHeight: 1.5,
            tocIndentSize: 20,
            tocIndent: 20,              // 新增默认值
            tocPageBreak: true,
            
            ...initialSettings
        };
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl('h2', { text: 'Header, Footer and TOC Settings' });
        
        // 创建主容器
        const mainContainer = contentEl.createEl('div', { cls: 'header-footer-toc-container' });
        
        // 创建左侧控制面板
        const controlsContainer = mainContainer.createEl('div', { cls: 'controls-container' });
        
        // 创建右侧预览面板
        const previewContainer = mainContainer.createEl('div', { cls: 'preview-container' });
        this.previewElement = previewContainer.createEl('div', { cls: 'page-preview' });
        
        this.createControls(controlsContainer);
        this.updatePreview();
        
        // 创建底部按钮
        this.createButtons(contentEl);
    }

    private createControls(container: HTMLElement) {
        // 页眉设置
        this.createHeaderSettings(container);
        
        // 页脚设置
        this.createFooterSettings(container);
        
        // 目录设置
        this.createTocSettings(container);
    }

    private createHeaderSettings(container: HTMLElement) {
        const headerSection = container.createEl('div', { cls: 'settings-section' });
        headerSection.createEl('h3', { text: 'Header Settings' });
        
        new Setting(headerSection)
            .setName('Enable Header')
            .addToggle(toggle => toggle
                .setValue(this.settings.headerEnabled)
                .onChange(value => {
                    this.settings.headerEnabled = value;
                    this.updatePreview();
                    this.refreshControls(container);
                }));
        
        if (this.settings.headerEnabled) {
            new Setting(headerSection)
                .setName('Header Left')
                .setDesc('Supports variables: {{title}}, {{author}}, {{date}}')
                .addText(text => text
                    .setPlaceholder('Header left content')
                    .setValue(this.settings.headerLeft)
                    .onChange(value => {
                        this.settings.headerLeft = value;
                        this.updatePreview();
                    }));
            
            new Setting(headerSection)
                .setName('Header Center')
                .addText(text => text
                    .setPlaceholder('Header center content')
                    .setValue(this.settings.headerCenter)
                    .onChange(value => {
                        this.settings.headerCenter = value;
                        this.updatePreview();
                    }));
            
            new Setting(headerSection)
                .setName('Header Right')
                .addText(text => text
                    .setPlaceholder('Header right content')
                    .setValue(this.settings.headerRight)
                    .onChange(value => {
                        this.settings.headerRight = value;
                        this.updatePreview();
                    }));
            
            // 页眉样式设置
            new Setting(headerSection)
                .setName('字体大小')
                .addSlider(slider => slider
                    .setLimits(8, 24, 1)
                    .setValue(this.settings.headerFontSize)
                    .setDynamicTooltip()
                    .onChange(value => {
                        this.settings.headerFontSize = value;
                        this.updatePreview();
                    }))
                .addColorPicker(color => color
                    .setValue(this.settings.headerColor)
                    .onChange(value => {
                        this.settings.headerColor = value;
                        this.updatePreview();
                    }));
        }
    }

    private createFooterSettings(container: HTMLElement) {
        const footerSection = container.createEl('div', { cls: 'settings-section' });
        footerSection.createEl('h3', { text: 'Footer Settings' });
        
        new Setting(footerSection)
            .setName('Enable Footer')
            .addToggle(toggle => toggle
                .setValue(this.settings.footerEnabled)
                .onChange(value => {
                    this.settings.footerEnabled = value;
                    this.updatePreview();
                    this.refreshControls(container);
                }));
        
        if (this.settings.footerEnabled) {
            new Setting(footerSection)
                .setName('Footer Left')
                .setDesc('Supports variables: {{pageNumber}}, {{totalPages}}, {{title}}')
                .addText(text => text
                    .setPlaceholder('Footer left content')
                    .setValue(this.settings.footerLeft)
                    .onChange(value => {
                        this.settings.footerLeft = value;
                        this.updatePreview();
                    }));
            
            new Setting(footerSection)
                .setName('Footer Center')
                .addText(text => text
                    .setPlaceholder('Footer center content')
                    .setValue(this.settings.footerCenter)
                    .onChange(value => {
                        this.settings.footerCenter = value;
                        this.updatePreview();
                    }));
            
            new Setting(footerSection)
                .setName('Footer Right')
                .addText(text => text
                    .setPlaceholder('Footer right content')
                    .setValue(this.settings.footerRight)
                    .onChange(value => {
                        this.settings.footerRight = value;
                        this.updatePreview();
                    }));
            
            // 页脚样式设置
            new Setting(footerSection)
                .setName('字体大小')
                .addSlider(slider => slider
                    .setLimits(8, 24, 1)
                    .setValue(this.settings.footerFontSize)
                    .setDynamicTooltip()
                    .onChange(value => {
                        this.settings.footerFontSize = value;
                        this.updatePreview();
                    }))
                .addColorPicker(color => color
                    .setValue(this.settings.footerColor)
                    .onChange(value => {
                        this.settings.footerColor = value;
                        this.updatePreview();
                    }));
        }
    }

    private createTocSettings(container: HTMLElement) {
        const tocSection = container.createEl('div', { cls: 'settings-section' });
        tocSection.createEl('h3', { text: 'TOC Settings' });
        
        new Setting(tocSection)
            .setName('Enable TOC')
            .addToggle(toggle => toggle
                .setValue(this.settings.tocEnabled)
                .onChange(value => {
                    this.settings.tocEnabled = value;
                    this.updatePreview();
                    this.refreshControls(container);
                }));
        
        if (this.settings.tocEnabled) {
            new Setting(tocSection)
                .setName('TOC Title')
                .addText(text => text
                    .setPlaceholder('Table of Contents')
                    .setValue(this.settings.tocTitle)
                    .onChange(value => {
                        this.settings.tocTitle = value;
                        this.updatePreview();
                    }));
            
            new Setting(tocSection)
                .setName('Max Level')
                .setDesc('Show up to which heading level')
                .addSlider(slider => slider
                    .setLimits(1, 6, 1)
                    .setValue(this.settings.tocMaxLevel)
                    .setDynamicTooltip()
                    .onChange(value => {
                        this.settings.tocMaxLevel = value;
                        this.updatePreview();
                    }));
            
            new Setting(tocSection)
                .setName('Font Style')
                .addDropdown(dropdown => dropdown
                    .addOption('serif', 'Serif')
                    .addOption('sans-serif', 'Sans-serif')
                    .addOption('monospace', 'Monospace')
                    .setValue(this.settings.tocFontFamily)
                    .onChange(value => {
                        this.settings.tocFontFamily = value;
                        this.updatePreview();
                    }))
                .addColorPicker(color => color
                    .setValue(this.settings.tocColor)
                    .onChange(value => {
                        this.settings.tocColor = value;
                        this.updatePreview();
                    }));
            
            new Setting(tocSection)
                .setName('Font Size')
                .addSlider(slider => slider
                    .setLimits(10, 20, 1)
                    .setValue(this.settings.tocFontSize)
                    .setDynamicTooltip()
                    .onChange(value => {
                        this.settings.tocFontSize = value;
                        this.updatePreview();
                    }));
            
            new Setting(tocSection)
                .setName('Line Height')
                .addSlider(slider => slider
                    .setLimits(1, 3, 0.1)
                    .setValue(this.settings.tocLineHeight)
                    .setDynamicTooltip()
                    .onChange(value => {
                        this.settings.tocLineHeight = value;
                        this.updatePreview();
                    }));
            
            new Setting(tocSection)
                .setName('Indent Size')
                .addSlider(slider => slider
                    .setLimits(10, 50, 5)
                    .setValue(this.settings.tocIndentSize)
                    .setDynamicTooltip()
                    .onChange(value => {
                        this.settings.tocIndentSize = value;
                        this.updatePreview();
                    }));
            
            new Setting(tocSection)
                .setName('Page break after TOC')
                .setDesc('Insert a page break after the TOC')
                .addToggle(toggle => toggle
                    .setValue(this.settings.tocPageBreak)
                    .onChange(value => {
                        this.settings.tocPageBreak = value;
                        this.updatePreview();
                    }));
        }
    }

    private refreshControls(container: HTMLElement) {
        container.empty();
        this.createControls(container);
    }

    private updatePreview() {
        if (!this.previewElement) return;
        
        this.previewElement.empty();
        
        // 创建页面预览
        const pageContainer = this.previewElement.createEl('div', { cls: 'page-container' });
        
        // 页眉预览
        if (this.settings.headerEnabled) {
            const header = pageContainer.createEl('div', { cls: 'header-preview' });
            header.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 20px;
                border-bottom: 1px solid #ddd;
                font-size: ${this.settings.headerFontSize}px;
                color: ${this.settings.headerColor};
                height: ${this.settings.headerHeight}px;
            `;
            
            header.createEl('span', { text: this.replaceVariables(this.settings.headerLeft) });
            header.createEl('span', { text: this.replaceVariables(this.settings.headerCenter) });
            header.createEl('span', { text: this.replaceVariables(this.settings.headerRight) });
        }
        
        // 内容区域预览
        const content = pageContainer.createEl('div', { cls: 'content-preview' });
        content.style.cssText = 'flex: 1; padding: 20px; overflow-y: auto;';
        
        // 目录预览
        if (this.settings.tocEnabled) {
            const toc = content.createEl('div', { cls: 'toc-preview' });
            toc.style.cssText = `
                margin-bottom: 30px;
                font-size: ${this.settings.tocFontSize}px;
                font-family: ${this.settings.tocFontFamily};
                color: ${this.settings.tocColor};
                line-height: ${this.settings.tocLineHeight};
            `;
            
            toc.createEl('h2', { text: this.settings.tocTitle, cls: 'toc-title' });
            
            // 示例目录项
            const tocItems = [
                { level: 1, title: 'Chapter 1 Overview', page: '1' },
                { level: 2, title: '1.1 Background', page: '2' },
                { level: 2, title: '1.2 Objectives', page: '5' },
                { level: 1, title: 'Chapter 2 Methodology', page: '8' },
                { level: 2, title: '2.1 Theoretical Background', page: '9' },
                { level: 3, title: '2.1.1 Core Concepts', page: '10' },
            ];
            
            tocItems.forEach(item => {
                if (item.level <= this.settings.tocMaxLevel) {
                    const tocItem = toc.createEl('div', { cls: 'toc-item' });
                    tocItem.style.cssText = `
                        margin-left: ${(item.level - 1) * this.settings.tocIndentSize}px;
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 5px;
                    `;
                    
                    tocItem.createEl('span', { text: item.title });
                    tocItem.createEl('span', { text: item.page });
                }
            });
            
            if (this.settings.tocPageBreak) {
                toc.createEl('div', { 
                    text: '--- Page Break ---', 
                    cls: 'page-break-indicator',
                    attr: { style: 'text-align: center; color: #999; margin: 20px 0; font-style: italic;' }
                });
            }
        }
        
        // 示例内容
        content.createEl('p', { text: 'This is a preview of the document content...' });
        
        // 页脚预览
        if (this.settings.footerEnabled) {
            const footer = pageContainer.createEl('div', { cls: 'footer-preview' });
            footer.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 10px 20px;
                border-top: 1px solid #ddd;
                font-size: ${this.settings.footerFontSize}px;
                color: ${this.settings.footerColor};
                height: ${this.settings.footerHeight}px;
            `;
            
            footer.createEl('span', { text: this.replaceVariables(this.settings.footerLeft) });
            footer.createEl('span', { text: this.replaceVariables(this.settings.footerCenter) });
            footer.createEl('span', { text: this.replaceVariables(this.settings.footerRight) });
        }
    }

    private replaceVariables(text: string): string {
        return text
            .replace(/\{\{title\}\}/g, 'Sample Book Title')
            .replace(/\{\{author\}\}/g, 'Author Name')
            .replace(/\{\{date\}\}/g, new Date().toLocaleDateString())
            .replace(/\{\{pageNumber\}\}/g, '1')
            .replace(/\{\{totalPages\}\}/g, '100');
    }

    private createButtons(container: HTMLElement) {
        const buttonContainer = container.createEl('div', { cls: 'modal-button-container' });
        buttonContainer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;';
        
        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel', cls: 'mod-cta' });
        cancelButton.addEventListener('click', () => this.close());
        
        const confirmButton = buttonContainer.createEl('button', { text: 'Apply', cls: 'mod-cta mod-primary' });
        confirmButton.addEventListener('click', () => {
            this.onSubmit(this.settings);
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}