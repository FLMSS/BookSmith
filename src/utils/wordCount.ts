export function formatWordCount(words: number): string {
    if (!Number.isFinite(words)) {
        return '0';
    }

    // Show the full integer word count (with commas for readability)
    const rounded = Math.round(words);
    if (rounded === 0) return '0';
    return rounded.toLocaleString('en-US');
}

export function parseWordCountInput(value: string, defaultValue = 10000): number {
    if (!value) return defaultValue;

    const trimmed = value.trim();
    const match = trimmed.match(/^([\d,]+)$/);
    if (!match) return defaultValue;

    const num = parseInt(match[1].replace(/,/g, ''), 10);
    if (Number.isNaN(num)) return defaultValue;

    return num;
}

