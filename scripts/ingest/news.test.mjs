import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  POSTS_DIR,
  SUMMARY_MAX,
  articleFromDecoded,
  collectNews,
  decodeFortniteData,
  draftFromArticle,
  draftFromShop,
  draftsFromMotdPayload,
  draftsFromStatus,
  extractArticle,
  formatOffset,
  ingestIdsInMarkdown,
  listNewsItems,
  renderMarkdown,
  selectDrafts,
  slugFromNewsLink,
  summaryWithSuffix,
} from './news.mjs';

test('日本時間のオフセットを付ける', () => {
  assert.equal(formatOffset(new Date('2026-10-24T00:00:00Z')), '2026-10-24T09:00:00+09:00');
});

test('要約は140字を超えない', () => {
  const long = 'あ'.repeat(200);
  const confirmed = summaryWithSuffix(long, 'confirmed');
  const rumor = summaryWithSuffix(long, 'rumor');
  assert.ok(confirmed.length <= SUMMARY_MAX);
  assert.ok(rumor.length <= SUMMARY_MAX);
  assert.match(confirmed, /公式ベース。非公式のまとめ。$/);
  assert.match(rumor, /未確認。非公式のまとめ。$/);
  assert.doesNotMatch(confirmed, /未確認/);
});

test('fortnite.com のインデックス配列をほどく', () => {
  const values = [
    { _1: 2 },
    'routes/news._index',
    { _3: 4 },
    'data',
    { _5: 6, _7: 8 },
    'heroNewsItem',
    { _9: 10, _11: 12, _13: 14, _15: 16 },
    'recentNewsItems',
    { _17: 18 },
    'heading',
    '見出し',
    'link',
    '/news/example-slug',
    'imgSrc',
    'https://cdn2.unrealengine.com/a.jpeg',
    'tags',
    [20],
    'newsItems',
    [],
    null,
    { _21: 22 },
    'label',
    'バトルロイヤル',
  ];
  const decoded = decodeFortniteData(values);
  const items = listNewsItems(decoded);
  assert.equal(items.length, 1);
  assert.equal(items[0].heading, '見出し');
  assert.equal(items[0].tags[0].label, 'バトルロイヤル');
  assert.equal(slugFromNewsLink(items[0].link), 'example-slug');
});

test('公式記事は見出しと書き出しだけを残す', () => {
  const article = {
    title: 'テスト記事',
    publishedDate: '2026-10-13T00:00:00Z',
    sections: [
      {
        __typename: 'ElementRichText',
        text: {
          raw: {
            children: [
              { type: 'heading-two', children: [{ text: 'モード' }] },
              { type: 'paragraph', children: [{ text: '短い書き出し。' }] },
            ],
          },
        },
      },
      { __typename: 'ElementArticleVideoYouTube', youTubeVideoId: 'abc123' },
    ],
  };
  const extracted = extractArticle(article);
  assert.deepEqual(extracted.headings, ['モード']);
  assert.deepEqual(extracted.paragraphs, ['短い書き出し。']);
  const draft = draftFromArticle(article, {
    heading: 'テスト記事',
    link: '/news/example-slug',
    imgSrc: 'https://cdn2.unrealengine.com/resize=fit:clip,width:1920/quality=value:80/hero.jpeg',
    tags: [{ label: 'UEFNとクリエイティブ' }],
  });
  assert.equal(draft.ingestId, 'blog:example-slug');
  assert.equal(draft.notice, 'confirmed');
  assert.equal(draft.cover, 'https://cdn2.unrealengine.com/hero.jpeg');
  const markdown = renderMarkdown(draft);
  assert.match(markdown, /短い書き出し/);
  assert.match(markdown, /youtube\.com\/watch\?v=abc123/);
  assert.match(markdown, /非公式ファンサイト/);
  assert.match(markdown, /<!-- ingest:blog:example-slug -->/);
  assert.doesNotMatch(markdown, /未確認です/);
});

test('すでにデコード済みのオブジェクトはそのまま使う', () => {
  const decoded = { newsArticle: { title: 'そのまま' } };
  assert.equal(articleFromDecoded(decoded).title, 'そのまま');
  assert.equal(decodeFortniteData(decoded), decoded);
});

