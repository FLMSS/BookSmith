import { setIcon, App } from 'obsidian';
import { ConfirmModal } from '../modals/ConfirmModal';
import { FocusManager, FocusState } from '../services/FocusManager';
import BookSmithPlugin from '../main';
import { i18n } from '../i18n/i18n';
import { FocusProjectSelectModal } from '../modals/FocusProjectSelectModal';

export class FocusToolView {
    // ================ 属性定义 ================
    // UI 元素
    private container: HTMLElement;
    private timerEl: HTMLElement;
    private progressEl: SVGCircleElement;
    private statusEl: HTMLElement;
    private completedEl: HTMLElement;
    private interruptedEl: HTMLElement;
    private wordCountEl: HTMLElement;
    private wordGoalEl: HTMLElement;
    private totalWordsEl: HTMLElement;
    private assignmentButtonEl: HTMLButtonElement;

    // 业务逻辑
    private focusManager: FocusManager;
    private removeCallbacks: Array<() => void> = [];

    // ================ 构造函数 ================
    constructor(
        private app: App,
        private plugin: BookSmithPlugin,
        private parentEl: HTMLElement,
        private onExit: () => void
    ) {
        this.focusManager = this.plugin.focusManager;
        this.createUI();
        this.setupEventListeners();
    }

    // ================ UI 创建方法 ================
    private createUI() {
        this.container = this.parentEl.createDiv({ cls: 'book-smith-focus-tool' });
        this.createHeader();
        this.createTimerSection();
        this.createStatusSection();
        this.createControlSection();
        this.createStatsSection();
    }

    private createHeader() {
        const header = this.container.createDiv({ cls: 'focus-tool-header' });
        const backRow = header.createDiv({ cls: 'focus-tool-back-row' });
        const backButton = header.createEl('button', { cls: 'focus-tool-back-btn' });
        setIcon(backButton, 'arrow-left');
        backButton.appendChild(createSpan({ text: ` ${i18n.t('BACK_TO_TOOLBOX')}` }));
        backButton.addEventListener('click', () => this.onExit());

        backRow.appendChild(backButton);

        const mainRow = header.createDiv({ cls: 'focus-tool-header-main' });
        const titleWrap = mainRow.createDiv({ cls: 'focus-tool-header-left' });
        setIcon(titleWrap.createSpan({ cls: 'focus-tool-header-icon' }), 'target');
        titleWrap.createSpan({ text: i18n.t('FOCUS_MODE'), cls: 'focus-tool-title' });

        this.assignmentButtonEl = mainRow.createEl('button', {
            cls: 'focus-tool-project-btn',
            text: i18n.t('FOCUS_UNASSIGNED')
        });
        this.assignmentButtonEl.addEventListener('click', () => void this.openProjectSelect());
        void this.updateAssignmentButtonText();
    }

    private async openProjectSelect() {
        const selectedBookId = this.focusManager.getAssignmentBookId();
        new FocusProjectSelectModal(this.app, this.plugin, selectedBookId, async (bookId) => {
            await this.focusManager.setAssignmentBookId(bookId);
            await this.updateAssignmentButtonText();
        }).open();
    }

    private async updateAssignmentButtonText() {
        const selectedBookId = this.focusManager.getAssignmentBookId();
        if (!selectedBookId) {
            this.assignmentButtonEl.setText(i18n.t('FOCUS_UNASSIGNED'));
            return;
        }

        const book = await this.plugin.bookManager.getBookById(selectedBookId);
        this.assignmentButtonEl.setText(book?.basic.title || i18n.t('FOCUS_UNASSIGNED'));
    }

    private createTimerSection() {
        const timerContainer = this.container.createDiv({ cls: 'focus-tool-timer-container' });
        const svg = this.createProgressRing();
        timerContainer.appendChild(svg);
        this.createTimerAdjustButton(timerContainer, 'up');
        this.createTimerAdjustButton(timerContainer, 'down');
        this.timerEl = timerContainer.createDiv({ cls: 'focus-tool-timer' });
        this.updateTimer();
    }

    private createProgressRing(): SVGElement {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'focus-tool-progress-circle');
        svg.setAttribute('viewBox', '0 0 100 100');

        const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bgCircle.setAttribute('cx', '50');
        bgCircle.setAttribute('cy', '50');
        bgCircle.setAttribute('r', '45');
        bgCircle.setAttribute('class', 'focus-tool-progress-bg');

        this.progressEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        this.progressEl.setAttribute('cx', '50');
        this.progressEl.setAttribute('cy', '50');
        this.progressEl.setAttribute('r', '45');
        this.progressEl.setAttribute('class', 'focus-tool-progress-ring');

