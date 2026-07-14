import { Notice, WorkspaceLeaf, setIcon } from 'obsidian';
import BookSmithPlugin from '../main';
import { FocusState } from '../services/FocusManager';
import { i18n } from '../i18n/i18n';
import { FocusProjectSelectModal } from '../modals/FocusProjectSelectModal';
import { BookViewSettingsModal } from '../modals/BookViewSettingsModal';
import { NamePromptModal } from '../modals/NamePromptModal';
import { Book, BookWritingPeriod } from '../types/book';
import { getLogicalDayISODate } from '../utils/logicalDay';

interface GoalDisplayState {
    label: string;
    progressRatio: number;
    goalReached: boolean;
    isOptionalDay: boolean;
    todayWords: number;
    goalWords: number;
    goalKey: string;
}

interface DailyProgressEntry {
    positive_change?: number;
    negative_change?: number;
    net_change?: number;
    words_added?: number;
    words_deleted?: number;
    old_deletions?: number;
}

type GoalWidgetState = 'orange' | 'verify';

export class FocusHeaderIndicator {
    private actionsEl: HTMLElement | null = null;
    private triggerEl: HTMLButtonElement | null = null;
    private badgeEl: HTMLElement | null = null;
    private ringEl: SVGCircleElement | null = null;
    private popoverEl: HTMLElement | null = null;
    private popoverSwapButtonEl: HTMLButtonElement | null = null;
    private popoverBoostButtonEl: HTMLButtonElement | null = null;
    private timeEl: HTMLButtonElement | null = null;
    private timeUpButtonEl: HTMLElement | null = null;
    private timeDownButtonEl: HTMLElement | null = null;
    private projectButtonEl: HTMLButtonElement | null = null;
    private goalSettingsLinkEl: HTMLButtonElement | null = null;
    private hideTimer: number | null = null;
    private goalCelebrateTimer: number | null = null;
    private goalVerificationTimer: number | null = null;
    private goalResetTimer: number | null = null;
    private goalChimeContext: AudioContext | null = null;
    private lastGoalChimeAt = 0;
    private goalResetCandidate = false;
    private confettiSuppressUntil = 0;
    private hasGoalReached = false;
    private goalCompleted = false;
    private goalReachedCandidate = false;
    private goalWidgetState: GoalWidgetState = 'orange';
    private activeGoalKey: string | null = null;
    private lastWrittenToday = 0;
    private lastGoalWordsForActiveKey = 0;
    private motivationalGoalOverrideWords: Record<string, number> = {};
    private displayMode: 'focus' | 'goal' = 'focus';
    private goalUpdateToken = 0;
    private goalDisplayState: GoalDisplayState = {
        label: '0 / 0',
        progressRatio: 0,
        goalReached: false,
        isOptionalDay: false,
        todayWords: 0,
        goalWords: 0,
        goalKey: ''
    };
    private readonly ringRadius = 6;
    private readonly ringCircumference = 2 * Math.PI * this.ringRadius;

    private readonly onTargetEnter = () => {
        void this.showPopover();
    };
    private readonly onTargetLeave = () => this.scheduleHidePopover();
    private readonly onPopoverEnter = () => this.clearHideTimer();
    private readonly onPopoverLeave = () => this.scheduleHidePopover();
    private readonly onFocusUpdate = () => this.updateUi();
    private statsChangeUnsubscribe: (() => void) | null = null;

    constructor(private plugin: BookSmithPlugin) {}

