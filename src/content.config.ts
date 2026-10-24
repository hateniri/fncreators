import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Posts live in /content/posts so a later job can drop Markdown in
 * without touching src/. The filename (without .md) becomes the URL slug.
 */
const posts = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './content/posts',
  }),
  schema: z.object({
    title: z.string().min(1),
    date: z.coerce.date(),
    tags: z.array(z.string().min(1)).min(1),
    summary: z.string().min(1).max(140),
    cover: z.string().min(1).optional(),
    /** confirmed = 公式の公開情報。rumor = 未確認。無い記事は編集メモ。 */
    notice: z.enum(['confirmed', 'rumor']).optional(),
    source: z
      .object({
        name: z.string().min(1),
        url: z.string().url(),
      })
      .optional(),
  }),
});

export const collections = { posts };
