import { BaseModal } from "./BaseModal";
import { Book } from "../types/book";

export class DebugStatsModal extends BaseModal {
    private fields: { [key: string]: HTMLInputElement } = {};
    private book: Book;
    private date: string;
    private onSave: () => void;

    constructor(container: HTMLElement, book: Book, date: string, onSave: () => void) {
        super(container, `Debug Stats — ${date}`);
        this.book = book;
        this.date = date;
        this.onSave = onSave;
    }

    protected createContent() {
        const entry = this.book.stats.daily_progress?.[this.date] as Record<string, any> || {};
        const content = this.element.createDiv({ cls: 'debug-stats-content' });

        // Editable fields
        const fields = [
            { key: 'words_added', label: 'words_added' },
            { key: 'words_deleted', label: 'words_deleted' },
            { key: 'positive_change', label: 'positive_change' },
            { key: 'negative_change', label: 'negative_change' }
        ];

        fields.forEach(({ key, label }) => {
            const row = content.createDiv({ cls: 'debug-stats-row' });
            row.createEl('label', { text: label, cls: 'debug-stats-label' });
            const input = row.createEl('input', { type: 'number', value: String(entry[key] ?? 0), cls: 'debug-stats-input' });
            this.fields[key] = input;
        });

        // Computed net_change
        const netRow = content.createDiv({ cls: 'debug-stats-row' });
        netRow.createEl('label', { text: 'net_change', cls: 'debug-stats-label' });
        const netValue = document.createElement('span');
        netValue.className = 'debug-stats-net-value';
        const updateNet = () => {
            const pos = Number(this.fields['positive_change'].value) || 0;
            const neg = Number(this.fields['negative_change'].value) || 0;
            netValue.textContent = String(pos + neg);
        };
        Object.values(this.fields).forEach(input => input.addEventListener('input', updateNet));
        updateNet();
        netRow.appendChild(netValue);

        // Save and Reset buttons
        const btnRow = content.createDiv({ cls: 'debug-stats-btn-row' });
        const saveBtn = btnRow.createEl('button', { text: 'Save Changes', cls: 'mod-cta' });
        const resetBtn = btnRow.createEl('button', { text: 'Reset Day Stats', cls: 'mod-warning' });

        saveBtn.onclick = () => {
            const dp = this.book.stats.daily_progress = this.book.stats.daily_progress || {};
            const entry = dp[this.date] = dp[this.date] || {};
            entry.words_added = Number(this.fields['words_added'].value) || 0;
            entry.words_deleted = Number(this.fields['words_deleted'].value) || 0;
            entry.positive_change = Number(this.fields['positive_change'].value) || 0;
            entry.negative_change = Number(this.fields['negative_change'].value) || 0;
            entry.net_change = entry.positive_change + entry.negative_change;
            this.onSave();
            this.close();
        };
        resetBtn.onclick = () => {
            this.fields['words_added'].value = '0';
            this.fields['words_deleted'].value = '0';
            this.fields['positive_change'].value = '0';
            this.fields['negative_change'].value = '0';
            updateNet();
        };
    }
}