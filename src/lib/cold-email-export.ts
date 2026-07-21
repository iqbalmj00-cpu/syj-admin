export function coldEmailCsvCell(value: unknown) {
    let text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
}

export function coldEmailCsv(headers: string[], rows: unknown[][]) {
    return `\uFEFF${[headers, ...rows].map((row) => row.map(coldEmailCsvCell).join(",")).join("\r\n")}\r\n`;
}
