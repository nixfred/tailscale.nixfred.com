// Content collections: the typed content contract for the whole site.
// Every module is a Markdown file in src/content/modules whose
// frontmatter must satisfy this schema, or the build fails. The schema
// IS the contract; producers get it quoted verbatim.
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const sourceEntry = z.object({
  id: z.string(),
  url: z.string().url(),
  title: z.string(),
  // YAML parses a bare 2026-08-10 as a Date; normalize back to the
  // YYYY-MM-DD string the templates render.
  checked: z.preprocess(
    (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  ),
});

const modules = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/modules' }),
  schema: z.object({
    module: z.number().int().min(0),
    slug: z.string(),
    title: z.string(),
    description: z.string(),
    order: z.number(),
    words: z.number().optional(),
    sources: z.array(sourceEntry).min(1),
  }),
});

const drills = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/drills' }),
  schema: z.object({
    slug: z.string(),
    title: z.string(),
    description: z.string(),
    area: z.enum(['connectivity', 'identity', 'policy', 'dns', 'routing', 'platform']),
    difficulty: z.number().int().min(1).max(3),
    symptom: z.string(),
    words: z.number().optional(),
    sources: z.array(sourceEntry).min(1),
  }),
});

const guides = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/guides' }),
  schema: z.object({
    slug: z.string(),
    title: z.string(),
    description: z.string(),
    track: z.enum(['fieldcraft', 'code-lab']),
    order: z.number(),
    words: z.number().optional(),
    sources: z.array(sourceEntry).min(1),
  }),
});

export const collections = { modules, drills, guides };
