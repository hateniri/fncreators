import { SITE } from './site';

const jstFull = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const jstCard = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tokyo',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatCardDate(date: Date): string {
  const parts = jstCard.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`;
}

export function formatFullDate(date: Date): string {
  return `${jstFull.format(date)} 日本時間`;
}

export function xShareHref(title: string, url: string): string {
  const params = new URLSearchParams({
    text: `${title}｜${SITE.name}（非公式）`,
    url,
    via: SITE.xHandle,
  });
  return `https://x.com/intent/post?${params.toString()}`;
}

export function socialImage(cover?: string): string {
  if (!cover) return '/og.png';
  const path = cover.split('?')[0] ?? cover;
  if (/\.(png|jpe?g|webp|gif)$/i.test(path)) return cover;
  // fortnite.com のカード画像は拡張子の無い CMS URL のことがある。中身は JPEG。
  if (/^https:\/\/([\w.-]+\.)?(unrealengine\.com|epicgames\.com)\//i.test(cover)) return cover;
  return '/og.png';
}
