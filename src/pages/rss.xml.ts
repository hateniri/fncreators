import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getPosts } from '../lib/posts';
import { SITE } from '../lib/site';

export async function GET(context: APIContext) {
  const posts = await getPosts();
  return rss({
    title: SITE.name,
    description: SITE.description,
    site: context.site ?? SITE.url,
    trailingSlash: true,
    customData: '<language>ja</language>',
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description:
        post.data.notice === 'rumor'
          ? `未確認。${post.data.summary}`
          : post.data.notice === 'confirmed'
            ? `公式ベース。${post.data.summary}`
            : post.data.summary,
      link: `/posts/${post.id}/`,
      categories: [...post.data.tags],
    })),
  });
}
