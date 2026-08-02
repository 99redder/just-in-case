/*
 * Shared contact-extraction logic used by the editor's one-time "Import
 * contacts" tool. The scraping functions here are copied verbatim from the
 * Contact Link Card logic in index.html so the imported entries match exactly
 * what that card shows. Exposed as window.JICContacts.
 *
 * NOTE: index.html keeps its own inline copies of these scrapers (they run on
 * every load of the main view). If that logic changes, mirror it here too.
 */
(function () {
  'use strict';

  function splitContactLines(text) {
    return String(text || '')
      .split(/\r?\n|[•;]/)
      .map(line => line.replace(/^\s*[-*]\s*/, '').trim())
      .filter(Boolean);
  }

  const phoneContactPattern = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b)/g;
  const emailContactPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

  function extractContactValues(line) {
    const text = String(line || '');
    const matches = [];
    text.replace(phoneContactPattern, (value, index) => {
      matches.push({ value, index, kind: contactKindFromLine(text, index) });
      return value;
    });
    text.replace(emailContactPattern, (value, index) => {
      matches.push({ value, index, kind: 'email' });
      return value;
    });

    return matches
      .sort((a, b) => a.index - b.index)
      .map(match => ({
        ...match,
        value: match.value.replace(/[),.;:]+$/, '').trim(),
        label: contactLabelFromLine(text, match.index),
      }))
      .filter(match => match.value && !isExcludedContactValue(match.value));
  }

  function isExcludedContactValue(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized.startsWith('chris.gorham@outlook');
  }

  function contactKindFromLine(line, contactIndex) {
    const before = String(line || '').slice(0, contactIndex);
    const labels = before.match(/\b(phone|tel|fax)\b/gi) || [];
    return labels.length && labels[labels.length - 1].toLowerCase() === 'fax' ? 'fax' : 'phone';
  }

  function isEmailContactValue(value) {
    return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(String(value || '').trim());
  }

  function isPhoneContactValue(value) {
    return /^(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4})$/.test(String(value || '').trim());
  }

  function contactLabelFromLine(line, contactIndex) {
    const label = String(line)
      .slice(0, contactIndex)
      .replace(phoneContactPattern, '')
      .replace(emailContactPattern, '')
      .split(/\b(?:phone|tel|email|e-mail|fax|contact|call)\b\s*[:=-]?/i)
      .filter(Boolean)
      .pop() || '';

    return label
      .replace(/\b(property manager|provider|agent|manager|office|main|direct)\b\s*[:=-]?\s*/i, '')
      .replace(/\bat\s*$/i, '')
      .replace(/[(:=,\-\s]+$/, '')
      .trim();
  }

  function propertyContextFromLine(line) {
    const text = String(line || '').trim();
    const labeled = text.match(/\b(?:property(?!\s*manager)|rental|address|unit)\b\s*[:=-]\s*(.+)$/i);
    if (labeled) return cleanPropertyContext(labeled[1]);

    const managedFor = text.match(/\b(?:property manager for|manager for|managed by|manages|for)\b\s+(?:for\s+)?(.+?)(?:\s*[:=-]|$)/i);
    if (managedFor && /\b(?:property|rental|unit|apt|apartment|house|condo|drive|dr|road|rd|street|st|avenue|ave|lane|ln|court|ct|place|pl|circle|cir|way|terrace|ter|blvd|boulevard)\b/i.test(managedFor[1])) {
      return cleanPropertyContext(managedFor[1]);
    }

    if (/\b(?:drive|dr|road|rd|street|st|avenue|ave|lane|ln|court|ct|place|pl|circle|cir|way|terrace|ter|blvd|boulevard)\b/i.test(text) && text.length <= 100) {
      return cleanPropertyContext(text);
    }

    if (/\b(?:property(?!\s*manager)|rental|unit|apt|apartment|house|condo)\b/i.test(text) && text.length <= 80) {
      return cleanPropertyContext(text);
    }
    return '';
  }

  function contactNameContextFromLine(line) {
    const text = String(line || '').trim();
    const match = text.match(/\b(?:property manager|manager|agent|provider|contact)\b\s*[:=-]\s*(.+)$/i);
    if (!match) return '';
    return match[1]
      .replace(phoneContactPattern, '')
      .replace(emailContactPattern, '')
      .replace(/[(:=,\-\s]+$/, '')
      .trim();
  }

  function cleanPropertyContext(text) {
    return String(text || '')
      .replace(/^\s*\d+\)\s*/, '')
      .replace(phoneContactPattern, '')
      .replace(emailContactPattern, '')
      .replace(/\b(?:phone|tel|email|e-mail|fax|contact|manager|property manager)\b\s*[:=-]?.*$/i, '')
      .replace(/[(:=,\-\s]+$/, '')
      .trim();
  }

  function contactSourceFromLine(baseSource, label, propertyContext = '') {
    const sourceParts = [baseSource];
    if (propertyContext && !baseSource.toLowerCase().includes(propertyContext.toLowerCase())) {
      sourceParts.push(propertyContext);
    }
    if (label && label.length <= 80 && !sourceParts.join(' ').toLowerCase().includes(label.toLowerCase())) {
      sourceParts.push(label);
    }
    if (sourceParts.length > 1) {
      return sourceParts.join(': ');
    }
    if (!label || label.length > 80 || baseSource.toLowerCase().includes(label.toLowerCase())) {
      return baseSource;
    }
    return `${baseSource}: ${label}`;
  }

  function isGenericContactSource(source) {
    return /^(K Knowledge Base|First Steps: Contact Information|First Steps: Entry|General Information: Entry|Money: Unknown Account)$/i.test(String(source || '').trim());
  }

  function hasClearContactContext(baseSource, label) {
    const cleanLabel = String(label || '').trim();
    return (cleanLabel.length > 0 && cleanLabel.length <= 80) || !isGenericContactSource(baseSource);
  }

  function contactDisplayParts(source) {
    const sourceText = String(source || '').trim();
    const kbPrefix = 'K Knowledge Base: ';
    const displayText = sourceText.startsWith(kbPrefix) ? sourceText.slice(kbPrefix.length) : sourceText;
    const parenthetical = displayText.match(/^(.+?)\s*\(([^)]+)\)$/);
    if (parenthetical) {
      return { name: parenthetical[1].trim(), title: parenthetical[2].trim() };
    }
    const dashed = displayText.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (dashed) {
      return { name: dashed[1].trim(), title: dashed[2].trim() };
    }
    return { name: displayText, title: '' };
  }

  function collectContactCandidatesFromText(source, text) {
    const candidates = [];
    let activePropertyContext = propertyContextFromLine(source);
    let activeContactName = '';

    splitContactLines(text).forEach(line => {
      const linePropertyContext = propertyContextFromLine(line);
      const lineContactName = contactNameContextFromLine(line);
      const contactValues = extractContactValues(line)
        .map(contact => ({ ...contact, label: contact.label || lineContactName || activeContactName }))
        .filter(contact => hasClearContactContext(source, contact.label || linePropertyContext || activePropertyContext));

      if (linePropertyContext) activePropertyContext = linePropertyContext;
      if (lineContactName) activeContactName = lineContactName;
      if (!contactValues.length) return;

      contactValues.forEach(contact => {
        candidates.push({
          source: contactSourceFromLine(source, contact.label, linePropertyContext || activePropertyContext),
          line: contact.value,
          kind: contact.kind,
        });
      });
    });

    return candidates;
  }

  function collectContactCandidatesFromItem(sectionLabel, item, fields) {
    const title = item.title || item.name || item.account || item.type || 'Entry';
    const source = `${sectionLabel}: ${title}`;
    return fields.flatMap(field => collectContactCandidatesFromText(source, item[field]));
  }

  function dedupeContactCandidates(candidates) {
    const seen = new Set();
    return candidates.filter(candidate => {
      const key = isPhoneContactValue(candidate.line)
        ? candidate.line.replace(/[^\d]/g, '').replace(/^1(?=\d{10}$)/, '')
        : candidate.line.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Scrape every free-text source plus the K knowledge base. Intentionally does
  // NOT include data.contacts — the point of import is to materialize the
  // scraped values as first-class contacts.
  function scrapeContactCandidates(data, kbEntries) {
    const appCandidates = [
      ...(data.firststeps || []).flatMap(item => collectContactCandidatesFromItem('First Steps', item, ['notes', 'details'])),
      ...(data.insurance || []).flatMap(item => collectContactCandidatesFromItem('Insurance', item, ['notes', 'details'])),
      ...(data.money || []).flatMap(item => collectContactCandidatesFromItem('Money', item, ['instructions'])),
      ...(data.generalinfo || []).flatMap(item => collectContactCandidatesFromItem('General Information', item, ['details'])),
    ];
    const kbCandidates = (kbEntries || []).flatMap(entry =>
      collectContactCandidatesFromText('K Knowledge Base', entry?.content || ''));
    return dedupeContactCandidates([...appCandidates, ...kbCandidates]);
  }

  // Group flat candidates by their source into structured contact records.
  // First phone → phone, first email → email; any extra phones/emails/notes are
  // folded into the notes field so nothing is lost.
  function contactsFromCandidates(candidates) {
    const groups = new Map();
    for (const c of candidates) {
      const key = c.source || 'Contact';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    const contacts = [];
    for (const [source, items] of groups) {
      const parts = contactDisplayParts(source);
      // Use the most specific segment (after the last ": ") as the name so
      // entries read like "Attorney" rather than "First Steps: …: Attorney".
      const name = parts.name.includes(': ') ? parts.name.split(': ').pop().trim() : parts.name;
      const title = parts.title;
      const phones = items.filter(i => i.kind === 'phone').map(i => i.line);
      const faxes = items.filter(i => i.kind === 'fax').map(i => i.line);
      const emails = items.filter(i => i.kind === 'email').map(i => i.line);
      const noteLines = items.filter(i => i.kind === 'note').map(i => i.line);

      const phone = phones[0] || '';
      const email = emails[0] || '';
      const extras = [
        ...phones.slice(1).map(p => `Phone: ${p}`),
        ...faxes.map(f => `Fax: ${f}`),
        ...emails.slice(1).map(e => `Email: ${e}`),
        ...noteLines,
      ];
      if (!phone && !email && extras.length === 0) continue;
      contacts.push({
        name: name || 'Contact',
        relationship: title || '',
        phone,
        email,
        notes: extras.join('\n'),
      });
    }
    return contacts;
  }

  window.JICContacts = { scrapeContactCandidates, contactsFromCandidates };
})();
