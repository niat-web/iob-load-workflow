/**
 * One CSV cell. Text that a spreadsheet would run as a formula (=, @, +, -) is prefixed with ',
 * except plain numbers and phone numbers such as +91 98765 43210.
 */
export function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=@\t\r]/.test(text) || /^[+-](?![\d\s()-]+$)/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export const csvLine = (values) => `${values.map(csvCell).join(",")}\r\n`;

/** Byte order mark so Excel opens the file as UTF-8. */
export const CSV_BOM = "﻿";
