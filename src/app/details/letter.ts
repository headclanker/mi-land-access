// Polite access-permission request: a mailed letter or a short text message. Pure text and
// link generation (unit-tested) + dialog UI.

import { copyText, downloadText, h, icon, showDialog, toast } from '../util/dom';
import { prefGet, prefSet } from '../util/store';

export interface LetterInput {
  ownerName: string;
  ownerAddress: string[];
  parcelId?: string;
  siteAddress?: string;
  county?: string;
  acres?: string;
  sender: { name: string; phone: string; email: string; address: string };
  activity: string;
  season: string;
  date?: Date;
}

/** Turns "SMITH JOHN A & MARY" into "John A & Mary Smith"-ish readable casing, keeps LLC etc. */
export function tidyOwnerName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return '';
  if (s !== s.toUpperCase()) return s;
  const keep = new Set(['LLC', 'INC', 'LP', 'LLP', 'II', 'III', 'IV', 'USA', 'MI', 'DNR', 'MDOT', 'TR', 'TRUST']);
  return s
    .split(' ')
    .map((w) => (keep.has(w.replace(/[.,]/g, '')) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');
}

export function salutation(owner: string): string {
  if (!owner || /\b(llc|inc|corp|company|co\.?|trust|estate|church|club|association|assn|township|county|city|village|state)\b/i.test(owner)) return 'Dear Property Owner,';
  return `Dear ${owner},`;
}

export function draftLetter(i: LetterInput): string {
  const date = (i.date ?? new Date()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const owner = tidyOwnerName(i.ownerName);
  const where = [
    i.siteAddress ? `at ${i.siteAddress}` : '',
    i.parcelId ? `(parcel ${i.parcelId}${i.county ? `, ${i.county} County` : ''})` : i.county ? `in ${i.county} County` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const s = i.sender;
  const contact = [s.phone && `phone ${s.phone}`, s.email && `email ${s.email}`].filter(Boolean).join(' or ');
  const lines = [
    s.name || '[Your name]',
    ...(s.address ? s.address.split('\n') : ['[Your mailing address]']),
    [s.phone, s.email].filter(Boolean).join(' · ') || '[Phone · email]',
    '',
    date,
    '',
    owner || 'Property Owner',
    ...i.ownerAddress.filter(Boolean),
    '',
    salutation(owner),
    '',
    `My name is ${s.name || '[your name]'}, and I am writing to respectfully ask for permission to ${i.activity || 'hunt'} on your property ${where || 'near [location]'}${i.acres ? ` (about ${i.acres})` : ''} during ${i.season || '[season / dates]'}.`,
    '',
    'I am a licensed, safety-trained hunter and I take the responsibility of being on someone else’s land seriously. If you allow me access, I will:',
    '  • follow all Michigan hunting regulations and any rules you set (areas, dates, methods, vehicles);',
    '  • park where you ask, leave gates as I find them, and pack out everything I bring in;',
    '  • let you know when I plan to be there, and bring no guests without your OK;',
    '  • carry your written permission with me whenever I am on your land.',
    '',
    `I would be happy to meet you in person, share my hunting license number, or help with chores or posting in return. You can reach me by ${contact || '[phone or email]'}. If the answer is no, I completely understand and thank you for considering it.`,
    '',
    'Thank you for your time.',
    '',
    'Sincerely,',
    '',
    s.name || '[Your name]',
  ];
  return lines.join('\n');
}

// ---------- text message (SMS) ----------

export interface TextInput {
  siteAddress?: string;
  county?: string;
  parcelId?: string;
  sender: { name: string; phone: string; email: string };
  activity: string;
  season: string;
}

/** "921 GREEN RD, LANSING" → "921 Green Rd, Lansing" (assessor exports are all caps). Pure. */
export function tidyPlace(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (!t || t !== t.toUpperCase()) return t;
  return t.replace(/[A-Z][A-Z']*/g, (w) => (/^(N|S|E|W|NE|NW|SE|SW|MI|US|M)$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()));
}

/**
 * A short, polite permission request for a text message, from the same fields as the letter.
 * Plain ASCII punctuation keeps it in one SMS encoding (no curly quotes or dashes). Pure.
 */
export function draftText(i: TextInput): string {
  const s = i.sender;
  const place = i.siteAddress ? tidyPlace(i.siteAddress) : '';
  const where = place
    ? `your land at ${place}${i.county && !place.toLowerCase().includes(i.county.toLowerCase()) ? ` (${i.county} County)` : ''}`
    : i.parcelId
      ? `your land${i.county ? ` in ${i.county} County` : ''} (parcel ${i.parcelId})`
      : i.county
        ? `your land in ${i.county} County`
        : 'your land';
  // Phone first (it is a text, after all); email only when there is no phone.
  const reach = s.phone ? `Reach me at ${s.phone}.` : s.email ? `Reach me at ${s.email}.` : 'You can reply to this number.';
  const parts = [
    `Hi, I'm ${s.name || '[your name]'}, a licensed hunter.`,
    `May I ${i.activity || 'hunt'} on ${where} during ${i.season || '[season / dates]'}?`,
    "I'll follow your rules, park where you say and leave no trace. Happy to meet first.",
    reach,
    "If it's a no, no problem - thanks for considering it!",
  ];
  return parts.join(' ');
}

/** Digits (and a leading +) of a phone number; '' when too short to be one. Pure. */
export function cleanPhone(raw: string): string {
  const t = raw.trim();
  const digits = t.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  return (t.startsWith('+') ? '+' : '') + digits;
}

export type SmsPlatform = 'ios' | 'other';

/** iPhone / iPad (including iPadOS that reports itself as a Mac). Pure. */
export function smsPlatform(userAgent: string, maxTouchPoints = 0): SmsPlatform {
  if (/iPad|iPhone|iPod/.test(userAgent)) return 'ios';
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return 'ios';
  return 'other';
}

/**
 * sms: link that opens the messaging app with the body filled in. iOS Messages wants
 * `sms:NUMBER&body=…` (and `sms:&body=…` with no number); Android and others use the RFC 5724
 * form `sms:NUMBER?body=…`. Pure.
 */
export function smsHref(phone: string, body: string, platform: SmsPlatform): string {
  const num = cleanPhone(phone);
  const enc = encodeURIComponent(body);
  return platform === 'ios' ? `sms:${num}&body=${enc}` : `sms:${num}?body=${enc}`;
}

/** Key under which an owner's phone number is remembered on this device. Pure. */
export function ownerKey(ownerName: string, county?: string, parcelId?: string): string {
  const owner = ownerName.trim().toUpperCase().replace(/\s+/g, ' ');
  return owner ? `${(county ?? '').toUpperCase()}|${owner}` : `${(county ?? '').toUpperCase()}#${parcelId ?? ''}`;
}

interface SenderPrefs {
  name: string;
  phone: string;
  email: string;
  address: string;
  activity: string;
  season: string;
}

type Mode = 'letter' | 'text';

export async function openLetterDialog(base: Omit<LetterInput, 'sender' | 'activity' | 'season'>, initialMode: Mode = prefGet<Mode>('letterMode', 'letter')): Promise<void> {
  const prefs = prefGet<SenderPrefs>('sender', { name: '', phone: '', email: '', address: '', activity: 'hunt', season: 'the upcoming season' });
  const input = (key: keyof SenderPrefs, label: string, type = 'text', placeholder = ''): HTMLInputElement =>
    h('input', { type, value: prefs[key], placeholder, 'data-k': key, 'aria-label': label });
  const labelled = (label: string, el: HTMLElement): HTMLElement => h('label.field', {}, h('span', {}, label), el);
  const fields = {
    name: input('name', 'Your name', 'text', 'Your name'),
    phone: input('phone', 'Your phone', 'tel', 'Your phone'),
    email: input('email', 'Your email', 'email', 'Email'),
    activity: input('activity', 'Activity', 'text', 'hunt deer / turkey'),
    season: input('season', 'Season or dates', 'text', 'the 2026 firearm deer season'),
  };
  const address = h('textarea', { rows: 2, placeholder: 'Your mailing address', 'aria-label': 'Your mailing address' });
  address.value = prefs.address;
  const text = h('textarea.letter', { rows: 16, 'aria-label': 'Letter text', spellcheck: 'true' });

  // Text-message mode: the owner's number is typed by the user (county records have none) and
  // remembered for this owner on this device only.
  const phones = prefGet<Record<string, string>>('ownerPhones', {});
  const key = ownerKey(base.ownerName, base.county, base.parcelId);
  const ownerPhone = h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'off', value: phones[key] ?? '', placeholder: 'e.g. 517-555-0142', 'aria-label': 'Landowner phone number (optional)' });
  const sms = h('textarea.letter.sms', { rows: 6, 'aria-label': 'Text message', spellcheck: 'true' });
  const smsCount = h('span.muted.small');
  const platform = smsPlatform(navigator.userAgent, navigator.maxTouchPoints);
  const openSms = h('a.btn.primary', { href: '#', role: 'button' }, icon('send'), 'Open in Messages');
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  let edited = false;
  let smsEdited = false;
  const current = (): SenderPrefs => ({
    name: fields.name.value.trim(),
    phone: fields.phone.value.trim(),
    email: fields.email.value.trim(),
    address: address.value.trim(),
    activity: fields.activity.value.trim(),
    season: fields.season.value.trim(),
  });
  const syncSms = (): void => {
    openSms.setAttribute('href', smsHref(ownerPhone.value, sms.value, platform));
    const n = sms.value.length;
    const ascii = !/[^\x00-\x7f]/.test(sms.value);
    const segs = n <= (ascii ? 160 : 70) ? 1 : Math.ceil(n / (ascii ? 153 : 67));
    smsCount.textContent = `${n} characters · ${segs} text${segs === 1 ? '' : 's'}`;
  };
  const textInput = (p: SenderPrefs): TextInput => ({ siteAddress: base.siteAddress, county: base.county, parcelId: base.parcelId, sender: p, activity: p.activity, season: p.season });
  const regenerate = (): void => {
    const p = current();
    prefSet('sender', p);
    if (mode === 'letter') {
      if (edited && !confirm('Replace your edits with a fresh draft?')) return;
      edited = false;
      text.value = draftLetter({ ...base, sender: p, activity: p.activity, season: p.season });
    } else {
      if (smsEdited && !confirm('Replace your edits with a fresh message?')) return;
      smsEdited = false;
      sms.value = draftText(textInput(p));
      syncSms();
    }
  };
  text.addEventListener('input', () => {
    edited = true;
  });
  sms.addEventListener('input', () => {
    smsEdited = true;
    syncSms();
  });
  ownerPhone.addEventListener('input', syncSms);
  ownerPhone.addEventListener('change', () => {
    const all = prefGet<Record<string, string>>('ownerPhones', {});
    const v = ownerPhone.value.trim();
    if (v) all[key] = v;
    else delete all[key];
    prefSet('ownerPhones', all);
  });
  for (const el of [...Object.values(fields), address]) el.addEventListener('change', () => regenerate());
  text.value = draftLetter({ ...base, sender: { ...prefs }, activity: prefs.activity, season: prefs.season });
  sms.value = draftText(textInput(prefs));
  syncSms();

  let mode: Mode = initialMode;
  const letterOnly: HTMLElement[] = [];
  const textOnly: HTMLElement[] = [];
  const title = h('h2', {}, '');
  const seg = h(
    'div.segmented.mode-switch',
    { role: 'radiogroup', 'aria-label': 'Send as' },
    (['letter', 'text'] as Mode[]).map((m) =>
      h('button', { type: 'button', role: 'radio', 'data-mode': m, onclick: () => setMode(m) }, icon(m === 'letter' ? 'mail' : 'chat'), m === 'letter' ? 'Letter' : 'Text message'),
    ),
  );
  const setMode = (m: Mode): void => {
    mode = m;
    prefSet('letterMode', m);
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.mode === m));
    for (const el of letterOnly) el.hidden = m !== 'letter';
    for (const el of textOnly) el.hidden = m !== 'text';
    title.textContent = m === 'letter' ? 'Permission request letter' : 'Permission request by text';
  };

  const addressField = h('label.field.span2', {}, h('span', {}, 'Your mailing address'), address);
  letterOnly.push(addressField);
  const letterIntro = h('p.muted.small', {}, 'Fill in your details, then edit the letter freely. Your details are remembered on this device only.');
  letterOnly.push(letterIntro);
  const noNumbers = h(
    'div.hint',
    {},
    icon('info'),
    h('div', {}, h('strong', {}, 'SketchX has no phone numbers for landowners'), ' — county records list only a name and mailing address. If you know the owner’s number, add it below (kept for this owner on this device only); otherwise pick the contact in your messaging app.'),
  );
  const smsFoot = h(
    'footer.modal-foot',
    {},
    smsCount,
    h('span.spacer'),
    h(
      'button.btn.ghost',
      { type: 'button', onclick: async () => toast((await copyText(sms.value)) ? 'Message copied' : 'Copy failed — select the text and copy manually') },
      icon('copy'),
      'Copy',
    ),
    openSms,
  );
  const desktopNote = coarse ? null : h('p.muted.small', {}, 'On a computer the Messages button may do nothing — use Copy and send it from your phone.');
  const textBlock = h('div.sms-block', {}, noNumbers, labelled('Landowner’s mobile number (optional)', ownerPhone), sms, desktopNote, smsFoot);
  textOnly.push(textBlock);
  const letterFoot = h(
    'footer.modal-foot',
    {},
    h('button.btn.ghost', { type: 'button', onclick: () => downloadText('permission-request.txt', text.value, 'text/plain') }, icon('download'), 'Save .txt'),
    'share' in navigator
      ? h(
          'button.btn.ghost',
          {
            type: 'button',
            onclick: async () => {
              try {
                await navigator.share({ title: 'Hunting permission request', text: text.value });
              } catch {
                /* cancelled */
              }
            },
          },
          icon('share'),
          'Share',
        )
      : null,
    h(
      'button.btn.primary',
      {
        type: 'button',
        onclick: async () => toast((await copyText(text.value)) ? 'Letter copied' : 'Copy failed — select the text and copy manually'),
      },
      icon('copy'),
      'Copy',
    ),
  );
  const letterBlock = h('div.letter-block', {}, text, letterFoot);
  const textTitle = h('h3.pane-title', {}, 'Your details (used in the message)');
  textOnly.push(textTitle);
  letterOnly.push(letterBlock);

  const dlg = h(
    'dialog.modal.wide',
    { 'aria-label': 'Permission request' },
    h(
      'form',
      { method: 'dialog' },
      h('header.modal-head', {}, icon('mail'), title, h('button.icon-btn', { value: 'close', 'aria-label': 'Close' }, icon('close'))),
      seg,
      letterIntro,
      textBlock,
      textTitle,
      h(
        'div.grid2',
        {},
        labelled('Your name', fields.name),
        labelled('Your phone', fields.phone),
        labelled('Your email', fields.email),
        labelled('Asking to…', fields.activity),
        labelled('When', fields.season),
        addressField,
      ),
      letterBlock,
    ),
  );
  setMode(mode);
  await showDialog(dlg);
}
