import { escapeMarkup, parseMarkup } from './core';
import { fromTsv } from './grid';

function clipboardStyles(doc: Document): Map<string, string> {
  const styles = new Map<string, string>();
  for (const sheet of Array.from(doc.querySelectorAll('style'))) {
    for (const rule of (sheet.textContent ?? '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const selector of rule[1].split(',')) {
        const className = selector.trim().match(/^(?:[a-z][\w-]*)?\.([\w-]+)$/i)?.[1];
        if (className) styles.set(className, `${styles.get(className) ?? ''};${rule[2]}`);
      }
    }
  }
  return styles;
}

function inlineTags(element: Element, styles: Map<string, string>): string[] {
  const tag = element.tagName.toLowerCase();
  const css = `${Array.from(element.classList).map(name => styles.get(name) ?? '').join(';')};${element.getAttribute('style') ?? ''}`.toLowerCase();
  const declarations = new Map<string, string>();
  for (const part of css.split(';')) {
    const separator = part.indexOf(':');
    if (separator > 0) declarations.set(part.slice(0, separator).trim(), part.slice(separator + 1).replace(/!important/g, '').trim());
  }
  const weight = declarations.get('font-weight') ?? '';
  const decoration = `${declarations.get('text-decoration') ?? ''} ${declarations.get('text-decoration-line') ?? ''}`;
  const tags: string[] = [];
  if (tag === 'b' || tag === 'strong' || weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) tags.push('b');
  if (tag === 'i' || tag === 'em' || ['italic', 'oblique'].includes(declarations.get('font-style') ?? '')) tags.push('i');
  if (tag === 'u' || decoration.includes('underline')) tags.push('u');
  if (tag === 's' || tag === 'strike' || tag === 'del' || decoration.includes('line-through')) tags.push('s');
  return tags;
}

function htmlNodeToMarkup(node: Node, styles: Map<string, string>): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeMarkup(node.textContent ?? '').replace(/\u00a0/g, ' ');
  if (!(node instanceof Element)) return '';
  const tag = node.tagName.toLowerCase();
  if (['script', 'style', 'meta', 'head', 'title', 'template', 'svg'].includes(tag)) return '';
  if (tag === 'br') return '\n';
  let content = Array.from(node.childNodes, child => htmlNodeToMarkup(child, styles)).join('');
  if (!content) return '';
  if (['div', 'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) content = `${content}\n`;
  const tags = inlineTags(node, styles);
  return tags.map(name => `<${name}>`).join('') + content + tags.reverse().map(name => `</${name}>`).join('');
}

function clipboardText(value: string): string {
  return value.replace(/[\u200b\ufeff]/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchesPlain(markup: string, plain: string): boolean {
  try { return clipboardText(parseMarkup(markup).text) === clipboardText(plain); }
  catch { return false; }
}

export function richClipboardCells(clipboard: Pick<DataTransfer, 'getData'>): string[][] | null {
  const html = clipboard.getData('text/html');
  if (!html) return null;
  const plain = fromTsv(clipboard.getData('text/plain'));
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const styles = clipboardStyles(doc);
  const table = doc.body.querySelector('table');
  if (table) {
    const cells = Array.from(table.rows, row => Array.from(row.cells, cell => htmlNodeToMarkup(cell, styles).trimEnd()));
    if (cells.length === plain.length && cells.every((row, index) => row.length === plain[index].length && row.every((value, col) => matchesPlain(value, plain[index][col])))) {
      return cells.some(row => row.some(value => /<(?:b|i|u|s)>/.test(value))) ? cells : null;
    }
  }
  const markup = richClipboardText(clipboard);
  return markup ? [[markup]] : null;
}

export function richClipboardText(clipboard: Pick<DataTransfer, 'getData'>): string | null {
  const html = clipboard.getData('text/html');
  if (!html) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const styles = clipboardStyles(doc);
  const plain = clipboard.getData('text/plain');
  const table = doc.body.querySelector('table');
  if (table) {
    const matching = Array.from(table.rows).flatMap(row => Array.from(row.cells))
      .map(cell => htmlNodeToMarkup(cell, styles).trimEnd())
      .filter(markup => matchesPlain(markup, plain));
    if (matching.length === 1 && /<(?:b|i|u|s)>/.test(matching[0])) return matching[0];
  }
  const markup = Array.from(doc.body.childNodes, node => htmlNodeToMarkup(node, styles)).join('').trimEnd();
  return /<(?:b|i|u|s)>/.test(markup) && matchesPlain(markup, plain) ? markup : null;
}
