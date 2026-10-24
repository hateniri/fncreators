import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;

export async function getPosts(): Promise<Post[]> {
  const posts = await getCollection('posts');
  return posts.sort((a, b) => {
    const delta = b.data.date.getTime() - a.data.date.getTime();
    if (delta !== 0) return delta;
    return a.id.localeCompare(b.id, 'en');
  });
}

export function postUrl(id: string): string {
  return `/posts/${id}/`;
}

export function tagUrl(tag: string): string {
  return `/tags/${encodeURIComponent(tag)}/`;
}

export function listTags(posts: Post[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of new Set(post.data.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'));
}

export function postsByTag(posts: Post[], tag: string): Post[] {
  return posts.filter((post) => post.data.tags.includes(tag));
}

export function relatedPosts(posts: Post[], current: Post, limit = 3): Post[] {
  const tags = new Set(current.data.tags);
  return posts
    .filter((post) => post.id !== current.id && post.data.tags.some((tag) => tags.has(tag)))
    .slice(0, limit);
}