test('ロビー告知は公式ベースで、古いフィードは捨てる', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  const drafts = draftsFromMotdPayload(
    {
      data: {
        br: {
          date: '2026-10-21T01:30:32Z',
          motds: [
            {
              id: 'abc123',
              title: '共に立ち向かう価値のある恐怖',
              body: '開発者たちの島を回る。',
              image: 'https://cdn-live.prm.ol.epicgames.com/prod/example.jpeg',
              sortingPriority: 10,
              hidden: false,
            },
            { id: 'hidden', title: '隠す', body: '出さない', hidden: true },
          ],
        },
        stw: {
          date: '2026-02-26T18:54:48Z',
          messages: [{ title: '古い', body: '対象外' }],
        },
      },
    },
    now,
  );
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].ingestId, 'motd:abc123');
  assert.ok(drafts[0].tags.includes('UEFN'));
  assert.match(drafts[0].cover, /epicgames\.com/);
  const markdown = renderMarkdown(drafts[0]);
  assert.match(markdown, /公式ベース/);
  assert.match(markdown, /非公式ファンサイト/);
  assert.match(markdown, /開発者たちの島を回る/);
});

test('ショップは新規表示だけを記事にする', () => {
  const now = new Date('2026-10-24T13:50:00Z');
  const draft = draftFromShop(
    {
      data: {
        hash: 'abc123def',
        date: '2026-10-24T00:00:00Z',
        entries: [
          {
            banner: { value: '新規', backendValue: 'New' },
            finalPrice: 1500,
            outDate: '2026-11-02T23:59:59Z',
            layout: { name: 'ビートルジュース' },
            brItems: [
              {
                name: 'ビートルジュース',
                type: { displayValue: 'コスチューム' },
                images: { featured: 'https://fortnite-api.com/images/cosmetics/br/example/featured.png' },
              },
            ],
          },
          {
            layout: { name: 'ハズビン・ホテル' },
            brItems: [{ name: '既存スキン', type: { displayValue: 'コスチューム' } }],
          },
          {
            banner: { value: '新規', backendValue: 'New' },
            layout: { name: 'ジャムトラック' },
            tracks: [],
          },
        ],
      },
    },
    now,
  );
  assert.equal(draft.ingestId, 'shop:abc123def');
  assert.match(draft.body, /ビートルジュース/);
  assert.match(draft.body, /ハズビン・ホテル/);
  assert.doesNotMatch(draft.body, /既存スキン/);
  const markdown = renderMarkdown(draft);
  const summary = JSON.parse(/summary: (".*")/.exec(markdown)[1]);
  assert.ok(summary.length <= SUMMARY_MAX);
  assert.match(summary, /非公式のまとめ/);
});

test('通常運転のステータスは記事にしない', () => {
  const now = new Date('2026-10-24T12:00:00Z');
  const quiet = draftsFromStatus(
    {
      components: [
        { id: 'fn', name: 'Fortnite', status: 'operational' },
        { id: 'eos', name: 'Lobbies', status: 'degraded_performance' },
      ],
      incidents: [],
      scheduled_maintenances: [
        {
          id: 'later',
          name: 'EOS Maintenance',
          status: 'scheduled',
          scheduled_for: '2026-11-10T06:00:00Z',
          components: [{ name: 'Lobbies' }],
        },
      ],
    },
    now,
  );
  assert.equal(quiet.length, 0);

  const down = draftsFromStatus(
    {
      components: [{ id: 'fn', name: 'Fortnite', status: 'major_outage' }],
      incidents: [
        {
          id: 'inc1',
          name: 'Fortnite login issues',
          status: 'investigating',
          updated_at: '2026-10-24T11:00:00Z',
          shortlink: 'https://status.epicgames.com/incidents/inc1',
          components: [{ id: 'fn', name: 'Fortnite' }],
          incident_updates: [{ body: 'We are investigating.' }],
        },
      ],
      scheduled_maintenances: [],
    },
    now,
  );
  assert.equal(down.length, 1);
  assert.match(renderMarkdown(down[0]), /調査中/);
  assert.match(renderMarkdown(down[0]), /We are investigating/);
});

