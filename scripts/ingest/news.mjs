/**
 * 公開フィードから Fortnite ニュースを Markdown にする。
 *
 * 優先順:
 * 1. fortnite.com の公式ニュース JSON（/news.data?lang=ja）。ログイン不要。
 *    Cloudflare がデータセンター IP を止めたときは、その回は記事を足さず警告だけ出す。
 * 2. ロビー告知。公式 PRM は Authorization が要るため使わない。
 *    キーなしで読める fortnite-api.com の日本語フィードを使う。画像 URL は Epic の CDN。
 * 3. アイテムショップ。同じ公開フィード。画像は公式コスメのミラーであることが多い。
 * 4. status.epicgames.com。Fortnite / UEFN 関連が通常以外のときだけ記事にする。
 *
 * トークンは必須ではない。FORTNITE_API_KEY があれば fortnite-api.com に載せる。
 * 無くても公開エンドポイントを試し、401 のときはその源だけ飛ばす。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const POSTS_DIR = resolve(ROOT, 'content/posts');
export const STATE_PATH = resolve(ROOT, 'scripts/ingest/state.json');

export const SUMMARY_MAX = 140;
export const DISCLAIMER =
  'この記事は非公式ファンサイト FN Creators JP のまとめです。Epic Games、Fortnite、FortniteJP とは関係ありません。';

const CONFIRMED_SUFFIX = '公式ベース。非公式のまとめ。';
const RUMOR_SUFFIX = '未確認。非公式のまとめ。';
const RUMOR_CALLOUT =
  '未確認です。公式の文章、ショップ、ステータスページでは裏が取れていません。リークや噂として扱い、確定した発表のように共有しないでください。';

const BLOG_ORIGIN = 'https://www.fortnite.com';
const NEWS_API = 'https://fortnite-api.com/v2/news?language=ja';
const SHOP_API = 'https://fortnite-api.com/v2/shop?language=ja';
const STATUS_API = 'https://status.epicgames.com/api/v2/summary.json';

const USER_AGENT = 'FNCreatorsJP-ingest/1.0 (+https://fncreators.com; unofficial fan site)';

const GENERIC_SHELVES = new Set([
  'ジャムトラック',
  'ピークスタイル',
  '最高にクール',
  'ゼロチル',
  'ノースウェット',
  'その他',
]);

const FORTNITE_STATUS = /fortnite|uefn/i;

export function clampSummary(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  if (flat.length <= SUMMARY_MAX) return flat;
  return `${flat.slice(0, SUMMARY_MAX - 1).trimEnd()}…`;
}

export function summaryWithSuffix(core, notice) {
  const suffix = notice === 'rumor' ? RUMOR_SUFFIX : CONFIRMED_SUFFIX;
  const head = String(core).replace(/\s+/g, ' ').trim();
  const room = SUMMARY_MAX - suffix.length - 1;
  if (!head) return suffix;
  if (head.length <= room) return `${head} ${suffix}`;
  return `${head.slice(0, Math.max(0, room - 1)).trimEnd()}… ${suffix}`;
}

export function slugify(value) {
  const slug = String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || 'item';
}

export function formatOffset(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}+09:00`;
}

export function formatJst(date) {
  const text = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${text} 日本時間`;
}

function dq(value) {
  return JSON.stringify(String(value));
}

function httpsUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return null;
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

const TAG_JA = new Map([
  ['developer stories', 'クリエイター'],
  ['battle royale', 'バトルロイヤル'],
  ['ranked battle royale', 'ランク'],
  ['uefn and creative', 'UEFN'],
  ['fortnite competitive', '競技'],
  ['fortnite news', 'ニュース'],
  ['reload', 'リロード'],
  ['save the world', '世界を救え'],
  ['lego fortnite odyssey', 'LEGO'],
  ['lego fortnite brick life', 'LEGO'],
]);

function localizeTag(label) {
  const text = plain(label ?? '');
  if (!text) return '';
  const mapped = TAG_JA.get(text.toLowerCase());
  if (mapped) return mapped;
  if (/[ぁ-んァ-ン一-龯]/.test(text)) return text;
  return '';
}

function cleanTags(tags) {
  const out = [];
  for (const tag of tags) {
    const value = String(tag).replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!value || out.includes(value)) continue;
    out.push(value);
    if (out.length === 4) break;
  }
  return out.length > 0 ? out : ['ニュース'];
}

function safeToken(raw) {
  const cleaned = String(raw)
    .trim()
    .replace(/[^A-Za-z0-9:_./-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 140);
  return cleaned || 'item';
}

function quoteBlock(text) {
  const clean = String(text).replace(/\r\n/g, '\n').trim();
  if (!clean) return '';
  return clean
    .split('\n')
    .map((line) => `> ${line.replace(/</g, '＜').replace(/^>\s?/, '')}`)
    .join('\n');
}

function plain(text) {
  return String(text).replace(/</g, '＜').replace(/\s+/g, ' ').trim();
}

export function decodeFortniteData(payload) {
  if (!Array.isArray(payload)) return payload;
  const get = (index, depth) => {
    if (!Number.isInteger(index) || index < 0 || index >= payload.length || depth > 40) return null;
    const value = payload[index];
    if (Array.isArray(value)) {
      return value.map((element) => (typeof element === 'number' ? get(element, depth + 1) : element));
    }
    if (isIndexObject(value)) {
      const object = {};
      for (const [key, child] of Object.entries(value)) {
        const name = payload[Number(key.slice(1))];
        if (typeof name !== 'string' || typeof child !== 'number') continue;
        object[name] = get(child, depth + 1);
      }
      return object;
    }
    return value ?? null;
  };
  return get(0, 0);
}

function isIndexObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => /^_\d+$/.test(key));
}

export function listNewsItems(decoded) {
  const pages = ['routes/news._index', 'routes/news.tag.$tag']
    .map((key) => decoded?.[key]?.data)
    .filter(Boolean);
  const items = [];
  const seen = new Set();
  for (const page of pages) {
    const list = [];
    if (page.heroNewsItem) list.push(page.heroNewsItem);
    if (Array.isArray(page.recentNewsItems?.newsItems)) list.push(...page.recentNewsItems.newsItems);
    for (const item of list) {
      const link = typeof item?.link === 'string' ? item.link : '';
      if (!link || seen.has(link)) continue;
      seen.add(link);
      items.push(item);
    }
  }
  return items;
}

export function articleFromDecoded(decoded) {
  return decoded?.['routes/news.$']?.data?.newsArticle ?? decoded?.newsArticle ?? null;
}

export function slugFromNewsLink(link) {
  const path = new URL(link, BLOG_ORIGIN).pathname;
  const slug = path.split('/').filter(Boolean).pop() ?? '';
  return slugify(slug);
}

function nodeText(node) {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.children)) return '';
  return node.children.map((child) => nodeText(child)).join('');
}

export function extractArticle(article) {
  const headings = [];
  const paragraphs = [];
  const images = [];
  const videos = [];
  const pushImage = (url) => {
    const href = httpsUrl(typeof url === 'string' ? originalImage(url) : '');
    if (href) images.push(href);
  };
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string' && /^heading-/.test(node.type)) {
      const text = plain(nodeText(node));
      if (text) headings.push(text);
      return;
    }
    if (node.type === 'paragraph') {
      const text = plain(nodeText(node));
      if (text) paragraphs.push(text);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  };
  for (const section of article?.sections ?? []) {
    const type = section?.__typename;
    if (type === 'ElementRichText') walk(section.text?.raw ?? section.text ?? {});
    else if (type === 'ElementLegacyRichText') absorbMarkdown(section.content?.markdown ?? '', headings, paragraphs);
    else if (type === 'ElementArticleImage') pushImage(section.image?.src ?? section.image?.url ?? section.src);
    else if (type === 'ElementImageGallery') {
      for (const image of section.images ?? []) pushImage(image.src ?? image.url);
    } else if (type === 'ElementArticleVideoYouTube' && section.youTubeVideoId) {
      videos.push(`https://www.youtube.com/watch?v=${encodeURIComponent(section.youTubeVideoId)}`);
    } else if (type === 'ElementArticleVideoEmbed') {
      const href = httpsUrl(section.url ?? section.embedUrl ?? '');
      if (href) videos.push(href);
    }
  }
  return {
    headings: uniqueStrings(headings).slice(0, 6),
    paragraphs: uniqueStrings(paragraphs).slice(0, 3),
    images,
    videos: uniqueStrings(videos).slice(0, 2),
  };
}

function absorbMarkdown(markdown, headings, paragraphs) {
  for (const line of String(markdown).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      const text = plain(trimmed.replace(/^#+\s*/, ''));
      if (text) headings.push(text);
      continue;
    }
    if (trimmed.startsWith('![')) continue;
    paragraphs.push(plain(trimmed.replace(/^[-*]\s+/, '')));
  }
}