        svg.appendChild(bgCircle);
        svg.appendChild(this.progressEl);
        return svg;
    }

    private createTimerAdjustButton(container: HTMLElement, direction: 'up' | 'down') {
        const button = container.createDiv({ 
            cls: `focus-tool-timer-adjust ${direction}` 
        });
        
        button.addEventListener('click', () => {
            const currentDuration = this.plugin.settings.focus.workDuration;
            const newDuration = direction === 'up' 
                ? Math.min(currentDuration + 5, 75)
                : Math.max(currentDuration - 5, 5);

            if (newDuration !== currentDuration) {
                this.plugin.settings.focus.workDuration = newDuration;
                this.plugin.saveSettings();
                this.updateTimer();
            }
        });
    }

    private createStatusSection() {
        this.statusEl = this.container.createDiv({ cls: 'focus-tool-status' });
        this.statusEl.setText(i18n.t('READY_TO_START'));
    }

    private createControlSection() {
        const controls = this.container.createDiv({ cls: 'focus-tool-controls' });
        this.createInitialControls(controls);
    }

    private createInitialControls(controls: HTMLElement) {
        this.createButton(controls, i18n.t('START_FOCUS'), true, () => {
            this.focusManager.startFocus();
            controls.empty();
            this.createControlButtons(controls);
        });
    }

    private createStatsSection() {
        const statsContainer = this.container.createDiv({ cls: 'focus-tool-stats-container' });
        const stats = this.focusManager.getStats();
        
        this.completedEl = this.createStatItem(statsContainer, i18n.t('FOCUS_SESSIONS'), stats.completedSessions.toString());
        this.interruptedEl = this.createStatItem(statsContainer, i18n.t('INTERRUPTIONS'), stats.interruptions.toString());
        this.wordCountEl = this.createStatItem(statsContainer, i18n.t('CURRENT_WORDS'), '0');
        this.wordGoalEl = this.createStatItem(statsContainer, i18n.t('WORD_GOAL'), this.plugin.settings.focus.wordGoal.toString());
        this.totalWordsEl = this.createStatItem(statsContainer, i18n.t('TOTAL_FOCUS_WORDS'), stats.totalWords.toString());
    }

    private createControlButtons(controls: HTMLElement) {
        controls.empty();
        const state = this.focusManager.getState();

        if (state === FocusState.WORKING) {
            this.createButton(controls, i18n.t('PAUSE'), false, () => this.focusManager.pauseFocus());
            this.createButton(controls, i18n.t('EXIT'), false, () => this.handleExitSession());
        } else if (state === FocusState.PAUSED) {
            this.createButton(controls, i18n.t('RESUME'), true, () => this.focusManager.resumeFocus());
            this.createButton(controls, i18n.t('EXIT'), false, () => this.handleExitSession());
        } else if (state === FocusState.BREAK) {
            this.createButton(controls, i18n.t('EXIT'), false, () => this.handleExitSession());
        }
    }

    private createButton(container: HTMLElement, text: string, solid: boolean, onClick: () => void) {
        const btn = container.createDiv({
            cls: `focus-tool-btn ${solid ? 'focus-tool-btn-solid' : 'focus-tool-btn-outline'}`
        });
        btn.setText(text);
        btn.addEventListener('click', onClick);
        return btn;
    }

    private createStatItem(container: HTMLElement, label: string, value: string) {
        const item = container.createDiv({ cls: 'focus-tool-stat-item' });
        item.createSpan({ text: label });
        const valueSpan = item.createSpan({ text: value });
        return valueSpan;
    }

    // ================ UI 更新方法 ================
    private updateTimer(minutes?: number, seconds?: number) {
        if (minutes === undefined) {
            this.timerEl.textContent = `${this.plugin.settings.focus.workDuration.toString().padStart(2, '0')}:00`;
        } else {
            this.timerEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds?.toString().padStart(2, '0') ?? '00'}`;
        }
    }

    private updateProgress(progress: number) {
        const circumference = 2 * Math.PI * 45;
        const offset = circumference * (1 - progress);
        this.progressEl.style.strokeDashoffset = offset.toString();
    }

    private updateStatus(text: string) {
        this.statusEl.setText(text);
    }

    private updateStats(completed: number, interrupted: number) {
        this.completedEl.setText(completed.toString());
        this.interruptedEl.setText(interrupted.toString());
    }

    private getRandomEncouragement(): string {
        const messages = [
            '🎉 太棒了！已达到目标字数！继续保持～',
            '✨ 厉害！目标达成！让我们继续前进！',
            '🌟 完美！达到目标了！保持这份热情！',
            '🎯 目标达成！你的坚持值得表扬！',
            '💪 出色的表现！目标完成！再接再厉！'
        ];
        return messages[Math.floor(Math.random() * messages.length)];
    }

    private showCelebration() {
        // 创建庆祝容器
        const celebration = document.createElement('div');
        celebration.className = 'focus-celebration';
        
        // 添加庆祝文本
        const text = document.createElement('div');
        text.className = 'celebration-text';
        text.textContent = this.getRandomEncouragement();
        celebration.appendChild(text);
        
        // 添加到容器中
        this.container.appendChild(celebration);
        
        // 动画结束后移除元素
        celebration.addEventListener('animationend', () => {
            celebration.remove();
        });
    }

    private updateWordCount(current: number) {
        this.wordCountEl.setText(current.toString());
        
        const goalReached = current >= this.plugin.settings.focus.wordGoal;
        
        const wordCountItem = this.wordCountEl.parentElement;
        if (wordCountItem) {
            wordCountItem.toggleClass('goal-reached', goalReached);
            if (goalReached && !wordCountItem.hasClass('goal-reached-notified')) {
                wordCountItem.addClass('goal-reached-notified');
                this.showCelebration();
            }
        }
    }

    private handleIdleState(controls: HTMLElement) {
        controls.empty();
        this.updateProgress(0);
        this.updateTimer();
        // 只重置当前字数的通知状态
        const wordCountItem = this.wordCountEl.parentElement;
        if (wordCountItem) {
            wordCountItem.removeClass('goal-reached-notified');
            wordCountItem.removeClass('goal-reached');
        }
        
        this.createInitialControls(controls);
    }

    private updateTimerAdjustButtons(state: FocusState) {
        const adjustButtons = this.container.querySelectorAll('.focus-tool-timer-adjust');
        adjustButtons.forEach(button => {
            button.classList.toggle('hidden', state !== FocusState.IDLE);
        });
    }

    // ================ 事件处理方法 ================
    private setupEventListeners() {
        let lastState = this.focusManager.getState();
        
        const updateListener = () => {
            const currentState = this.focusManager.getState();
            this.updateUIState();
            
            // 只在状态发生变化时处理
            if (currentState !== lastState) {
                this.handleStateChange(lastState, currentState);
                lastState = currentState;
            }
        };

        this.focusManager.onUpdate(updateListener);
        this.onRemove(() => this.focusManager.removeUpdateListener(updateListener));
    }

    private handleStateChange(oldState: FocusState, newState: FocusState) {
        const controls = this.container.querySelector('.focus-tool-controls');
        if (!controls) return;

        if (newState === FocusState.IDLE) {
            this.handleIdleState(controls as HTMLElement);
        } else if (newState === FocusState.BREAK) {
            this.handleBreakState(controls as HTMLElement);
        } else {
            this.createControlButtons(controls as HTMLElement);
        }
    }

    private updateUIState() {
        const state = this.focusManager.getState();
        const { minutes, seconds, progress } = this.focusManager.getCurrentTime();
        const stats = this.focusManager.getStats();

        this.updateTimerAdjustButtons(state);
        this.updateTimer(minutes, seconds);
        this.updateProgress(progress);
        this.updateStats(stats.completedSessions, stats.interruptions);
        this.updateStatus(this.getStatusText(state));
        this.updateWordCount(this.focusManager.getCurrentWords());
        this.totalWordsEl.setText(stats.totalWords.toString());
        void this.updateAssignmentButtonText();
    }

    private handleBreakState(controls: HTMLElement) {
        this.createControlButtons(controls);
    }

    private handleExitSession() {
        const state = this.focusManager.getState();
        if (state === FocusState.WORKING || state === FocusState.PAUSED) {
            new ConfirmModal(
                this.app,
                i18n.t('EXIT_FOCUS'),
                i18n.t('EXIT_FOCUS_DESC'),
                () => {
                    this.focusManager.endFocus();
                }
            ).open();
        } else {
            if (state !== FocusState.IDLE) {
                this.focusManager.endFocus();
            }
        }
    }

    // ================ 工具方法 ================
    private getStatusText(state: FocusState): string {
        switch (state) {
            case FocusState.WORKING: return i18n.t('FOCUSING');
            case FocusState.PAUSED: return i18n.t('PAUSED');
            case FocusState.BREAK: return i18n.t('BREAK_TIME');
            default: return i18n.t('READY_TO_START');
        }
    }

    onRemove(callback: () => void) {
        this.removeCallbacks.push(callback);
    }

    remove() {
        this.removeCallbacks.forEach(callback => callback());
        this.container.remove();
    }
}