test('未確認は本文の先頭で明記する', () => {
  const markdown = renderMarkdown({
    ingestId: 'rumor:example',
    slug: 'rumor-example',
    title: 'ロゴだけの画像',
    date: new Date('2026-10-24T00:00:00Z'),
    tags: ['ティーザー'],
    summaryCore: '公式の文章に名前はまだ無い。',
    cover: null,
    notice: 'rumor',
    source: { name: '参照なし', url: 'https://www.fortnite.com/news?lang=ja' },
    body: '画像が回っている、とだけ書ける。',
  });
  assert.match(markdown, /未確認です/);
  assert.match(markdown, /非公式ファンサイト/);
  assert.match(markdown, /notice: "rumor"/);
});

test('取得済み ID は書き直さない', () => {
  const items = [
    { ingestId: 'motd:old', date: new Date('2026-10-22T00:00:00Z') },
    { ingestId: 'motd:new', date: new Date('2026-10-24T00:00:00Z') },
    { ingestId: 'shop:1', date: new Date('2026-10-23T00:00:00Z') },
  ];
  const chosen = selectDrafts(items, new Set(['motd:old']), 1);
  assert.deepEqual(
    chosen.map((item) => item.ingestId),
    ['motd:new'],
  );
});

test('公式記事 JSON が遮られてもロビーとショップは残る', async () => {
  const html = '<html>Just a moment</html>';
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.includes('fortnite.com')) {
      return new Response(html, { status: 403, headers: { 'content-type': 'text/html' } });
    }
    if (href.includes('/v2/news')) {
      return jsonResponse({
        data: {
          br: {
            date: '2026-10-21T01:30:32Z',
            motds: [
              {
                id: 'live1',
                title: 'ホラーがやってきた',
                body: 'バトルロイヤルに侵食。',
                image: 'https://cdn-live.prm.ol.epicgames.com/prod/live.jpeg',
              },
            ],
          },
        },
      });
    }
    if (href.includes('/v2/shop')) {
      return jsonResponse({
        data: {
          hash: 'shop1',
          date: '2026-10-24T00:00:00Z',
          entries: [
            {
              banner: { backendValue: 'New' },
              finalPrice: 500,
              layout: { name: 'FNCS' },
              brItems: [{ name: 'ナイトリーFNCS', type: { displayValue: 'エモート' } }],
            },
          ],
        },
      });
    }
    if (href.includes('status.epicgames.com')) {
      return jsonResponse({
        components: [{ name: 'Fortnite', status: 'operational' }, { name: 'UEFN', status: 'operational' }],
        incidents: [],
        scheduled_maintenances: [],
      });
    }
    return new Response('no', { status: 404, headers: { 'content-type': 'text/plain' } });
  };
  const { sources, items } = await collectNews({
    fetchImpl,
    env: {},
    now: new Date('2026-10-24T13:00:00Z'),
  });
  assert.equal(sources.find((source) => source.name === '公式ニュース').ok, false);
  assert.match(sources.find((source) => source.name === '公式ニュース').warning, /Cloudflare/);
  assert.equal(sources.find((source) => source.name === 'ロビー告知').ok, true);
  assert.equal(sources.find((source) => source.name === 'ショップ').ok, true);
  assert.ok(items.some((item) => item.ingestId === 'motd:live1'));
  assert.ok(items.some((item) => item.ingestId === 'shop:shop1'));
});

test('リポジトリ内の取り込み ID は重複しない', () => {
  const seen = new Map();
  for (const name of readdirSync(POSTS_DIR)) {
    if (!name.endsWith('.md')) continue;
    const text = readFileSync(resolve(POSTS_DIR, name), 'utf8');
    const summary = text.match(/^summary: (".*")$/m);
    if (summary) {
      const value = JSON.parse(summary[1]);
      assert.ok(value.length <= SUMMARY_MAX, `${name} summary ${value.length}`);
    }
    for (const id of ingestIdsInMarkdown(text)) {
      assert.ok(!seen.has(id), `${id} が ${seen.get(id)} と ${name} で重複`);
      seen.set(id, name);
    }
    if (text.includes('<!-- ingest:')) {
      assert.match(text, /notice: "(confirmed|rumor)"/);
      assert.match(text, /非公式/);
      assert.match(text, /Epic Games、Fortnite、FortniteJP とは関係ありません/);
    }
  }
});

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