function uniqueStrings(values) {
  const out = [];
  for (const value of values) {
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

function originalImage(url) {
  return url.replace('/resize=fit:clip,width:1920/quality=value:80/', '/');
}

export function draftFromArticle(article, listItem) {
  const link = listItem?.link ?? article?.url ?? article?.slug ?? '';
  const slug = slugFromNewsLink(link || article?.slug || 'news');
  const title = plain(article?.title ?? listItem?.heading ?? '');
  const published = new Date(article?.publishedDate ?? article?.date ?? '');
  if (!title || Number.isNaN(published.getTime())) return null;
  const extracted = extractArticle(article);
  const lead = extracted.paragraphs[0] ?? `${title}が公式ニュースに出ている。`;
  const tags = cleanTags([
    ...(listItem?.tags ?? article?.tags ?? []).map((tag) => localizeTag(tag?.label ?? tag)).filter(Boolean),
    /フォートナイトメア|ホラー/.test(`${title}\n${lead}`) ? 'フォートナイトメア' : '',
  ]);
  const cover =
    httpsUrl(originalImage(listItem?.imgSrc ?? '')) ??
    extracted.images.find((url) => /unrealengine|epicgames/i.test(url)) ??
    extracted.images[0] ??
    null;
  const lines = [
    '公式ニュースが公開されている。全文は転載しない。見出しと書き出しだけを、出典と分けて置く。',
    '',
  ];
  if (extracted.headings.length > 0) {
    lines.push('公式記事の見出し:');
    lines.push('');
    for (const heading of extracted.headings) lines.push(`- ${heading}`);
    lines.push('');
  }
  lines.push('書き出し:');
  lines.push('');
  lines.push(quoteBlock(lead.slice(0, 280)));
  if (extracted.videos.length > 0) {
    lines.push('');
    lines.push('公式の動画:');
    lines.push('');
    for (const video of extracted.videos) lines.push(`- ${video}`);
  }
  if (published.toISOString().endsWith('T00:00:00.000Z')) {
    lines.push('');
    lines.push('公開時刻はフィード上では日付だけ（UTC の 0時）だった。表示の時刻は、その日付を日本時間に直したもの。');
  }
  lines.push('');
  lines.push(cover ? '画像は公式記事（またはそのカード）の URL をそのまま参照している。' : 'カード画像は公式フィードに無かった。');
  lines.push('');
  lines.push(DISCLAIMER);
  return {
    ingestId: `blog:${slug}`,
    slug,
    title: title.slice(0, 80),
    date: published,
    tags,
    summaryCore: lead,
    cover,
    notice: 'confirmed',
    source: {
      name: 'Fortnite 公式ニュース',
      url: `https://www.fortnite.com/news/${slug}?lang=ja`,
    },
    body: lines.join('\n'),
  };
}

function modeLabel(mode) {
  if (mode === 'br') return 'バトルロイヤル';
  if (mode === 'stw') return '世界を救え';
  if (mode === 'creative') return 'クリエイティブ';
  return 'ロビー';
}

function motdTags(mode, title, body) {
  const blob = `${title}\n${body}`;
  const tags = [modeLabel(mode)];
  if (/フォートナイトメア|Fortnitemares|ホラー|ファイブ・ナイツ|フレディ/.test(blob)) tags.push('フォートナイトメア');
  if (/クリエイティブ|UEFN|開発者|島のコレクション/.test(blob)) tags.push('UEFN');
  if (/ショップ|アイテムショップ/.test(blob)) tags.push('ショップ');
  if (/コラボ|ソニック|テトリス|パックマン|ファイブ・ナイツ|ハズビン|ビートルジュース/.test(blob)) tags.push('コラボ');
  return cleanTags(tags);
}

export function draftsFromMotdPayload(payload, now = new Date()) {
  const data = payload?.data ?? payload;
  if (!data || typeof data !== 'object') return [];
  const lookbackDays = lookbackDaysFrom(now);
  const drafts = [];
  for (const [mode, feed] of Object.entries(data)) {
    if (!feed || typeof feed !== 'object' || Array.isArray(feed)) continue;
    const feedDate = new Date(feed.date ?? 0);
    if (Number.isNaN(feedDate.getTime())) continue;
    if (now.getTime() - feedDate.getTime() > lookbackDays * 86400000) continue;
    const items = [...(feed.motds ?? []), ...(feed.messages ?? [])].filter((item) => item && item.hidden !== true);
    items.sort((a, b) => (b.sortingPriority ?? 0) - (a.sortingPriority ?? 0));
    items.forEach((item, index) => {
      const title = plain(item.title ?? item.tabTitle ?? '');
      if (!title) return;
      const body = plain(item.body ?? '');
      const id = safeToken(item.id ?? `${mode}-${title}`);
      const cover = httpsUrl(item.image) ?? httpsUrl(item.tileImage);
      const date = new Date(feedDate.getTime() - index * 1000);
      const label = modeLabel(mode);
      drafts.push({
        ingestId: `motd:${id}`,
        slug: `motd-${slugify(id).slice(0, 24)}`,
        title: title.slice(0, 80),
        date,
        tags: motdTags(mode, title, body),
        summaryCore: `${label}のロビー告知「${title}」。${body}`,
        cover,
        notice: 'confirmed',
        source: {
          name: 'Fortnite ロビー告知（公開フィード経由、画像は Epic CDN）',
          url: 'https://www.fortnite.com/news?lang=ja',
        },
        body: [
          `${label}のロビーに、公式の告知が出ている。フィードの更新は ${formatJst(feedDate)}。`,
          '',
          `見出しは「${title.replace(/</g, '＜')}」。告知文は次のとおり。`,
          '',
          quoteBlock(body || title),
          '',
          cover
            ? '画像は Epic の配信用 CDN をそのまま参照している。日本語の文面は、公式ロビー告知を中継する公開フィード（fortnite-api.com）から取得した。'
            : 'この項目に公開画像は無かった。日本語の文面は、公式ロビー告知を中継する公開フィード（fortnite-api.com）から取得した。',
          '',
          DISCLAIMER,
        ].join('\n'),
      });
    });
  }
  return drafts;
}

function entryLabels(entry) {
  const labels = [];
  for (const key of ['brItems', 'tracks', 'instruments', 'cars', 'legoKits']) {
    for (const item of entry[key] ?? []) {
      const name = plain(item?.name ?? item?.title ?? '');
      if (!name) continue;
      const type =
        item?.type?.displayValue ??
        item?.type?.value ??
        (key === 'tracks' ? 'ジャムトラック' : key === 'instruments' ? '楽器' : '');
      labels.push({ name, type: typeof type === 'string' ? type : '' });
    }
  }
  return labels;
}

function entryImage(entry) {
  const official = [];
  const mirror = [];
  const consider = (url) => {
    const href = httpsUrl(url);
    if (!href) return;
    if (/unrealengine\.com|epicgames\.com/i.test(href)) official.push(href);
    else mirror.push(href);
  };
  for (const item of entry.brItems ?? []) {
    consider(item.images?.featured);
    consider(item.images?.icon);
    consider(item.images?.smallIcon);
  }
  for (const image of entry.newDisplayAsset?.renderImages ?? []) consider(image.image);
  for (const track of entry.tracks ?? []) consider(track.albumArt);
  return official[0] ?? mirror[0] ?? null;
}

function isNewEntry(entry) {
  const banner = entry?.banner;
  if (!banner || typeof banner !== 'object') return false;
  return banner.backendValue === 'New' || banner.value === '新規';
}

function shelfName(entry) {
  return plain(entry.layout?.name ?? '') || 'その他';
}

export function draftFromShop(payload, now = new Date()) {
  const data = payload?.data;
  const entries = data?.entries;
  if (!data?.hash || !Array.isArray(entries)) return null;
  const groups = new Map();
  const shelves = new Map();
  const shelfCovers = new Map();
  let earliestOut = null;
  for (const entry of entries) {
    const shelf = shelfName(entry);
    shelves.set(shelf, (shelves.get(shelf) ?? 0) + 1);
    if (!isNewEntry(entry)) continue;
    const labels = entryLabels(entry);
    if (labels.length === 0) continue;
    const group = groups.get(shelf) ?? [];
    const price = typeof entry.finalPrice === 'number' ? entry.finalPrice : null;
    for (const label of labels) {
      if (group.some((row) => row.name === label.name)) continue;
      group.push({ name: label.name, type: label.type, price });
    }
    groups.set(shelf, group);
    const out = new Date(entry.outDate ?? 0);
    if (!Number.isNaN(out.getTime()) && (!earliestOut || out < earliestOut)) earliestOut = out;
    const image = entryImage(entry);
    const score = labels.some((label) => /コスチューム|アウトフィット|Outfit|サイドキック/.test(label.type))
      ? 3
      : labels.some((label) => label.type && label.type !== 'ジャムトラック')
        ? 2
        : 1;
    const previous = shelfCovers.get(shelf);
    if (image && (!previous || score > previous.score)) shelfCovers.set(shelf, { score, url: image });
  }
  if (groups.size === 0) return null;
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const cover = ordered.map(([shelf]) => shelfCovers.get(shelf)?.url).find(Boolean) ?? null;
  const shopDate = new Date(data.date ?? now);
  const when = Number.isNaN(shopDate.getTime()) ? now : shopDate;
  const topShelf = ordered[0][0];
  const title =
    ordered.length > 1
      ? `${formatMonthDay(when)} ショップ更新: ${topShelf}、ほか${ordered.length - 1}枠`
      : `${formatMonthDay(when)} ショップ更新: ${topShelf}`;
  const highlight = ordered
    .slice(0, 3)
    .flatMap(([, rows]) => rows.slice(0, 2).map((row) => row.name));
  const collabShelves = [...shelves.keys()]
    .map((name) => name.trim())
    .filter((name) => name && !GENERIC_SHELVES.has(name));
  const lines = [
    `アイテムショップの公開データが更新されている。ショップ日付は ${formatJst(when)}。この記事を書いたのは ${formatJst(now)}。`,
    '',
    '新規表示の項目だけを、棚の名前ごとにまとめた。価格は取得時点の V-Bucks で、日中に変わることがある。',
    '',
  ];
  for (const [shelf, rows] of ordered.slice(0, 8)) {
    lines.push(`## ${shelf}`);
    lines.push('');
    for (const row of rows.slice(0, 6)) {
      const type = row.type ? `（${row.type}）` : '';
      const price = typeof row.price === 'number' ? ` / ${row.price.toLocaleString('ja-JP')} V-Bucks` : '';
      lines.push(`- ${row.name}${type}${price}`);
    }
    if (rows.length > 6) lines.push(`- ほか ${rows.length - 6} 件。出典のショップで確認`);
    lines.push('');
  }
  if (ordered.length > 8) lines.push(`新規の棚はほかに ${ordered.length - 8} 枠ある。`);
  if (collabShelves.length > 0) {
    lines.push('');
    lines.push('いまデータ上にあるコラボ寄りの棚（新規とは限らない。名前のみ）:');
    lines.push('');
    lines.push(collabShelves.slice(0, 16).map((name) => `- ${name}`).join('\n'));
  }
  if (earliestOut) {
    lines.push('');
    lines.push(`新規オファーのうち、いちばん早い終了予定は ${formatJst(earliestOut)}（データの outDate。前後することがある）。`);
  }
  lines.push('');
  lines.push(
    cover && /fortnite-api\.com/i.test(cover)
      ? 'カード画像は fortnite-api.com が配っている公式コスメ画像のミラーである。Epic の CDN URL がレスポンスに含まれる項目は、そちらを優先している。'
      : 'カード画像は公開ショップデータに含まれていた URL を参照している。',
  );
  lines.push('');
  lines.push(DISCLAIMER);
  const hash = safeToken(data.hash).slice(0, 16);
  const day = formatOffset(when).slice(0, 10);
  return {
    ingestId: `shop:${hash}`,
    slug: `shop-${day}-${slugify(hash).slice(0, 12)}`,
    title: title.slice(0, 80),
    date: now,
    tags: cleanTags([
      'ショップ',
      collabShelves.some((name) => !/FNCS|恐怖のロッカー/.test(name)) ? 'コラボ' : '',
      /フォートナイトメア|恐怖/.test(`${topShelf} ${collabShelves.join(' ')}`) ? 'フォートナイトメア' : '',
      /FNCS/.test(collabShelves.join(' ')) ? '競技' : '',
    ]),
    summaryCore: `ショップに新規表示。${highlight.slice(0, 4).join('、') || topShelf}。価格は取得時点。`,
    cover,
    notice: 'confirmed',
    source: {
      name: 'Fortnite アイテムショップ（公開データ。fortnite-api.com 経由）',
      url: 'https://www.fortnite.com/item-shop?lang=ja',
    },
    body: lines.filter((line, index, all) => !(line === '' && all[index - 1] === '')).join('\n'),
  };
}

function formatMonthDay(date) {
  const iso = formatOffset(date);
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}

const STATUS_LABEL = {
  operational: '通常',
  degraded_performance: '性能低下',
  partial_outage: '一部障害',
  major_outage: '重大な障害',
  under_maintenance: 'メンテナンス中',
  investigating: '調査中',
  identified: '原因を特定',
  monitoring: '監視中',
  in_progress: '実施中',
  scheduled: '予定',
  verifying: '確認中',
  resolved: '復旧',
  completed: '完了',
};

function statusLabel(status) {
  return STATUS_LABEL[status] ?? status ?? '不明';
}

function affectsFortnite(components, name = '') {
  if (FORTNITE_STATUS.test(name)) return true;
  return (components ?? []).some((component) => FORTNITE_STATUS.test(component.name ?? ''));
}

export function draftsFromStatus(payload, now = new Date()) {
  const drafts = [];
  const hours = Number(process.env.INGEST_MAINTENANCE_HOURS ?? 72);
  const covered = new Set();
  for (const incident of payload?.incidents ?? []) {
    if (!affectsFortnite(incident.components, incident.name)) continue;
    const updated = new Date(incident.updated_at ?? incident.started_at ?? now);
    const latest = incident.incident_updates?.[0];
    const detail = plain(latest?.body ?? '').slice(0, 500);
    const id = safeToken(incident.id ?? incident.name);
    drafts.push(
      statusDraft({
        ingestId: `status:${id}`,
        slug: `status-${slugify(id).slice(0, 40)}`,
        title: `ステータス: ${plain(incident.name ?? 'Fortnite')}`,
        date: Number.isNaN(updated.getTime()) ? now : updated,
        summaryCore: `Epic のステータスで Fortnite 関連が「${statusLabel(incident.status)}」。`,
        url: httpsUrl(incident.shortlink) ?? 'https://status.epicgames.com',
        body: [
          `Epic Games の公開ステータスに、Fortnite 関連のインシデントがある。状態は「${statusLabel(incident.status)}」。`,
          '',
          `公式の件名: ${plain(incident.name ?? '')}`,
          '',
          detail ? quoteBlock(detail) : '更新文面はレスポンスに無かった。',
          '',
          '文面はステータスページのものを引用している。英語のままの場合がある。',
          '',
          DISCLAIMER,
        ].join('\n'),
      }),
    );
    for (const component of incident.components ?? []) {
      if (component.id) covered.add(component.id);
      if (component.name) covered.add(component.name);
    }
  }
  for (const component of payload?.components ?? []) {
    if (!FORTNITE_STATUS.test(component.name ?? '')) continue;
    if (!component.status || component.status === 'operational') continue;
    if (covered.has(component.id) || covered.has(component.name)) continue;
    const id = safeToken(component.id ?? component.name);
    drafts.push(
      statusDraft({
        ingestId: `status:component:${id}:${safeToken(component.status)}`,
        slug: `status-${slugify(component.name)}-${slugify(component.status)}`,
        title: `ステータス: ${component.name} は${statusLabel(component.status)}`,
        date: now,
        summaryCore: `${component.name} の公開ステータスが「${statusLabel(component.status)}」。`,
        url: 'https://status.epicgames.com',
        body: [
          `Epic の公開ステータスで、${component.name} が「${statusLabel(component.status)}」になっている。個別のインシデント文面は、このレスポンスには無かった。`,
          '',
          '最新は出典のステータスページで確認できる。復旧の記事は自動では作らない。',
          '',
          DISCLAIMER,
        ].join('\n'),
      }),
    );
  }
  for (const maintenance of payload?.scheduled_maintenances ?? []) {
    if (!affectsFortnite(maintenance.components, maintenance.name)) continue;
    const start = new Date(maintenance.scheduled_for ?? maintenance.started_at ?? 0);
    if (Number.isNaN(start.getTime())) continue;
    const delta = start.getTime() - now.getTime();
    const soon = delta >= -3600000 && delta <= hours * 3600000;
    const active = maintenance.status === 'in_progress' || maintenance.status === 'verifying';
    if (!soon && !active) continue;
    const id = safeToken(maintenance.id ?? maintenance.name);
    drafts.push(
      statusDraft({
        ingestId: `status:maint:${id}`,
        slug: `status-maint-${slugify(id).slice(0, 40)}`,
        title: `メンテナンス: ${plain(maintenance.name ?? 'Fortnite')}`,
        date: start,
        summaryCore: `Fortnite 関連のメンテナンス予定が ${formatJst(start)}。`,
        url: httpsUrl(maintenance.shortlink) ?? 'https://status.epicgames.com',
        body: [
          `Epic の公開ステータスに、Fortnite 関連のメンテナンスがある。開始予定は ${formatJst(start)}。状態は「${statusLabel(maintenance.status)}」。`,
          '',
          quoteBlock(plain(maintenance.incident_updates?.[0]?.body ?? maintenance.name ?? '').slice(0, 500)),
          '',
          DISCLAIMER,
        ].join('\n'),
      }),
    );
  }
  return drafts;
}

function statusDraft(draft) {
  return {
    ...draft,
    title: draft.title.slice(0, 80),
    tags: cleanTags(['ステータス', /UEFN/i.test(draft.title) ? 'UEFN' : 'バトルロイヤル']),
    cover: null,
    notice: 'confirmed',
    source: { name: 'Epic Games ステータス', url: draft.url },
  };
}

function lookbackDaysFrom(now) {
  const parsed = Number(process.env.INGEST_LOOKBACK_DAYS ?? 30);
  if (!Number.isFinite(parsed) || parsed < 1) return 30;
  void now;
  return parsed;
}

export function selectDrafts(items, existing, max) {
  const fresh = items.filter((item) => item?.ingestId && !existing.has(item.ingestId));
  fresh.sort((a, b) => b.date.getTime() - a.date.getTime() || a.ingestId.localeCompare(b.ingestId));
  const limit = Number.isFinite(max) && max > 0 ? max : fresh.length;
  return fresh.slice(0, limit);
}

export function renderMarkdown(draft) {
  const summary = summaryWithSuffix(draft.summaryCore, draft.notice);
  if (summary.length > SUMMARY_MAX) {
    throw new Error(`summary too long for ${draft.ingestId}`);
  }
  if (draft.notice !== 'confirmed' && draft.notice !== 'rumor') {
    throw new Error(`notice missing for ${draft.ingestId}`);
  }
  new URL(draft.source.url);
  const tags = cleanTags(draft.tags);
  const lines = [
    '---',
    `title: ${dq(draft.title)}`,
    `date: ${dq(formatOffset(draft.date))}`,
    'tags:',
    ...tags.map((tag) => `  - ${dq(tag)}`),
    `summary: ${dq(summary)}`,
  ];
  if (draft.cover) lines.push(`cover: ${dq(draft.cover)}`);
  lines.push(`notice: ${dq(draft.notice)}`);
  lines.push('source:');
  lines.push(`  name: ${dq(draft.source.name)}`);
  lines.push(`  url: ${dq(draft.source.url)}`);
  lines.push('---', '');
  if (draft.notice === 'rumor') {
    lines.push(`> **未確認** ${RUMOR_CALLOUT}`, '');
  }
  const body = draft.body.includes('Epic Games、Fortnite、FortniteJP とは関係ありません')
    ? draft.body.trim()
    : `${draft.body.trim()}\n\n${DISCLAIMER}`;
  lines.push(body, '', `<!-- ingest:${draft.ingestId} -->`, '');
  return lines.join('\n');
}

export function ingestIdsInMarkdown(markdown) {
  return [...String(markdown).matchAll(/<!--\s*ingest:([A-Za-z0-9:_./-]+)\s*-->/g)].map((match) => match[1]);
}

export function readState(text) {
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed?.ids) ? parsed.ids.filter((id) => typeof id === 'string') : [];
}

async function getJson(fetchImpl, url, headers) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers,
        redirect: 'follow',
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(25000) : undefined,
      });
      const type = response.headers.get('content-type') ?? '';
      const text = await response.text();
      const blocked =
        type.includes('text/html') ||
        text.trimStart().startsWith('<') ||
        text.includes('Just a moment') ||
        text.includes('cf-mitigated');
      if (blocked) {
        const error = new Error(`Cloudflare などで JSON が返りませんでした (${response.status}) ${url}`);
        error.code = 'BLOCKED';
        throw error;
      }
      if (response.status === 401 || response.status === 403) {
        const error = new Error(`認証が拒まれました (${response.status}) ${url}`);
        error.code = 'OPTIONAL';
        throw error;
      }
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`一時的な失敗 (${response.status}) ${url}`);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500));
        continue;
      }
      if (!response.ok) {
        throw new Error(`取得失敗 (${response.status}) ${url}`);
      }
      return JSON.parse(text);
    } catch (error) {
      if (error.code === 'BLOCKED' || error.code === 'OPTIONAL') throw error;
      lastError = error;
      if (attempt === 0 && error.name !== 'SyntaxError') {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error(`取得失敗 ${url}`);
}

function apiHeaders(env) {
  const headers = {
    accept: 'application/json,text/plain,*/*',
    'accept-language': 'ja,en;q=0.8',
    'user-agent': USER_AGENT,
  };
  if (env.FORTNITE_API_KEY) headers.authorization = env.FORTNITE_API_KEY;
  return headers;
}

async function loadBlog(fetchImpl, env, now) {
  const headers = apiHeaders(env);
  const paths = ['/news', '/news/tag/all-news'];
  const list = [];
  let blocked = false;
  for (const path of paths) {
    try {
      const payload = await getJson(fetchImpl, `${BLOG_ORIGIN}${path}.data?lang=ja`, headers);
      list.push(...listNewsItems(decodeFortniteData(payload)));
    } catch (error) {
      if (error.code === 'BLOCKED' || error.code === 'OPTIONAL') {
        blocked = true;
        continue;
      }
      throw error;
    }
  }
  if (list.length === 0 && blocked) {
    const error = new Error('fortnite.com のニュース JSON は Cloudflare に遮られました。この回の公式記事はスキップします。');
    error.code = 'BLOCKED';
    throw error;
  }
  const seen = new Set();
  const drafts = [];
  for (const item of list) {
    const slug = slugFromNewsLink(item.link);
    if (!slug || seen.has(slug)) continue;
    if (seen.size >= 20) break;
    seen.add(slug);
    try {
      const payload = await getJson(fetchImpl, `${BLOG_ORIGIN}/news/${slug}.data?lang=ja`, headers);
      const article = articleFromDecoded(decodeFortniteData(payload));
      const draft = article ? draftFromArticle(article, item) : null;
      if (!draft) continue;
      const age = now.getTime() - draft.date.getTime();
      if (age > lookbackDaysFrom(now) * 86400000 || age < -2 * 86400000) continue;
      drafts.push(draft);
    } catch (error) {
      if (error.code === 'BLOCKED' || error.code === 'OPTIONAL') {
        blocked = true;
        continue;
      }
      throw error;
    }
  }
  return { drafts, note: blocked ? '一部の公式記事 JSON は遮られました。' : '' };
}

async function loadSource(name, run) {
  try {
    const result = await run();
    const drafts = Array.isArray(result) ? result : result.drafts;
    const note = Array.isArray(result) ? '' : result.note;
    return { name, ok: true, drafts: drafts.filter(Boolean), warning: note || '', failure: '' };
  } catch (error) {
    const message = `${name}: ${error.message ?? error}`;
    if (error.code === 'BLOCKED' || error.code === 'OPTIONAL') {
      return { name, ok: false, drafts: [], warning: message, failure: '' };
    }
    return { name, ok: false, drafts: [], warning: '', failure: message };
  }
}

export async function collectNews({ fetchImpl, env = process.env, now = new Date() }) {
  const headers = apiHeaders(env);
  const [blog, motd, shop, status] = await Promise.all([
    loadSource('公式ニュース', () => loadBlog(fetchImpl, env, now)),
    loadSource('ロビー告知', async () => {
      const payload = await getJson(fetchImpl, NEWS_API, headers);
      return draftsFromMotdPayload(payload, now);
    }),
    loadSource('ショップ', async () => {
      const payload = await getJson(fetchImpl, SHOP_API, headers);
      return [draftFromShop(payload, now)];
    }),
    loadSource('ステータス', async () => {
      const payload = await getJson(fetchImpl, STATUS_API, headers);
      return draftsFromStatus(payload, now);
    }),
  ]);
  return {
    sources: [blog, motd, shop, status],
    items: [blog, motd, shop, status].flatMap((source) => source.drafts),
  };
}

function scanPostIds(dir) {
  if (!existsSync(dir)) return new Set();
  const ids = new Set();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const text = readFileSync(resolve(dir, name), 'utf8');
    for (const id of ingestIdsInMarkdown(text)) ids.add(id);
  }
  return ids;
}

