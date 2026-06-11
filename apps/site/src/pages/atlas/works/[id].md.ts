import type { APIRoute } from 'astro';
import { works } from '../../../lib/atlas/data.ts';
import { workToMarkdown } from '../../../lib/atlas/markdown.ts';

export function getStaticPaths() {
  return works.map((work) => ({ params: { id: work.id }, props: { work } }));
}

export const GET: APIRoute = ({ props }) => {
  return new Response(workToMarkdown(props.work), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