    initialize(): void {
        this.displayMode = this.plugin.settings.focus.miniWidgetMode === 'goal' ? 'goal' : 'focus';
        this.plugin.focusManager.onUpdate(this.onFocusUpdate);
        this.plugin.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => this.attachToActiveView()));
        this.plugin.registerEvent(this.plugin.app.workspace.on('layout-change', () => this.attachToActiveView()));
        this.statsChangeUnsubscribe = this.plugin.statsManager.onStatsChange(() => {
            this.updateUi();
        });

        window.setTimeout(() => {
            this.attachToActiveView();
            this.updateUi();
        }, 0);
    }

    destroy(): void {
        if (this.statsChangeUnsubscribe) {
            this.statsChangeUnsubscribe();
            this.statsChangeUnsubscribe = null;
        }
        this.plugin.focusManager.removeUpdateListener(this.onFocusUpdate);
        this.detachTarget();
        if (this.popoverEl?.parentElement) {
            this.popoverEl.parentElement.removeChild(this.popoverEl);
        }
        this.popoverEl = null;
        this.popoverSwapButtonEl = null;
        this.popoverBoostButtonEl = null;
        this.timeEl = null;
        this.goalSettingsLinkEl = null;
        if (this.goalCelebrateTimer !== null) {
            window.clearTimeout(this.goalCelebrateTimer);
            this.goalCelebrateTimer = null;
        }
        if (this.goalResetTimer !== null) {
            window.clearTimeout(this.goalResetTimer);
            this.goalResetTimer = null;
        }
        this.goalResetCandidate = false;
        this.clearGoalVerificationTimer();
        this.clearHideTimer();
        if (this.goalChimeContext) {
            void this.goalChimeContext.close();
            this.goalChimeContext = null;
        }
    }

    private attachToActiveView(): void {
        const leaf = (this.plugin.app.workspace as any).activeLeaf as WorkspaceLeaf | null;
        const viewType = leaf?.view?.getViewType?.();
        const containerEl = leaf?.view?.containerEl as HTMLElement | undefined;
        const actionsEl = containerEl?.querySelector('.view-header .view-actions') as HTMLElement | null;

        if (!actionsEl || viewType !== 'markdown') {
            this.detachTarget();
            return;
        }

        const actionButtons = Array.from(actionsEl.querySelectorAll<HTMLElement>('.view-action'));
        if (actionButtons.length === 0) {
            this.detachTarget();
            return;
        }

        const modeButton = actionButtons.find((button) => {
            const label = (button.getAttribute('aria-label') || '').toLowerCase();
            return /reading|live|source|preview|edit/.test(label);
        }) || actionButtons[actionButtons.length - 1];

        if (this.actionsEl === actionsEl && this.triggerEl?.isConnected) {
            return;
        }

        this.detachTarget();
        this.actionsEl = actionsEl;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'clickable-icon view-action book-smith-mini-focus-trigger';
        trigger.setAttribute('aria-label', i18n.t('FOCUS_MODE'));
        trigger.addEventListener('mouseenter', this.onTargetEnter);
        trigger.addEventListener('mouseleave', this.onTargetLeave);
        modeButton.insertAdjacentElement('beforebegin', trigger);
        this.triggerEl = trigger;

        this.badgeEl = document.createElement('span');
        this.badgeEl.className = 'book-smith-mini-focus-badge';
        this.badgeEl.innerHTML = `
            <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle class="book-smith-mini-focus-bg" cx="8" cy="8" r="6"></circle>
                <circle class="book-smith-mini-focus-ring" cx="8" cy="8" r="6"></circle>
                <circle class="book-smith-mini-focus-ring-flow" cx="8" cy="8" r="6"></circle>
                <circle class="book-smith-mini-focus-ring-flow-2" cx="8" cy="8" r="6"></circle>
            </svg>
        `;
        this.triggerEl.appendChild(this.badgeEl);
        this.ringEl = this.badgeEl.querySelector('.book-smith-mini-focus-ring');

        this.updateUi();
    }

    private detachTarget(): void {
        if (!this.triggerEl) return;
        this.triggerEl.removeEventListener('mouseenter', this.onTargetEnter);
        this.triggerEl.removeEventListener('mouseleave', this.onTargetLeave);
        if (this.badgeEl?.parentElement === this.triggerEl) {
            this.triggerEl.removeChild(this.badgeEl);
        }
        if (this.triggerEl.parentElement) {
            this.triggerEl.parentElement.removeChild(this.triggerEl);
        }
        this.actionsEl = null;
        this.triggerEl = null;
        this.badgeEl = null;
        this.ringEl = null;
        this.hidePopover();
    }

    private toggleDisplayMode(): void {
        this.displayMode = this.displayMode === 'focus' ? 'goal' : 'focus';
        this.updateUi();
        void this.persistMiniWidgetMode();
    }

    private async persistMiniWidgetMode(): Promise<void> {
        this.plugin.settings.focus.miniWidgetMode = this.displayMode;
        await this.plugin.saveSettings();
    }

    private ensurePopover(): void {
        if (this.popoverEl) return;

        const popover = document.createElement('div');
        popover.className = 'book-smith-mini-focus-popover';
        popover.innerHTML = `
            <button class="book-smith-mini-focus-popover-swap" type="button" aria-label="Toggle goal view"></button>
            <button class="book-smith-mini-focus-popover-boost" type="button" aria-label="Modify today's word goal (one-off)" title="Modify today's word goal (one-off)">
                <span style='font-size:9px;font-family:monospace;display:inline-block;width:16px;text-align:center;line-height:12px;'>+/-</span>
            </button>
            <div class="book-smith-mini-focus-top-row">
                <button class="book-smith-mini-focus-project" type="button">${i18n.t('FOCUS_UNASSIGNED')}</button>
            </div>
            <div class="book-smith-mini-focus-time-wrap">
                <span class="book-smith-mini-focus-time-adjust up" role="button" aria-label="Increase focus time">▲</span>
                <button class="book-smith-mini-focus-time" type="button">00:00</button>
                <span class="book-smith-mini-focus-time-adjust down" role="button" aria-label="Decrease focus time">▼</span>
            </div>
            <div class="book-smith-mini-focus-goal-settings-row">
                <button class="book-smith-mini-focus-goal-settings" type="button">Goal settings</button>
            </div>
        `;

        this.popoverSwapButtonEl = popover.querySelector('.book-smith-mini-focus-popover-swap');
        if (this.popoverSwapButtonEl) {
            setIcon(this.popoverSwapButtonEl, 'refresh-cw');
            this.popoverSwapButtonEl.addEventListener('click', (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                this.toggleDisplayMode();
            });
        }

        this.popoverBoostButtonEl = popover.querySelector('.book-smith-mini-focus-popover-boost');
        if (this.popoverBoostButtonEl) {
            // No longer use setIcon, custom +/- SVG is now inline
        }
        this.popoverBoostButtonEl?.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            void this.promptTodayGoalBoost();
        });

        this.timeEl = popover.querySelector('.book-smith-mini-focus-time');
        this.timeUpButtonEl = popover.querySelector('.book-smith-mini-focus-time-adjust.up');
        this.timeDownButtonEl = popover.querySelector('.book-smith-mini-focus-time-adjust.down');
        this.projectButtonEl = popover.querySelector('.book-smith-mini-focus-project');
        this.goalSettingsLinkEl = popover.querySelector('.book-smith-mini-focus-goal-settings');
        this.timeEl?.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            this.handleActionClick();
        });
        this.timeEl?.addEventListener('contextmenu', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            this.plugin.focusManager.resetCurrentTimer();
        });
        this.projectButtonEl?.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            void this.handleProjectSelect();
        });
        this.goalSettingsLinkEl?.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            void this.openCurrentProjectGoalSettings();
        });
        this.timeUpButtonEl?.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            void this.adjustFocusDuration(5);
        });
        this.timeDownButtonEl?.addEventListener('click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            void this.adjustFocusDuration(-5);
        });

        popover.addEventListener('mouseenter', this.onPopoverEnter);
        popover.addEventListener('mouseleave', this.onPopoverLeave);

        document.body.appendChild(popover);
        this.popoverEl = popover;
    }

    private async showPopover(): Promise<void> {
        if (!this.triggerEl) return;
        this.ensurePopover();
        this.clearHideTimer();
        await this.syncVisualStateBeforeShow();
        this.updatePopoverContent();

        const rect = this.triggerEl.getBoundingClientRect();
        if (this.popoverEl) {
            this.popoverEl.style.left = `${rect.left + rect.width / 2}px`;
            this.popoverEl.style.top = `${rect.bottom + 8}px`;
            this.popoverEl.classList.add('is-visible');
        }
    }

    private async syncVisualStateBeforeShow(): Promise<void> {
        if (!this.ringEl) return;

        const previousTransition = this.ringEl.style.transition;
        this.ringEl.style.transition = 'none';

        if (this.displayMode === 'goal') {
            this.applyGoalPendingVisualState();
            this.goalDisplayState = await this.computeGoalDisplayState();
            this.applyGoalVisualState();
        } else {
            this.goalUpdateToken += 1;
            this.applyFocusVisualState();
        }

        this.ringEl.getBoundingClientRect();
        this.ringEl.style.transition = previousTransition;
    }

    private hidePopover(): void {
        this.clearHideTimer();
        this.popoverEl?.classList.remove('is-visible');
    }

    private scheduleHidePopover(): void {
        this.clearHideTimer();
        this.hideTimer = window.setTimeout(() => this.hidePopover(), 120);
    }

    private clearHideTimer(): void {
        if (this.hideTimer === null) return;
        window.clearTimeout(this.hideTimer);
        this.hideTimer = null;
    }

    private handleActionClick(): void {
        if (this.displayMode === 'goal') {
            return;
        }

        const state = this.plugin.focusManager.getState();

        if (state === FocusState.IDLE) {
            this.plugin.focusManager.startFocus();
            return;
        }

        if (state === FocusState.WORKING) {
            this.plugin.focusManager.pauseFocus();
            return;
        }

        if (state === FocusState.PAUSED) {
            this.plugin.focusManager.resumeFocus();
            return;
        }

        this.plugin.focusManager.endFocus();
    }

    private updateUi(): void {
        if (this.displayMode === 'goal') {
            const enteringGoalMode = !this.triggerEl?.hasClass('is-goal-mode');
            if (enteringGoalMode) {
                this.applyGoalPendingVisualState();
            }
            void this.updateGoalUi();
            return;
        }

        this.goalUpdateToken += 1;
        this.applyFocusVisualState();

        if (this.popoverEl?.classList.contains('is-visible')) {
            this.updatePopoverContent();
        }
    }

    private async updateGoalUi(): Promise<void> {
        const token = ++this.goalUpdateToken;
        this.goalDisplayState = await this.computeGoalDisplayState();
        if (token !== this.goalUpdateToken) {
            return;
        }

        this.applyGoalVisualState();

        if (this.popoverEl?.classList.contains('is-visible')) {
            this.updatePopoverContent();
        }
    }

    private applyFocusVisualState(): void {
        if (this.ringEl) {
            const state = this.plugin.focusManager.getState();
            const progress = Math.max(0, Math.min(1, this.plugin.focusManager.getCurrentTime().progress));
            const remainingRatio = state === FocusState.IDLE ? 1 : Math.max(0, 1 - progress);
            const consumedRatio = 1 - remainingRatio;
            this.ringEl.style.strokeDasharray = `${this.ringCircumference}`;
            this.ringEl.style.strokeDashoffset = `${-this.ringCircumference * consumedRatio}`;
        }

        this.triggerEl?.removeClass('is-goal-mode', 'is-goal-reached', 'is-goal-optional');
        this.triggerEl?.removeClass('is-goal-has-progress');
        this.triggerEl?.style.removeProperty('--bs-goal-glow-alpha');
        this.triggerEl?.style.removeProperty('--bs-goal-glow-alpha-peak');
        this.triggerEl?.style.removeProperty('--bs-goal-soft-glow-alpha');
        this.triggerEl?.style.removeProperty('--bs-goal-soft-glow-alpha-peak');
        this.triggerEl?.style.removeProperty('--bs-goal-pulse-duration');
        this.triggerEl?.style.removeProperty('--bs-goal-soft-pulse-duration');
    }

    private applyGoalVisualState(): void {
        if (this.ringEl) {
            const filledLength = this.ringCircumference * this.goalDisplayState.progressRatio;
            this.ringEl.style.strokeDasharray = `${filledLength} ${this.ringCircumference}`;
            this.ringEl.style.strokeDashoffset = '0';
        }

        this.updateGoalPulseVisualParams(this.goalDisplayState.todayWords, this.goalDisplayState.progressRatio);

        const stableGoalReached = this.resolveStableGoalCompletion(this.goalDisplayState);
        const reachedNow = stableGoalReached && !this.hasGoalReached;
        this.triggerEl?.toggleClass('is-goal-mode', true);
        this.triggerEl?.toggleClass('is-goal-reached', stableGoalReached);
        this.triggerEl?.toggleClass('is-goal-verify', this.goalWidgetState === 'verify');
        this.triggerEl?.toggleClass('is-goal-optional', this.goalDisplayState.isOptionalDay && !stableGoalReached);

        if (reachedNow) {
            this.playGoalReachedAnimation();
            void this.playGoalReachedChime();
            if (Date.now() >= this.confettiSuppressUntil) {
                this.launchConfettiBurst();
            }
        }
        this.hasGoalReached = stableGoalReached;
    }

    private applyGoalPendingVisualState(): void {
        this.triggerEl?.toggleClass('is-goal-mode', true);
        this.triggerEl?.toggleClass('is-goal-mode', true);
        this.triggerEl?.toggleClass('is-goal-reached', this.goalCompleted || this.goalDisplayState.goalReached || this.hasGoalReached);
        this.triggerEl?.toggleClass('is-goal-verify', this.goalWidgetState === 'verify');
        this.triggerEl?.removeClass('is-goal-optional');

        if (this.ringEl) {
            const fallbackRatio = (this.goalCompleted || this.goalDisplayState.goalReached || this.hasGoalReached)
                ? 1
                : Math.max(0, Math.min(1, this.goalDisplayState.progressRatio || 0));
            const filledLength = this.ringCircumference * fallbackRatio;
            this.ringEl.style.strokeDasharray = `${filledLength} ${this.ringCircumference}`;
            this.ringEl.style.strokeDashoffset = '0';
        }

        const pulseRatio = (this.goalCompleted || this.goalDisplayState.goalReached || this.hasGoalReached)
            ? 1
            : Math.max(0, Math.min(1, this.goalDisplayState.progressRatio || 0));
        this.updateGoalPulseVisualParams(this.goalDisplayState.todayWords, pulseRatio);
    }

    private updateGoalPulseVisualParams(todayWords: number, progressRatio: number): void {
        if (!this.triggerEl) return;

        const hasProgress = todayWords > 0;
        this.triggerEl.toggleClass('is-goal-has-progress', hasProgress);

        const ratio = Math.max(0, Math.min(1, progressRatio || 0));
        const intensity = hasProgress ? (0.22 + (0.78 * ratio)) : 0;
        const peakIntensity = Math.min(0.95, intensity + 0.2);
        const softIntensity = Math.max(0, intensity * 0.55);
        const softPeakIntensity = Math.max(0, peakIntensity * 0.65);

        // Keep near-complete intensity close to current behavior; lower progress glows slower/softer.
        const pulseDuration = hasProgress ? (11.5 - (4.7 * ratio)) : 11.5;
        const softPulseDuration = pulseDuration + 1.4;

        this.triggerEl.style.setProperty('--bs-goal-glow-alpha', intensity.toFixed(3));
        this.triggerEl.style.setProperty('--bs-goal-glow-alpha-peak', peakIntensity.toFixed(3));
        this.triggerEl.style.setProperty('--bs-goal-soft-glow-alpha', softIntensity.toFixed(3));
        this.triggerEl.style.setProperty('--bs-goal-soft-glow-alpha-peak', softPeakIntensity.toFixed(3));
        this.triggerEl.style.setProperty('--bs-goal-pulse-duration', `${pulseDuration.toFixed(2)}s`);
        this.triggerEl.style.setProperty('--bs-goal-soft-pulse-duration', `${softPulseDuration.toFixed(2)}s`);
    }

    private playGoalReachedAnimation(): void {
        if (!this.triggerEl) return;
        this.triggerEl.removeClass('is-goal-complete-pulse');
        void this.triggerEl.offsetWidth;
        this.triggerEl.addClass('is-goal-complete-pulse');

        if (this.goalCelebrateTimer !== null) {
            window.clearTimeout(this.goalCelebrateTimer);
        }
        // Animation duration matches CSS (0.7s)
        this.goalCelebrateTimer = window.setTimeout(() => {
            this.triggerEl?.removeClass('is-goal-complete-pulse');
            this.goalCelebrateTimer = null;
        }, 700);
    }

    private async playGoalReachedChime(): Promise<void> {
        const now = Date.now();
        if (now - this.lastGoalChimeAt < 450) {
            return;
        }
        this.lastGoalChimeAt = now;

        // Get selected sound from current book
        let sound: string = 'ping1';
        try {
            const currentBookId = this.plugin.settings.lastBookId?.trim();
            if (currentBookId) {
                const book = await this.plugin.bookManager.getBookById(currentBookId);
                if (book?.stats?.goal_reached_sound) {
                    sound = book.stats.goal_reached_sound;
                }
            }
        } catch {}
        if (sound === 'none') return;

        try {
            const audioContext = this.goalChimeContext || new AudioContext();
            this.goalChimeContext = audioContext;
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }
            const t0 = audioContext.currentTime;
            const gainNode = audioContext.createGain();
            gainNode.connect(audioContext.destination);
            gainNode.gain.setValueAtTime(0.0001, t0);

            if (sound === 'ping1') {
                // Default ping (original)
                const toneA = audioContext.createOscillator();
                toneA.type = 'sine';
                toneA.frequency.setValueAtTime(880, t0);
                toneA.connect(gainNode);
                const toneB = audioContext.createOscillator();
                toneB.type = 'sine';
                toneB.frequency.setValueAtTime(1175, t0 + 0.075);
                toneB.connect(gainNode);
                gainNode.gain.linearRampToValueAtTime(0.04, t0 + 0.02);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
                toneA.start(t0);
                toneA.stop(t0 + 0.1);
                toneB.start(t0 + 0.075);
                toneB.stop(t0 + 0.22);
                window.setTimeout(() => {
                    toneA.disconnect();
                    toneB.disconnect();
                    gainNode.disconnect();
                }, 320);
            } else if (sound === 'ping2') {
                // Cheery ping: major triad
                const toneA = audioContext.createOscillator();
                toneA.type = 'triangle';
                toneA.frequency.setValueAtTime(1047, t0); // C6
                toneA.connect(gainNode);
                const toneB = audioContext.createOscillator();
                toneB.type = 'triangle';
                toneB.frequency.setValueAtTime(1319, t0 + 0.08); // E6
                toneB.connect(gainNode);
                const toneC = audioContext.createOscillator();
                toneC.type = 'triangle';
                toneC.frequency.setValueAtTime(1568, t0 + 0.16); // G6
                toneC.connect(gainNode);
                gainNode.gain.linearRampToValueAtTime(0.045, t0 + 0.02);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
                toneA.start(t0);
                toneA.stop(t0 + 0.12);
                toneB.start(t0 + 0.08);
                toneB.stop(t0 + 0.22);
                toneC.start(t0 + 0.16);
                toneC.stop(t0 + 0.32);
                window.setTimeout(() => {
                    toneA.disconnect();
                    toneB.disconnect();
                    toneC.disconnect();
                    gainNode.disconnect();
                }, 400);
            } else if (sound === 'ping3') {
                // Victorious trumpet: short brass-like burst
                const toneA = audioContext.createOscillator();
                toneA.type = 'square';
                toneA.frequency.setValueAtTime(784, t0); // G5
                toneA.connect(gainNode);
                const toneB = audioContext.createOscillator();
                toneB.type = 'square';
                toneB.frequency.setValueAtTime(988, t0 + 0.09); // B5
                toneB.connect(gainNode);
                const toneC = audioContext.createOscillator();
                toneC.type = 'square';
                toneC.frequency.setValueAtTime(1175, t0 + 0.18); // D6
                toneC.connect(gainNode);
                gainNode.gain.linearRampToValueAtTime(0.06, t0 + 0.01);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.38);
                toneA.start(t0);
                toneA.stop(t0 + 0.13);
                toneB.start(t0 + 0.09);
                toneB.stop(t0 + 0.25);
                toneC.start(t0 + 0.18);
                toneC.stop(t0 + 0.38);
                window.setTimeout(() => {
                    toneA.disconnect();
                    toneB.disconnect();
                    toneC.disconnect();
                    gainNode.disconnect();
                }, 480);
            } else if (sound === 'ping4') {
                // Bright bell: quick high bell
                const toneA = audioContext.createOscillator();
                toneA.type = 'sine';
                toneA.frequency.setValueAtTime(1760, t0); // A6
                toneA.connect(gainNode);
                gainNode.gain.linearRampToValueAtTime(0.055, t0 + 0.01);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
                toneA.start(t0);
                toneA.stop(t0 + 0.22);
                window.setTimeout(() => {
                    toneA.disconnect();
                    gainNode.disconnect();
                }, 300);
            }
        } catch {
            // Ignore audio failures (device restrictions, autoplay policy, etc.).
        }
    }

    private launchConfettiBurst(): void {
        if (!this.triggerEl) return;

        const rect = this.triggerEl.getBoundingClientRect();
        const burst = document.createElement('div');
        burst.className = 'book-smith-goal-confetti-burst';
        burst.style.left = `${rect.left + rect.width / 2}px`;
        burst.style.top = `${rect.top + rect.height / 2}px`;

        const confettiColors = ['#f7c63c', '#d96a00', '#ffd778', '#ffb347', '#f2f2f2'];
        for (let i = 0; i < 18; i++) {
            const piece = document.createElement('span');
            piece.className = 'book-smith-goal-confetti-piece';
            const angle = (Math.PI * 2 * i) / 18 + (Math.random() * 0.24 - 0.12);
            const distance = 18 + Math.random() * 22;
            const driftX = Math.cos(angle) * distance;
            const driftY = Math.sin(angle) * distance - (8 + Math.random() * 6);
            piece.style.setProperty('--dx', `${driftX.toFixed(1)}px`);
            piece.style.setProperty('--dy', `${driftY.toFixed(1)}px`);
            piece.style.setProperty('--rot', `${Math.round(Math.random() * 280 - 140)}deg`);
            piece.style.setProperty('--dur', `${(700 + Math.random() * 360).toFixed(0)}ms`);
            piece.style.setProperty('--delay', `${(Math.random() * 80).toFixed(0)}ms`);
            piece.style.background = confettiColors[i % confettiColors.length];
            burst.appendChild(piece);
        }

        document.body.appendChild(burst);
        window.setTimeout(() => {
            burst.remove();
        }, 1500);
    }

    private async computeGoalDisplayState(): Promise<GoalDisplayState> {
        const currentBookId = this.plugin.settings.lastBookId?.trim();
        if (!currentBookId) {
            return {
                label: '0 / 0',
                progressRatio: 0,
                goalReached: false,
                isOptionalDay: false,
                todayWords: 0,
                goalWords: 0,
                goalKey: ''
            };
        }

        const book = await this.plugin.bookManager.getBookById(currentBookId);
        if (!book) {
            return {
                label: '0 / 0',
                progressRatio: 0,
                goalReached: false,
                isOptionalDay: false,
                todayWords: 0,
                goalWords: 0,
                goalKey: ''
            };
        }

        const today = getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes);
        const baseGoalWords = Math.max(0, Math.round(book.stats?.daily_goal_words || 0));
        const goalWords = this.getMotivatedGoalWords(baseGoalWords, currentBookId, today);
        const todayWords = this.getDisplayedTodayValueWords(book, today);
        const progressRatio = goalWords > 0
            ? Math.max(0, Math.min(1, Math.max(0, todayWords) / goalWords))
            : 0;
        const goalReached = goalWords > 0 && todayWords >= goalWords;

        const metricMode = this.plugin.settings.bookView?.leftPanelInfo?.metricMode === 'pages' ? 'pages' : 'words';
        const wordsPerPage = Math.max(1, Math.round(this.plugin.settings.stats?.wordsPerPage || 250));

        return {
            label: this.formatGoalLabel(todayWords, goalWords, metricMode, wordsPerPage),
            progressRatio,
            goalReached,
            isOptionalDay: this.isOptionalWritingDay(book, today),
            todayWords,
            goalWords,
            goalKey: `${currentBookId}:${today}`
        };
    }

    private resolveStableGoalCompletion(state: GoalDisplayState): boolean {
        const goalKey = state.goalKey;
        if (!goalKey) {
            this.resetGoalVerificationState(null, 0, 0);
            return false;
        }

        const isFirstEvaluationForKey = this.activeGoalKey !== goalKey;
        if (isFirstEvaluationForKey) {
            this.resetGoalVerificationState(goalKey, state.todayWords, state.goalWords);
            if (state.goalWords > 0 && state.todayWords >= state.goalWords) {
                // On initial load/open for this day+project, reflect completion immediately with no celebration.
                this.goalCompleted = true;
                this.hasGoalReached = true;
                this.goalWidgetState = 'orange';
                this.lastWrittenToday = state.todayWords;
                this.lastGoalWordsForActiveKey = state.goalWords;
                return true;
            }
        }

        // If today's effective goal is increased (via + one-off or settings), force a fresh run.
        if (state.goalWords > this.lastGoalWordsForActiveKey) {
            this.goalCompleted = false;
            this.hasGoalReached = false;
            this.cancelGoalReachedCandidate();
            this.goalWidgetState = 'orange';
        }

        if (state.goalWords <= 0) {
            this.goalCompleted = false;
            this.hasGoalReached = false;
            this.cancelGoalReachedCandidate();
            this.goalWidgetState = 'orange';
            this.lastWrittenToday = state.todayWords;
            this.lastGoalWordsForActiveKey = state.goalWords;
            return false;
        }

        if (this.goalCompleted) {
            const resetThreshold = this.getGoalResetThreshold(state.goalWords);
            const deltaWritten = state.todayWords - this.lastWrittenToday;
            if (state.todayWords < resetThreshold) {
                const largeDrop = deltaWritten < -50;

                if (largeDrop) {
                    if (!this.goalResetCandidate) {
                        this.startGoalResetCandidate(3500, goalKey);
                    }
                    this.goalWidgetState = 'orange';
                    this.lastWrittenToday = state.todayWords;
                    this.lastGoalWordsForActiveKey = state.goalWords;
                    return true;
                }

                this.finalizeGoalReset(false);
                this.lastWrittenToday = state.todayWords;
                this.lastGoalWordsForActiveKey = state.goalWords;
                return false;
            }

            this.cancelGoalResetCandidate();
            this.goalWidgetState = 'orange';
            this.lastWrittenToday = state.todayWords;
            this.lastGoalWordsForActiveKey = state.goalWords;
            return true;
        }

        const isAboveGoal = state.todayWords >= state.goalWords;
        if (!isAboveGoal) {
            this.cancelGoalReachedCandidate();
            this.cancelGoalResetCandidate();
            this.goalWidgetState = 'orange';
            this.lastWrittenToday = state.todayWords;
            this.lastGoalWordsForActiveKey = state.goalWords;
            return false;
        }

        if (!this.goalReachedCandidate) {
            const deltaWritten = Math.max(0, state.todayWords - this.lastWrittenToday);
            const delay = deltaWritten > 300
                ? 6000
                : deltaWritten > 150
                    ? 4500
                    : deltaWritten > 50
                        ? 3500
                        : 2000;
            this.startGoalReachedCandidate(delay, goalKey);
        }

        this.goalWidgetState = 'verify';

        this.lastWrittenToday = state.todayWords;
        this.lastGoalWordsForActiveKey = state.goalWords;
        return false;
    }

    private startGoalReachedCandidate(delayMs: number, goalKey: string): void {
        this.cancelGoalReachedCandidate();
        this.goalReachedCandidate = true;
        this.goalVerificationTimer = window.setTimeout(() => {
            this.goalReachedCandidate = false;
            void this.verifyGoalReachedCandidate(goalKey);
        }, delayMs);
    }

    private async verifyGoalReachedCandidate(goalKey: string): Promise<void> {
        if (this.activeGoalKey !== goalKey || this.goalCompleted) {
            return;
        }

        const verifiedState = await this.computeGoalDisplayState();
        if (verifiedState.goalKey !== goalKey) {
            return;
        }

        if (verifiedState.goalWords > 0 && verifiedState.todayWords >= verifiedState.goalWords) {
            this.goalCompleted = true;
            this.goalWidgetState = 'orange';
            this.goalDisplayState = verifiedState;
            this.lastGoalWordsForActiveKey = verifiedState.goalWords;
            this.updateUi();
            return;
        }

        this.goalWidgetState = 'orange';
        this.lastWrittenToday = verifiedState.todayWords;
        this.lastGoalWordsForActiveKey = verifiedState.goalWords;
    }

    private startGoalResetCandidate(delayMs: number, goalKey: string): void {
        this.cancelGoalResetCandidate();
        this.goalResetCandidate = true;
        // Large deletion detected: immediately hold confetti replay for a short window,
        // even before reset is fully confirmed, to avoid delete+undo confetti spam.
        this.confettiSuppressUntil = Math.max(this.confettiSuppressUntil, Date.now() + 15000);
        this.goalResetTimer = window.setTimeout(() => {
            this.goalResetCandidate = false;
            void this.verifyGoalResetCandidate(goalKey);
        }, delayMs);
    }

    private async verifyGoalResetCandidate(goalKey: string): Promise<void> {
        if (this.activeGoalKey !== goalKey || !this.goalCompleted) {
            return;
        }

        const verifiedState = await this.computeGoalDisplayState();
        if (verifiedState.goalKey !== goalKey) {
            return;
        }

        const resetThreshold = this.getGoalResetThreshold(verifiedState.goalWords);
        if (verifiedState.goalWords > 0 && verifiedState.todayWords < resetThreshold) {
            this.finalizeGoalReset(true);
            this.goalDisplayState = verifiedState;
            this.lastWrittenToday = verifiedState.todayWords;
            this.lastGoalWordsForActiveKey = verifiedState.goalWords;
            this.updateUi();
            return;
        }

        this.lastWrittenToday = verifiedState.todayWords;
        this.lastGoalWordsForActiveKey = verifiedState.goalWords;
    }

    private cancelGoalReachedCandidate(): void {
        this.goalReachedCandidate = false;
        this.clearGoalVerificationTimer();
    }

    private cancelGoalResetCandidate(): void {
        this.goalResetCandidate = false;
        if (this.goalResetTimer !== null) {
            window.clearTimeout(this.goalResetTimer);
            this.goalResetTimer = null;
        }
    }

    private clearGoalVerificationTimer(): void {
        if (this.goalVerificationTimer === null) return;
        window.clearTimeout(this.goalVerificationTimer);
        this.goalVerificationTimer = null;
    }

    private resetGoalVerificationState(goalKey: string | null, todayWords: number, goalWords: number): void {
        this.clearGoalVerificationTimer();
        this.cancelGoalResetCandidate();
        this.goalReachedCandidate = false;
        this.goalCompleted = false;
        this.hasGoalReached = false;
        this.goalWidgetState = 'orange';
        this.activeGoalKey = goalKey;
        this.lastWrittenToday = todayWords;
        this.lastGoalWordsForActiveKey = goalWords;
        this.confettiSuppressUntil = 0;
    }

    private finalizeGoalReset(largeDrop: boolean): void {
        this.goalCompleted = false;
        this.hasGoalReached = false;
        this.cancelGoalReachedCandidate();
        this.cancelGoalResetCandidate();
        this.goalWidgetState = 'orange';
        this.playGoalResetAnimation();
        if (largeDrop) {
            this.confettiSuppressUntil = Date.now() + 15000;
        }
    }

    private getGoalResetThreshold(goalWords: number): number {
        // Universal behavior: keep completion only while staying within the top 10% of goal.
        return Math.max(0, goalWords * 0.9);
    }

    private playGoalResetAnimation(): void {
        if (!this.triggerEl) return;
        this.triggerEl.removeClass('is-goal-resetting');
        void this.triggerEl.offsetWidth;
        this.triggerEl.addClass('is-goal-resetting');

        if (this.goalResetTimer !== null) {
            window.clearTimeout(this.goalResetTimer);
        }
        this.goalResetTimer = window.setTimeout(() => {
            this.triggerEl?.removeClass('is-goal-resetting');
            this.goalResetTimer = null;
        }, 380);
    }

    public getMotivatedGoalWords(baseGoalWords: number, bookId: string, date: string): number {
        const key = this.getMotivationOverrideKey(bookId, date);
        const override = this.motivationalGoalOverrideWords[key];
        if (!Number.isFinite(override)) {
            return baseGoalWords;
        }
        return Math.round(override);
    }

    private getMotivationOverrideKey(bookId: string, logicalDate: string): string {
        return `${bookId}:${logicalDate}`;
    }

    private getDisplayedTodayValueWords(book: Book, date: string): number {
        const activePeriod = this.getActiveWritingPeriod(book, date);
        if (!activePeriod) {
            return 0;
        }

        const entry = this.getDailyProgressEntry(book, date);
        if (!entry) {
            return Math.round(book.stats?.daily_words?.[date] || 0);
        }

        let value = this.getRawWritingValue(entry);

        return Math.round(value);
    }

    private getDailyProgressEntry(book: Book, date: string): DailyProgressEntry | null {
        const entry = book.stats?.daily_progress?.[date];
        if (!entry) return null;

        return {
            positive_change: entry.positive_change ?? 0,
            negative_change: entry.negative_change ?? 0,
            net_change: entry.net_change ?? 0,
            words_added: entry.words_added ?? entry.positive_change ?? 0,
            words_deleted: entry.words_deleted ?? Math.abs(entry.negative_change || 0),
            old_deletions: entry.old_deletions ?? 0
        };
    }

    private getRawWritingValue(entry: DailyProgressEntry): number {
        const mode = this.plugin.settings.stats?.leftPaneWritingDisplayMode || 'daily-output';
        if (mode === 'daily-output') {
            // new_material = net_change + old_deletions
            const newMaterial = (entry.net_change || 0) + (entry.old_deletions || 0);
            return Math.max(0, newMaterial);
        }
        if (mode === 'raw') {
            return (entry.words_added ?? entry.positive_change ?? 0) - (entry.words_deleted ?? Math.abs(entry.negative_change || 0));
        }
        return entry.net_change || 0;
    }

    private formatGoalLabel(todayWords: number, goalWords: number, mode: 'words' | 'pages', wordsPerPage: number): string {
        if (mode === 'pages') {
            const currentPages = this.formatPageValue(todayWords, wordsPerPage);
            const goalPages = this.formatPageValue(goalWords, wordsPerPage);
            return `${currentPages} / ${goalPages}`;
        }

        return `${Math.round(todayWords).toLocaleString('en-US')} / ${Math.round(goalWords).toLocaleString('en-US')}`;
    }

    private formatPageValue(words: number, wordsPerPage: number): string {
        const pages = words / wordsPerPage;
        return Number.isInteger(pages) ? String(pages) : pages.toFixed(1);
    }

    private isOptionalWritingDay(book: Book, todayIso: string): boolean {
        const activePeriod = this.getActiveWritingPeriod(book, todayIso);
        if (!activePeriod) {
            return false;
        }

        const mode = activePeriod.schedule?.mode === 'days-per-week' ? 'days-per-week' : 'specific-days';
        if (mode === 'specific-days') {
            const selectedWeekdays = this.normalizeWeekdays(activePeriod.schedule?.selected_weekdays || [0, 1, 2, 3, 4, 5, 6]);
            const weekday = this.parseISODateLocal(todayIso).getDay();
            return !selectedWeekdays.includes(weekday);
        }

        const daysPerWeek = Math.max(0, Math.min(7, Math.round(activePeriod.schedule?.days_per_week ?? 7)));
        if (daysPerWeek <= 0) {
            return true;
        }

        const weekStart = this.getIsoWeekStart(todayIso);
        const yesterday = this.shiftISODate(todayIso, -1);
        if (yesterday < weekStart) {
            return false;
        }

        let writtenDays = 0;
        const dates = this.enumerateISODateRange(weekStart, yesterday);
        dates.forEach((date) => {
            if (this.isDateInPeriod(date, activePeriod) && this.getDisplayedTodayValueWords(book, date) > 0) {
                writtenDays += 1;
            }
        });

        return writtenDays >= daysPerWeek;
    }

    private getActiveWritingPeriod(book: Book, date: string): BookWritingPeriod | null {
        const periods = (book.stats?.writing_periods || [])
            .filter((period) => this.isDateInPeriod(date, period))
            .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));

        if (periods.length > 0) {
            return periods[periods.length - 1];
        }

        return {
            id: 'default-period',
            name: 'First Draft',
            start_date: this.getProjectCreationLogicalISODate(book) || date,
            schedule: {
                mode: 'specific-days',
                selected_weekdays: [0, 1, 2, 3, 4, 5, 6],
                days_per_week: 7
            },
            average_missed_scheduled_days: true,
            average_window_days: 0,
            created_at: '',
            updated_at: ''
        };
    }

    private getProjectCreationLogicalISODate(book: Book): string | null {
        const createdAt = book.basic?.created_at;
        if (!createdAt) return null;
        const createdDate = new Date(createdAt);
        if (Number.isNaN(createdDate.getTime())) return null;
        return getLogicalDayISODate(createdDate, this.plugin.settings.focus.dailyRolloverMinutes);
    }

    private isDateInPeriod(date: string, period: BookWritingPeriod): boolean {
        const startDate = this.isISODate(period.start_date) ? period.start_date : '';
        const endDate = this.isISODate(period.end_date || '') ? period.end_date || '' : '';
        if (!startDate || date < startDate) return false;
        if (endDate && date > endDate) return false;
        return true;
    }

    private normalizeWeekdays(days: number[]): number[] {
        const set = new Set<number>();
        days.forEach((day) => {
            if (Number.isInteger(day) && day >= 0 && day <= 6) {
                set.add(day);
            }
        });
        return Array.from(set);
    }

    private getIsoWeekStart(dateIso: string): string {
        const date = this.parseISODateLocal(dateIso);
        const weekday = date.getDay();
        const offset = weekday === 0 ? -6 : 1 - weekday;
        date.setDate(date.getDate() + offset);
        return this.toLocalISODate(date);
    }

    private enumerateISODateRange(startIso: string, endIso: string): string[] {
        if (!this.isISODate(startIso) || !this.isISODate(endIso) || startIso > endIso) {
            return [];
        }

        const dates: string[] = [];
        let cursor = startIso;
        while (cursor <= endIso) {
            dates.push(cursor);
            cursor = this.shiftISODate(cursor, 1);
        }
        return dates;
    }

    private shiftISODate(dateIso: string, days: number): string {
        const date = this.parseISODateLocal(dateIso);
        date.setDate(date.getDate() + days);
        return this.toLocalISODate(date);
    }

    private parseISODateLocal(dateIso: string): Date {
        const [year, month, day] = dateIso.split('-').map(Number);
        return new Date(year, month - 1, day);
    }

    private isISODate(value: string): boolean {
        return /^\d{4}-\d{2}-\d{2}$/.test(value);
    }

    private toLocalISODate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private updatePopoverContent(): void {
        const state = this.plugin.focusManager.getState();
        const isGoalMode = this.displayMode === 'goal';
        const time = this.displayMode === 'goal'
            ? this.goalDisplayState.label
            : this.getTimeLabel();

        if (this.timeEl) {
            this.timeEl.textContent = time;
        }

        const canAdjust = this.displayMode === 'focus' && state === FocusState.IDLE;
        if (this.timeUpButtonEl) {
            this.timeUpButtonEl.toggleClass('is-disabled', !canAdjust);
            this.timeUpButtonEl.toggleClass('is-hidden', isGoalMode);
        }
        if (this.timeDownButtonEl) {
            this.timeDownButtonEl.toggleClass('is-disabled', !canAdjust);
            this.timeDownButtonEl.toggleClass('is-hidden', isGoalMode);
        }

        if (this.projectButtonEl) {
            this.projectButtonEl.toggleClass('is-hidden', isGoalMode);
        }
        if (this.goalSettingsLinkEl) {
            this.goalSettingsLinkEl.parentElement?.toggleClass('is-visible', isGoalMode);
        }

        this.timeEl?.toggleClass('is-goal-display', isGoalMode);
        this.popoverEl?.toggleClass('is-goal-mode', isGoalMode);

        if (this.popoverBoostButtonEl) {
            const metricMode = this.plugin.settings.bookView?.leftPanelInfo?.metricMode === 'pages' ? 'pages' : 'words';
            const buttonLabel = metricMode === 'pages'
                ? `Modify today's page goal (one-off)`
                : `Modify today's word goal (one-off)`;
            this.popoverBoostButtonEl.setAttribute('aria-label', buttonLabel);
            this.popoverBoostButtonEl.setAttribute('title', buttonLabel);
            this.popoverBoostButtonEl.toggleClass('is-visible', isGoalMode);
        }

        void this.updateProjectButtonText();
    }

    private async promptTodayGoalBoost(): Promise<void> {
        if (this.displayMode !== 'goal') return;

        const currentBookId = this.plugin.settings.lastBookId?.trim();
        if (!currentBookId) {
            new Notice('No current project selected.');
            return;
        }

        const book = await this.plugin.bookManager.getBookById(currentBookId);
        if (!book) {
            new Notice('Current project could not be loaded.');
            return;
        }

        const today = getLogicalDayISODate(new Date(), this.plugin.settings.focus.dailyRolloverMinutes);
        const metricMode = this.plugin.settings.bookView?.leftPanelInfo?.metricMode === 'pages' ? 'pages' : 'words';
        const wordsPerPage = Math.max(1, Math.round(this.plugin.settings.stats?.wordsPerPage || 250));
        const baseGoalWords = Math.max(0, Math.round(book.stats?.daily_goal_words || 0));
        const currentGoalWords = this.getMotivatedGoalWords(baseGoalWords, currentBookId, today);

        const defaultValue = metricMode === 'pages'
            ? this.formatPageValue(currentGoalWords, wordsPerPage)
            : String(Math.max(0, Math.round(currentGoalWords)));
        const unit = metricMode === 'pages' ? 'pages' : 'words';
        const promptTitle = metricMode === 'pages'
            ? `Modify today's page goal (one-off)`
            : `Modify today's word goal (one-off)`;
        new NamePromptModal(
            this.plugin.app,
            promptTitle,
            (result) => {
                if (result === null) return;

                const parsed = Number(result.trim());
                if (!Number.isFinite(parsed) || parsed < 0) {
                    new Notice(`Please enter a valid ${unit} value.`);
                    return;
                }

                const targetGoalWords = metricMode === 'pages'
                    ? Math.round(parsed * wordsPerPage)
                    : Math.round(parsed);
                // Allow any value for today only
                const key = this.getMotivationOverrideKey(currentBookId, today);
                this.motivationalGoalOverrideWords[key] = targetGoalWords;
                this.updateUi();
                this.refreshBookSmithViews();
            },
            defaultValue
        ).open();
    }

    getTodayGoalOverrideWords(bookId: string, logicalDate: string): number | null {
        const key = this.getMotivationOverrideKey(bookId, logicalDate);
        const override = this.motivationalGoalOverrideWords[key];
        return Number.isFinite(override) ? Math.round(override) : null;
    }

    private async openCurrentProjectGoalSettings(): Promise<void> {
        const currentBookId = this.plugin.settings.lastBookId?.trim();
        if (!currentBookId) return;

        const currentBook = await this.plugin.bookManager.getBookById(currentBookId);
        if (!currentBook) return;

        this.hidePopover();
        new BookViewSettingsModal(this.plugin.app, this.plugin, currentBook, () => {
            this.updateUi();
            this.refreshBookSmithViews();
        }).open();
    }

    private refreshBookSmithViews(): void {
        const leaves = this.plugin.app.workspace.getLeavesOfType('book-smith-view');
        leaves.forEach((leaf) => {
            const view = leaf.view as any;
            if (typeof view?.refreshView === 'function') {
                void view.refreshView();
            }
        });
    }

    private async adjustFocusDuration(delta: number): Promise<void> {
        if (this.timeUpButtonEl?.hasClass('is-disabled') || this.timeDownButtonEl?.hasClass('is-disabled')) {
            return;
        }
        if (this.plugin.focusManager.getState() !== FocusState.IDLE) return;

        const current = this.plugin.settings.focus.workDuration;
        const next = Math.min(75, Math.max(5, current + delta));
        if (next === current) return;

        this.plugin.settings.focus.workDuration = next;
        await this.plugin.saveSettings();
        this.updateUi();
    }

    private async handleProjectSelect(): Promise<void> {
        this.hidePopover();
        const selectedBookId = this.plugin.focusManager.getAssignmentBookId();
        new FocusProjectSelectModal(this.plugin.app, this.plugin, selectedBookId, async (bookId) => {
            await this.plugin.focusManager.setAssignmentBookId(bookId);
            await this.updateProjectButtonText();
        }).open();
    }

    private async updateProjectButtonText(): Promise<void> {
        if (!this.projectButtonEl) return;

        const selectedBookId = this.plugin.focusManager.getAssignmentBookId();
        if (!selectedBookId) {
            this.projectButtonEl.textContent = i18n.t('FOCUS_UNASSIGNED');
            return;
        }

        const book = await this.plugin.bookManager.getBookById(selectedBookId);
        this.projectButtonEl.textContent = book?.basic.title || i18n.t('FOCUS_UNASSIGNED');
    }

    private getTimeLabel(): string {
        const state = this.plugin.focusManager.getState();

        if (state === FocusState.IDLE) {
            return `${this.plugin.settings.focus.workDuration.toString().padStart(2, '0')}:00`;
        }

        const { minutes, seconds } = this.plugin.focusManager.getCurrentTime();
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}
