// Polite access-permission request letter. Pure text generation (unit-tested) + dialog UI.

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

interface SenderPrefs {
  name: string;
  phone: string;
  email: string;
  address: string;
  activity: string;
  season: string;
}

export async function openLetterDialog(base: Omit<LetterInput, 'sender' | 'activity' | 'season'>): Promise<void> {
  const prefs = prefGet<SenderPrefs>('sender', { name: '', phone: '', email: '', address: '', activity: 'hunt', season: 'the upcoming season' });
  const input = (key: keyof SenderPrefs, label: string, type = 'text', placeholder = ''): HTMLInputElement =>
    h('input', { type, value: prefs[key], placeholder, 'data-k': key, 'aria-label': label });
  const labelled = (label: string, el: HTMLElement): HTMLElement => h('label.field', {}, h('span', {}, label), el);
  const fields = {
    name: input('name', 'Your name', 'text', 'Your name'),
    phone: input('phone', 'Phone', 'tel', 'Phone'),
    email: input('email', 'Email', 'email', 'Email'),
    activity: input('activity', 'Activity', 'text', 'hunt deer / turkey'),
    season: input('season', 'Season or dates', 'text', 'the 2026 firearm deer season'),
  };
  const address = h('textarea', { rows: 2, placeholder: 'Your mailing address', 'aria-label': 'Your mailing address' });
  address.value = prefs.address;
  const text = h('textarea.letter', { rows: 16, 'aria-label': 'Letter text', spellcheck: 'true' });
  let edited = false;
  const regenerate = (): void => {
    const p: SenderPrefs = {
      name: fields.name.value.trim(),
      phone: fields.phone.value.trim(),
      email: fields.email.value.trim(),
      address: address.value.trim(),
      activity: fields.activity.value.trim(),
      season: fields.season.value.trim(),
    };
    prefSet('sender', p);
    if (edited && !confirm('Replace your edits with a fresh draft?')) return;
    edited = false;
    text.value = draftLetter({ ...base, sender: p, activity: p.activity, season: p.season });
  };
  text.addEventListener('input', () => {
    edited = true;
  });
  for (const el of [...Object.values(fields), address]) el.addEventListener('change', () => regenerate());
  text.value = draftLetter({ ...base, sender: { ...prefs }, activity: prefs.activity, season: prefs.season });

  const dlg = h(
    'dialog.modal.wide',
    { 'aria-label': 'Permission letter' },
    h(
      'form',
      { method: 'dialog' },
      h('header.modal-head', {}, icon('mail'), h('h2', {}, 'Permission request letter'), h('button.icon-btn', { value: 'close', 'aria-label': 'Close' }, icon('close'))),
      h('p.muted.small', {}, 'Fill in your details, then edit the letter freely. Your details are remembered on this device only.'),
      h(
        'div.grid2',
        {},
        labelled('Your name', fields.name),
        labelled('Phone', fields.phone),
        labelled('Email', fields.email),
        labelled('Asking to…', fields.activity),
        labelled('When', fields.season),
        h('label.field.span2', {}, h('span', {}, 'Your mailing address'), address),
      ),
      text,
      h(
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
      ),
    ),
  );
  await showDialog(dlg);
}