function loadStateIds() {
  if (!existsSync(STATE_PATH)) return [];
  return readState(readFileSync(STATE_PATH, 'utf8'));
}

function writeState(ids) {
  const body = `${JSON.stringify({ version: 1, ids: [...ids].sort() }, null, 2)}\n`;
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, body);
}

function uniqueSlug(slug, used) {
  let next = slug;
  let count = 2;
  while (used.has(next)) {
    next = `${slug}-${count}`;
    count += 1;
  }
  used.add(next);
  return next;
}

function setOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

export async function main(argv = process.argv) {
  const dryRun = argv.includes('--dry-run');
  const now = new Date();
  const { sources, items } = await collectNews({ fetchImpl: globalThis.fetch, env: process.env, now });
  for (const source of sources) {
    const label = source.ok ? `取得 ${source.drafts.length} 件` : '失敗';
    console.log(`${source.name}: ${label}`);
    if (source.warning) console.log(`  警告: ${source.warning}`);
    if (source.failure) console.error(`  失敗: ${source.failure}`);
  }
  const reachable = sources.some((source) => source.ok);
  if (!reachable) {
    console.error('取り込み先がすべて失敗しました。記事は書いていません。');
    setOutput('changed', 'false');
    setOutput('count', '0');
    process.exitCode = 1;
    return;
  }
  const existing = new Set([...loadStateIds(), ...scanPostIds(POSTS_DIR)]);
  const max = Number(process.env.INGEST_MAX_NEW ?? 12);
  const chosen = selectDrafts(items, existing, max);
  const usedSlugs = new Set(
    existsSync(POSTS_DIR) ? readdirSync(POSTS_DIR).filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -3)) : [],
  );
  const written = [];
  for (const draft of chosen) {
    try {
      draft.slug = uniqueSlug(draft.slug, usedSlugs);
      const markdown = renderMarkdown(draft);
      const path = resolve(POSTS_DIR, `${draft.slug}.md`);
      if (dryRun) {
        console.log(`dry-run: ${path}`);
        console.log(markdown.split('\n').slice(0, 12).join('\n'));
      } else {
        mkdirSync(POSTS_DIR, { recursive: true });
        writeFileSync(path, markdown);
      }
      written.push(draft.ingestId);
      console.log(`新規: ${draft.ingestId} -> ${draft.slug}.md`);
    } catch (error) {
      console.error(`スキップ ${draft.ingestId}: ${error.message ?? error}`);
    }
  }
  if (!dryRun) writeState(new Set([...existing, ...written]));
  setOutput('changed', written.length > 0 ? 'true' : 'false');
  setOutput('count', String(written.length));
  console.log(written.length > 0 ? `追加 ${written.length} 件` : '新しい項目はありません');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
